import { readdirSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { sniffDbFlavor } from "src/engine/db";

/**
 * How a node is previewed:
 *   dir     — no preview
 *   tabular — CSV/Parquet/JSON, opens directly in the table view
 *   db      — SQLite/DuckDB file, expands into its tables
 *   table   — one table inside a `db` node
 *   text    — rendered as scrollable text
 *   binary  — metadata only
 */
export type NodeKind = "dir" | "tabular" | "db" | "table" | "text" | "binary";

export type TreeNode = {
  path: string;
  name: string;
  isDir: boolean;
  kind: NodeKind;
  depth: number;
  parentPath: string | null;
  /** Set on `table` nodes: the db file the table lives in. */
  dbPath?: string;
  /** Set on `table` nodes: the table name inside `dbPath`. */
  table?: string;
};

export const TABULAR_EXTS = [".csv", ".tsv", ".parquet", ".json", ".jsonl", ".ndjson"];

const DB_EXTS = [".db", ".sqlite", ".sqlite3", ".duckdb", ".ddb"];

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".pdf",
  ".wasm", ".zip", ".gz", ".tar", ".bz2", ".xz", ".7z",
  ".dylib", ".so", ".lib", ".a", ".o", ".node", ".exe", ".bin",
  ".mp3", ".mp4", ".mov", ".avi", ".woff", ".woff2", ".ttf", ".otf",
]);

const IGNORED = new Set([".git", "node_modules", ".DS_Store"]);

/** A node's preview kind. Db detection sniffs magic bytes, so extensionless dbs still work. */
export function classifyPath(path: string, isDir: boolean): NodeKind {
  if (isDir) return "dir";
  const lower = path.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf("."));
  if (TABULAR_EXTS.includes(ext)) return "tabular";
  if (DB_EXTS.includes(ext)) return sniffDbFlavor(path) ? "db" : "binary";
  if (BINARY_EXTS.has(ext)) return "binary";
  // Extensionless or unknown — a db header still wins over a text guess.
  if (sniffDbFlavor(path)) return "db";
  return "text";
}

/** Nodes that can be expanded to reveal children (directories and db files). */
export function isExpandable(node: Pick<TreeNode, "kind">): boolean {
  return node.kind === "dir" || node.kind === "db";
}

/** Read a directory's direct children as tree nodes (dirs first, then files, alphabetical). */
export function readChildren(dirPath: string, depth: number): TreeNode[] {
  let names: string[];
  try {
    names = readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => !IGNORED.has(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const decorated = names.map((name) => {
    const fullPath = join(dirPath, name);
    let isDir = false;
    try {
      isDir = statSync(fullPath).isDirectory();
    } catch {
      isDir = false;
    }
    return { name, fullPath, isDir };
  });

  decorated.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });

  return decorated.map(({ name, fullPath, isDir }) => ({
    path: fullPath,
    name,
    isDir,
    kind: classifyPath(fullPath, isDir),
    depth,
    parentPath: dirPath,
  }));
}

/** Build the child nodes for a db file from its table names. */
export function dbTableNodes(dbPath: string, tables: string[], depth: number): TreeNode[] {
  return tables.map((table) => ({
    // Synthetic path — `::` cannot appear in a real path segment we produce.
    path: `${dbPath}::${table}`,
    name: table,
    isDir: false,
    kind: "table" as const,
    depth,
    parentPath: dbPath,
    dbPath,
    table,
  }));
}

/**
 * Flatten the tree into a visible list, respecting which directories are expanded.
 * Children are read lazily via `readChildren` and cached in `childrenCache`; db
 * children are filled in asynchronously by the caller (see DirectoryMode).
 */
export function buildVisibleList(
  rootPath: string,
  expanded: Set<string>,
  childrenCache: Map<string, TreeNode[]>,
): TreeNode[] {
  const root = resolve(rootPath);
  const rootName = basename(root) || root;
  let rootIsDir = false;
  try {
    rootIsDir = statSync(root).isDirectory();
  } catch {
    rootIsDir = false;
  }

  const rootNode: TreeNode = {
    path: root,
    name: rootName,
    isDir: rootIsDir,
    kind: classifyPath(root, rootIsDir),
    depth: 0,
    parentPath: null,
  };

  const out: TreeNode[] = [];
  const walk = (node: TreeNode) => {
    out.push(node);
    if (!isExpandable(node)) return;
    if (!expanded.has(node.path)) return;
    let children = childrenCache.get(node.path);
    if (!children) {
      // db children arrive async; only directories can be read synchronously here.
      if (node.kind !== "dir") return;
      children = readChildren(node.path, node.depth + 1);
      childrenCache.set(node.path, children);
    }
    for (const child of children) walk(child);
  };
  walk(rootNode);
  return out;
}

export { resolve as pathResolve, sep };
