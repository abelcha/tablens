/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { basename } from "node:path";
import { createReadStream, statSync } from "node:fs";
import { type KeyEvent } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { Engine } from "src/engine/Engine";
import { buildEngineInput } from "src/engine/openInput";
import { TablensApp } from "src/index";
import {
  buildVisibleList,
  classifyPath,
  dbTableNodes,
  isExpandable,
  readChildren,
  type TreeNode,
} from "src/directory/fileTree";
import { countDbTablesRows, listDbTables } from "src/engine/db";
import { TextPreview } from "src/directory/TextPreview";
import { LoadingSkeleton } from "src/app/components/EmptyState";
import { formatError } from "src/utils/error";

declare module "@opentui/react" {
  namespace JSX {
    interface IntrinsicElements {
      box: any;
      text: any;
    }
  }
}

type PreviewState =
  | { kind: "idle" }
  | { kind: "loading"; file: string }
  | { kind: "table"; file: string; label: string; engine: Engine }
  | { kind: "text"; file: string }
  | { kind: "binary"; file: string }
  | { kind: "error"; file: string; message: string; retryable: boolean };

type TreeInfoMode = "none" | "size" | "lines";

/** Only panes that respond to keys are worth focusing — an error/idle pane is not. */
function canFocusPreview(preview: PreviewState): boolean {
  return preview.kind === "table" || preview.kind === "text";
}

/** Stable identity for "which thing is previewed" — a db table is file + table. */
function previewKeyFor(node: TreeNode | null): string | null {
  if (!node) return null;
  if (node.kind === "table") return node.path;
  if (node.kind === "dir" || node.kind === "db") return null;
  return node.path;
}

export function DirectoryMode({
  rootPath,
  initialPath,
  initialFocus = "tree",
  initialTreeVisible = true,
}: {
  rootPath: string;
  /** File/table selected when entering the browser from a direct file launch. */
  initialPath?: string;
  initialFocus?: "tree" | "preview";
  /** Direct table launches begin full-width; left at column one reveals the tree. */
  initialTreeVisible?: boolean;
}) {
  const renderer = useRenderer();

  // A db root has no readable children here — its tables are listed asynchronously,
  // so seeding the cache with [] would permanently mark it as "already loaded".
  const rootIsDir = classifyPath(rootPath, isDirectory(rootPath)) === "dir";
  const [expanded, setExpanded] = useState<Set<string>>(new Set([rootPath]));
  const [childrenCache, setChildrenCache] = useState<Map<string, TreeNode[]>>(() =>
    rootIsDir ? new Map([[rootPath, readChildren(rootPath, 1)]]) : new Map(),
  );
  const [cursorPath, setCursorPath] = useState<string>(() => {
    if (initialPath) return initialPath;
    if (!rootIsDir) return rootPath;
    const initialCache = new Map([[rootPath, readChildren(rootPath, 1)]]);
    const list = buildVisibleList(rootPath, new Set([rootPath]), initialCache);
    return list.find((n) => n.kind === "tabular")?.path ?? rootPath;
  });
  const [focus, setFocus] = useState<"tree" | "preview">(initialFocus);
  const [treeVisible, setTreeVisible] = useState(initialTreeVisible);
  const [treeWidth, setTreeWidth] = useState(32);
  const [treeInfoMode, setTreeInfoMode] = useState<TreeInfoMode>("none");
  const [lineCounts, setLineCounts] = useState<Map<string, number>>(new Map());
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const [filter, setFilter] = useState<string>("");
  const [filterActive, setFilterActive] = useState(false);

  // Keep opened tables alive while navigating the explorer.
  const enginesRef = useRef<Map<string, Engine>>(new Map());
  const previewLoadRef = useRef(0);
  const retryPreviewRef = useRef<(() => void) | null>(null);

  // Close engine on unmount.
  useEffect(() => {
    return () => {
      for (const engine of enginesRef.current.values()) engine.close().catch(() => {});
      enginesRef.current.clear();
    };
  }, []);

  const visibleAll = useMemo(
    () => buildVisibleList(rootPath, expanded, childrenCache),
    [rootPath, expanded, childrenCache],
  );

  const visibleNodes = useMemo(() => {
    if (!filter) return visibleAll;
    const q = filter.toLowerCase();
    return visibleAll.filter((n) => n.name.toLowerCase().includes(q));
  }, [visibleAll, filter]);

  // Keep cursor valid as the visible list changes. Opening a db file directly lands
  // the cursor on the db itself, so step onto its first table once it has loaded.
  useEffect(() => {
    if (visibleNodes.length === 0) return;
    if (!visibleNodes.some((n) => n.path === cursorPath)) {
      setCursorPath(visibleNodes[0]!.path);
      return;
    }
    if (!rootIsDir && cursorPath === rootPath && visibleNodes[1]) {
      setCursorPath(visibleNodes[1].path);
    }
  }, [visibleNodes, cursorPath, rootIsDir, rootPath]);

  const cursorIndex = Math.max(
    0,
    visibleNodes.findIndex((n) => n.path === cursorPath),
  );
  const cursorNode = visibleNodes[cursorIndex] ?? null;

  const toggleExpand = useCallback((node: TreeNode) => {
    if (!isExpandable(node)) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      return next;
    });
  }, []);

  // ---- Lazily list tables for expanded db files ----------------------------
  useEffect(() => {
    const pending = visibleAll.filter(
      (n) => n.kind === "db" && expanded.has(n.path) && !childrenCache.has(n.path),
    );
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const node of pending) {
        let tables: string[] = [];
        try {
          tables = await listDbTables(node.path);
        } catch (err) {
          console.warn(`tablens: cannot list tables in ${node.path}:`, err);
        }
        if (cancelled) return;
        setChildrenCache((prev) => {
          if (prev.has(node.path)) return prev;
          const next = new Map(prev);
          next.set(node.path, dbTableNodes(node.path, tables, node.depth + 1));
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visibleAll, expanded, childrenCache]);

  // Load line counts only when requested and keep them cached for this explorer.
  useEffect(() => {
    if (treeInfoMode !== "lines") return;
    let cancelled = false;
    void (async () => {
      const tableGroups = new Map<string, TreeNode[]>();
      for (const node of visibleAll) {
        if (node.kind === "table" && !lineCounts.has(node.path)) {
          const group = tableGroups.get(node.dbPath!) ?? [];
          group.push(node);
          tableGroups.set(node.dbPath!, group);
        }
      }
      for (const [dbPath, nodes] of tableGroups) {
        if (cancelled) return;
        const counts = await countDbTablesRows(dbPath, nodes.map((node) => node.table!));
        if (!cancelled) setLineCounts((prev) => {
          const next = new Map(prev);
          for (const node of nodes) next.set(node.path, counts.get(node.table!) ?? 0);
          return next;
        });
      }
      for (const node of visibleAll) {
        if (cancelled || node.kind === "dir" || node.kind === "table" || lineCounts.has(node.path)) continue;
        const count = await countLines(node.path);
        if (!cancelled) setLineCounts((prev) => new Map(prev).set(node.path, count));
      }
    })();
    return () => { cancelled = true; };
  }, [treeInfoMode, visibleAll, lineCounts]);

  // ---- Preview loading (debounced) ----------------------------------------
  const previewKey = previewKeyFor(cursorNode);
  useEffect(() => {
    const loadId = ++previewLoadRef.current;
    retryPreviewRef.current = null;
    if (!cursorNode || previewKey === null) {
      setPreview({ kind: "idle" });
      return;
    }

    // Non-tabular previews are cheap and synchronous — no engine, no debounce.
    if (cursorNode.kind === "text") {
      setPreview({ kind: "text", file: cursorNode.path });
      return;
    }
    if (cursorNode.kind === "binary") {
      setPreview({ kind: "binary", file: cursorNode.path });
      return;
    }

    const node = cursorNode;
    const label = node.kind === "table" ? `${basename(node.dbPath!)} › ${node.table}` : node.name;

    const cachedEngine = enginesRef.current.get(previewKey);
    if (cachedEngine) {
      setPreview({ kind: "table", file: previewKey, label, engine: cachedEngine });
      return;
    }

    // Already showing this? Keep it — avoids remount thrash on focus changes.
    setPreview((prev) =>
      prev.kind === "table" && prev.file === previewKey
        ? prev
        : { kind: "loading", file: previewKey },
    );

    const handle = setTimeout(() => {
      const load = async (ignoreErrors = false) => {
        const engine = new Engine();
        try {
          const input =
            node.kind === "table"
              ? ({ kind: "db", path: node.dbPath!, table: node.table! } as const)
              : { ...buildEngineInput(node.path), ...(ignoreErrors ? { ignoreErrors: true } : {}) };
          await engine.open(input);
          if (previewLoadRef.current !== loadId) {
            await engine.close().catch(() => {});
            return;
          }
          enginesRef.current.set(previewKey, engine);
          retryPreviewRef.current = null;
          setPreview({ kind: "table", file: previewKey, label, engine });
        } catch (err) {
          await engine.close().catch(() => {});
          const message = formatError(err);
          const retryable = node.kind !== "table" &&
            /read_csv|csv error|invalid unicode|ignore_errors/i.test(message);
          if (retryable) {
            retryPreviewRef.current = () => {
              retryPreviewRef.current = null;
              setPreview({ kind: "loading", file: previewKey });
              void load(true);
            };
          }
          setPreview({ kind: "error", file: previewKey, message, retryable });
        }
      };
      void load();
    }, 120);

    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  // Mirror preview into a ref so the debounced timeout can read latest without re-running.
  const previewRef = useRef<PreviewState>(preview);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  // ---- Layout dims ---------------------------------------------------------
  const consoleHeight =
    renderer.console.visible && renderer.console.bounds?.height
      ? Number(renderer.console.bounds.height) || 0
      : 0;
  const termH = Math.max(1, renderer.terminalHeight - consoleHeight);
  const termW = renderer.terminalWidth;

  const maxTreeWidth = Math.max(24, Math.min(60, termW - 12));
  const boundedTreeWidth = Math.max(24, Math.min(maxTreeWidth, treeWidth));
  const previewWidth = Math.max(10, termW - boundedTreeWidth - 1); // -1 for divider
  const activePreviewWidth = treeVisible ? previewWidth : termW;
  const headerHeight = 1;
  const listHeight = Math.max(1, termH - headerHeight - 1); // -1 for footer

  // ---- Windowing -----------------------------------------------------------
  const half = Math.floor(listHeight / 2);
  const windowStart =
    visibleNodes.length <= listHeight
      ? 0
      : Math.max(0, Math.min(visibleNodes.length - listHeight, cursorIndex - half));
  const visibleWindow = visibleNodes.slice(windowStart, windowStart + listHeight);

  // ---- Keyboard ------------------------------------------------------------
  const moveCursor = useCallback(
    (delta: number) => {
      const next = Math.max(0, Math.min(visibleNodes.length - 1, cursorIndex + delta));
      setCursorPath(visibleNodes[next]!.path);
    },
    [visibleNodes, cursorIndex],
  );

  useKeyboard((key: KeyEvent) => {
    if (key.ctrl && key.name === "c") {
      renderer.destroy();
      process.exit(0);
    }

    // Tab always toggles focus between tree and table (when a preview is ready).
    if (key.name === "tab") {
      if (focus === "tree") {
        if (canFocusPreview(previewRef.current)) setFocus("preview");
      } else {
        setTreeVisible(true);
        setFocus("tree");
      }
      return;
    }

    if (previewRef.current.kind === "error" && previewRef.current.retryable) {
      if (key.name === "r") {
        retryPreviewRef.current?.();
        return;
      }
      if (key.name === "escape") {
        setPreview({ kind: "idle" });
        return;
      }
    }

    // When focus is on the table, only Tab (handled above) and the global quit
    // are intercepted here — everything else is handled by TablensApp.
    if (focus === "preview") return;

    // Console toggle passthrough.
    if (key.name === "`") {
      renderer.console.toggle();
      return;
    }

    const isWider = key.name === ">" || key.raw === ">";
    const isNarrower = key.name === "<" || key.raw === "<";
    if (isWider || isNarrower) {
      setTreeWidth((width) => Math.max(24, Math.min(maxTreeWidth, width + (isWider ? 2 : -2))));
      return;
    }
    if (key.name === "v") {
      setTreeVisible((visible) => !visible);
      return;
    }
    if (key.name === "s" || key.name === "i") {
      setTreeInfoMode((mode) => mode === "none" ? "size" : mode === "size" ? "lines" : "none");
      return;
    }

    if (filterActive) {
      if (key.name === "escape") {
        setFilterActive(false);
        setFilter("");
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        setFilterActive(false);
        return;
      }
      if (key.name === "backspace") {
        setFilter((f) => f.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && typeof key.raw === "string" && key.raw.length === 1) {
        setFilter((f) => f + key.raw);
        return;
      }
      return;
    }

    if (key.name === "q") {
      renderer.destroy();
      process.exit(0);
    }

    if (key.raw === "/") {
      setFilterActive(true);
      setFilter("");
      return;
    }

    if (key.name === "up" || key.name === "k") {
      moveCursor(-1);
      return;
    }
    if (key.name === "down" || key.name === "j") {
      moveCursor(1);
      return;
    }
    if (key.name === "pageup") {
      moveCursor(-listHeight);
      return;
    }
    if (key.name === "pagedown") {
      moveCursor(listHeight);
      return;
    }
    if (key.name === "home") {
      if (visibleNodes.length > 0) setCursorPath(visibleNodes[0]!.path);
      return;
    }
    if (key.name === "end") {
      if (visibleNodes.length > 0) setCursorPath(visibleNodes[visibleNodes.length - 1]!.path);
      return;
    }
    if (key.name === "g") {
      const target = key.shift ? visibleNodes[visibleNodes.length - 1] : visibleNodes[0];
      setCursorPath(target?.path ?? cursorPath);
      return;
    }

    if (!cursorNode) return;

    if (key.name === "right" || key.name === "l" || key.name === "return" || key.name === "enter") {
      // Right enters an available preview immediately. Expandable nodes that
      // do not have a preview yet still use the first press to expand.
      if (canFocusPreview(previewRef.current)) {
        setFocus("preview");
        return;
      }
      // Expandable nodes without a preview use Right to toggle their children.
      if (isExpandable(cursorNode) && !expanded.has(cursorNode.path)) {
        toggleExpand(cursorNode);
      } else if (isExpandable(cursorNode)) {
        toggleExpand(cursorNode);
      }
      return;
    }
    if (key.name === "left" || key.name === "h") {
      if (isExpandable(cursorNode) && expanded.has(cursorNode.path)) {
        toggleExpand(cursorNode);
      } else if (cursorNode.parentPath) {
        setCursorPath(cursorNode.parentPath);
      } else if (!initialTreeVisible && canFocusPreview(previewRef.current)) {
        setTreeVisible(false);
        setFocus("preview");
      }
      return;
    }
  });

  // ---- Render --------------------------------------------------------------
  const treeRows = visibleWindow.map((node, i) => {
    const idx = windowStart + i;
    const isCursor = idx === cursorIndex;
    const indent = "  ".repeat(node.depth);
    const arrow = isExpandable(node) ? (expanded.has(node.path) ? "▾" : "▸") : " ";
    const infoValue = treeInfoMode === "size"
      ? fileSize(node.path)
      : treeInfoMode === "lines" && node.kind !== "dir"
        ? lineCounts.get(node.path)
        : undefined;
    const info = infoValue === undefined ? "…" : compactNumber(infoValue);
    const hasInfo = treeInfoMode !== "none" && (node.kind !== "dir" || treeInfoMode === "size");
    const infoWidth = hasInfo ? 6 : 0;
    const label = `${indent}${arrow} ${node.name}`;
    const labelWidth = Math.max(1, boundedTreeWidth - infoWidth);
    const fg = isCursor ? "#000000" : "#c0c0c0";
    const bg = isCursor ? (focus === "tree" ? "#ffd33d" : "#252b33") : undefined;
    return (
      <box key={node.path} width="100%" height={1} backgroundColor={bg} flexDirection="row">
        {hasInfo ? (
          <text
            width={infoWidth}
            content={` ${info}`}
            fg={isCursor ? fg : infoColor(infoValue ?? 0, treeInfoMode)}
          />
        ) : null}
        <text width={labelWidth} content={truncate(label, labelWidth)} fg={fg} />
      </box>
    );
  });

  const previewInner = (() => {
    switch (preview.kind) {
      case "table":
        return (
          <TablensApp
            key={preview.file}
            file={preview.label}
            source={preview.engine}
            width={activePreviewWidth}
            height={termH - 1}
            keyboardEnabled={focus === "preview"}
            onNavigateLeft={() => {
              setTreeVisible(true);
              setFocus("tree");
            }}
          />
        );
      case "text":
        return (
          <TextPreview
            key={preview.file}
            file={preview.file}
            width={activePreviewWidth}
            height={termH - 1}
            focused={focus === "preview"}
          />
        );
      case "binary":
        return (
          <CenteredMessage
            icon="⬢"
            title={basename(preview.file)}
            sub={`Binary file · ${formatBytes(fileSize(preview.file))}`}
            iconColor="#555555"
          />
        );
      case "loading":
        return <LoadingSkeleton width={activePreviewWidth} height={termH - 1} />;
      case "error":
        return (
          <box
            width="100%"
            height="100%"
            alignItems="center"
            justifyContent="center"
            flexDirection="column"
          >
            <box
              width={Math.max(20, Math.min(activePreviewWidth - 4, 92))}
              border={true}
              borderStyle="single"
              borderColor="#FFAA00"
              backgroundColor="#2a2418"
              padding={1}
              flexDirection="column"
            >
              <text content="⚠  Failed to load CSV" fg="#FFAA00" />
              <text content={preview.message} fg="#FFCC88" marginTop={1} />
              {preview.retryable ? (
                <text content="Press r to rerun with ignore_errors=true · Esc to dismiss" fg="#FFFFFF" marginTop={1} />
              ) : null}
            </box>
          </box>
        );
      case "idle":
      default:
        return (
          <CenteredMessage
            icon="▤"
            title="No preview"
            sub="Select a file, or expand a directory / database"
            iconColor="#444444"
          />
        );
    }
  })();

  const footerText =
    focus === "tree"
      ? `{grey}↑/↓ navigate · →/↵ expand/open · ← collapse · </> width · i info:${treeInfoMode} · v sidebar · / filter · Tab preview · q quit{/grey}`
      : preview.kind === "table"
        ? `{grey}← at first column / Tab opens files · all tablens shortcuts active{/grey}`
        : `{grey}Tab back to tree · j/k scroll · g/G top/bottom{/grey}`;

  return (
    <box width={termW} height={termH} flexDirection="column">
      <box flexDirection="row" flexGrow={1} height={termH - 1}>
        {/* Tree pane */}
        {treeVisible ? (
          <>
            <box
              width={boundedTreeWidth}
              height={termH - 1}
              flexDirection="column"
            >
              <box width="100%" height={headerHeight}>
                <text
                  content={parseMarkup(
                    ` {bold}${shortPath(rootPath, rootPath)}{/bold}` +
                      (filterActive ? ` {grey}/ ${filter}{/grey}` : ""),
                  )}
                />
              </box>
              <box width="100%" flexGrow={1} flexDirection="column">
                {treeRows.length > 0 ? (
                  treeRows
                ) : (
                  <text content={parseMarkup(" {grey}(empty){/grey}")} />
                )}
              </box>
            </box>
            <box width={1} height={termH - 1} backgroundColor="#303238" />
          </>
        ) : null}

        {/* Preview pane */}
        <box width={activePreviewWidth} height={termH - 1} flexDirection="column">
          {previewInner}
        </box>
      </box>

      {/* Footer */}
      <box width="100%" height={1} backgroundColor="#161b22">
        <text content={parseMarkup(` ${footerText}`)} />
      </box>
    </box>
  );
}

function CenteredMessage({
  icon,
  title,
  sub,
  iconColor = "#444444",
}: {
  icon: string;
  title: string;
  sub?: string;
  iconColor?: string;
}) {
  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >
      <text content={parseMarkup(` {bold}${icon}{/bold} `)} fg={iconColor} />
      <text content={parseMarkup(` {bold}${title}{/bold} `)} fg="#ffffff" marginTop={1} />
      {sub ? <text content={parseMarkup(` {grey}${sub}{/grey} `)} /> : null}
    </box>
  );
}

// Minimal markup — re-uses {bold}/{grey}/hex colors like the app markup, but scoped.
import { StyledText, RGBA } from "@opentui/core";
function parseMarkup(text: string): StyledText {
  const chunks: any[] = [];
  const stack: { attr: number; color?: string }[] = [];
  let remaining = text;
  const theme: Record<string, string> = {
    grey: "#888888",
    gray: "#888888",
    bold: "", // attr only
  };
  while (remaining.length > 0) {
    const m = remaining.match(/\{(\/?)([^}]+)\}/);
    if (!m) {
      chunks.push({
        __isChunk: true,
        text: remaining,
        attributes: stack[stack.length - 1]?.attr || 0,
        fg: stack[stack.length - 1]?.color
          ? RGBA.fromHex(stack[stack.length - 1]!.color!)
          : undefined,
      });
      break;
    }
    const [full, closing, name] = m as RegExpMatchArray & [string, string, string];
    const at = m.index!;
    if (at > 0) {
      chunks.push({
        __isChunk: true,
        text: remaining.substring(0, at),
        attributes: stack[stack.length - 1]?.attr || 0,
        fg: stack[stack.length - 1]?.color
          ? RGBA.fromHex(stack[stack.length - 1]!.color!)
          : undefined,
      });
    }
    if (closing) {
      stack.pop();
    } else {
      let attr = stack[stack.length - 1]?.attr || 0;
      let color = stack[stack.length - 1]?.color;
      if (name === "bold") attr |= 1 << 0;
      else if (name.startsWith("#")) color = name;
      else if (theme[name] !== undefined) color = theme[name] || color;
      stack.push({ attr, color });
    }
    remaining = remaining.substring(at + full.length);
  }
  return new StyledText(chunks);
}

function iconForNode(node: TreeNode): string {
  if (node.kind === "dir") return "📁";
  if (node.kind === "db") return "🗄";
  if (node.kind === "table") return "▦";
  if (node.kind === "binary") return "⬢";
  const lower = node.name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) return "📊";
  if (lower.endsWith(".parquet")) return "🦆";
  if (lower.endsWith(".json") || lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) return "🧩";
  return "📄";
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** Count logical text lines without loading the whole file into memory. */
async function countLines(path: string): Promise<number> {
  return await new Promise((resolve) => {
    let lines = 0;
    let bytes = 0;
    let lastByte = -1;
    const stream = createReadStream(path);
    stream.on("data", (chunk: Buffer | string) => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      bytes += buffer.length;
      for (const byte of buffer) {
        if (byte === 10) lines++;
        lastByte = byte;
      }
    });
    stream.on("end", () => resolve(bytes === 0 ? 0 : lines + (lastByte === 10 ? 0 : 1)));
    stream.on("error", () => resolve(0));
  });
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

function compactNumber(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}K`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
  return `${(value / 1_000_000_000).toFixed(value < 10_000_000_000 ? 1 : 0)}B`;
}

function infoColor(value: number, mode: TreeInfoMode): string {
  if (mode === "size") {
    if (value < 1024) return "#8b949e";
    if (value < 1024 ** 2) return "#58a6ff";
    if (value < 100 * 1024 ** 2) return "#3fb950";
    if (value < 1024 ** 3) return "#d29922";
    return "#f85149";
  }
  if (value < 1_000) return "#8b949e";
  if (value < 100_000) return "#58a6ff";
  if (value < 1_000_000) return "#3fb950";
  if (value < 10_000_000) return "#d29922";
  return "#f85149";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return "…";
  return s.slice(0, max - 1) + "…";
}

function shortPath(path: string, rootPath: string): string {
  if (path === rootPath) {
    const base = path.split("/").filter(Boolean).pop();
    return base ? `./${base}/` : path;
  }
  return path.replace(rootPath.replace(/\/$/, "") + "/", "");
}
