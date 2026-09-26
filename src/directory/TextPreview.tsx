/** @jsxImportSource @opentui/react */
import { useEffect, useMemo, useState } from "react";
import { openSync, readSync, closeSync, statSync } from "node:fs";
import { type KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";

declare module "@opentui/react" {
  namespace JSX {
    interface IntrinsicElements {
      box: any;
      text: any;
    }
  }
}

const BYTE_LIMIT = 256 * 1024;

/** Read at most `BYTE_LIMIT` bytes so a multi-GB log never blocks the UI. */
function readHead(path: string): { text: string; truncated: boolean; size: number } {
  const size = statSync(path).size;
  const want = Math.min(size, BYTE_LIMIT);
  const buf = Buffer.alloc(want);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buf, 0, want, 0);
  } finally {
    closeSync(fd);
  }
  return { text: buf.toString("utf8"), truncated: size > want, size };
}

export function TextPreview({
  file,
  width,
  height,
  focused,
}: {
  file: string;
  width: number;
  height: number;
  /** When true, j/k/arrows/page keys scroll this pane. */
  focused: boolean;
}) {
  const [content, setContent] = useState<{ lines: string[]; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scroll, setScroll] = useState(0);

  useEffect(() => {
    setContent(null);
    setError(null);
    setScroll(0);
    try {
      const { text, truncated } = readHead(file);
      // Control chars other than tab/newline mean we guessed wrong about it being text.
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text.slice(0, 4096))) {
        setError("Binary content");
        return;
      }
      setContent({ lines: text.split("\n"), truncated });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [file]);

  const bodyHeight = Math.max(1, height - 1);
  const maxScroll = Math.max(0, (content?.lines.length ?? 0) - bodyHeight);
  const visible = useMemo(() => {
    if (!content) return [];
    return content.lines.slice(scroll, scroll + bodyHeight);
  }, [content, scroll, bodyHeight]);

  useKeyboard((key: KeyEvent) => {
    if (!focused || !content) return;
    const by = (delta: number) => setScroll((s) => Math.max(0, Math.min(maxScroll, s + delta)));
    if (key.name === "down" || key.name === "j") by(1);
    else if (key.name === "up" || key.name === "k") by(-1);
    else if (key.name === "pagedown" || (key.ctrl && key.name === "d")) by(bodyHeight);
    else if (key.name === "pageup" || (key.ctrl && key.name === "u")) by(-bodyHeight);
    else if (key.name === "end") setScroll(maxScroll);
    else if (key.name === "home") setScroll(0);
    else if (key.name === "g") setScroll(key.shift ? maxScroll : 0);
  });

  if (error) {
    return (
      <box width={width} height={height} flexDirection="column" justifyContent="center" alignItems="center">
        <text content={error} fg="#FF6666" />
      </box>
    );
  }
  if (!content) {
    return (
      <box width={width} height={height} flexDirection="column" justifyContent="center" alignItems="center">
        <text content="◌ loading…" fg="#888888" />
      </box>
    );
  }

  const gutterWidth = String(content.lines.length).length + 1;
  const textWidth = Math.max(1, width - gutterWidth - 1);

  return (
    <box width={width} height={height} flexDirection="column">
      <box width="100%" flexGrow={1} flexDirection="column">
        {visible.map((line, i) => (
          <box key={scroll + i} width="100%" height={1}>
            <text
              content={`${String(scroll + i + 1).padStart(gutterWidth)} ${expandTabs(line).slice(0, textWidth)}`}
              fg="#c0caf5"
            />
          </box>
        ))}
      </box>
      <box width="100%" height={1} backgroundColor="#161b22">
        <text
          content={` ${scroll + 1}-${Math.min(scroll + bodyHeight, content.lines.length)} / ${content.lines.length} lines${content.truncated ? " (truncated)" : ""}`}
          fg="#888888"
        />
      </box>
    </box>
  );
}

function expandTabs(line: string): string {
  return line.replaceAll("\t", "    ").replaceAll("\r", "");
}
