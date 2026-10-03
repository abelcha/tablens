#!/usr/bin/env -S bun run
import { createElement } from "react";
import { parseArgs } from "node:util";
import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ConsolePosition, createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Engine } from "src/engine/Engine";
import { buildEngineInput } from "src/engine/openInput";
import { TablensApp } from "src/index";
import { DirectoryMode } from "src/directory/DirectoryMode";
import { sniffDbFlavor } from "src/engine/db";
import { formatError } from "src/utils/error";
export async function launchTablens(options: {
  file: string;
  query?: string;
  parentPath?: string;
}) {
  const { file, query, parentPath } = options;
  const source = new Engine();

  try {
    await source.open(buildEngineInput(file, query));
  } catch (err) {
    console.error(`tablens: ${formatError(err)}`);
    process.exit(1);
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 40,
    useConsole: true,

    consoleOptions: {
      position: ConsolePosition.BOTTOM,
      sizePercent: 30,
      colorInfo: "#00FFFF",
      colorWarn: "#FFFF00",
      colorError: "#FF0000",
      startInDebugMode: false,
    },
  });
  createRoot(renderer).render(
    createElement(TablensApp, {
      file,
      query,
      source,
      width: undefined,
      height: undefined,
      onNavigateLeft: parentPath
        ? () => {
            renderer.destroy();
            void source
              .close()
              .catch(() => {})
              .finally(() => {
                void launchDirectory(dirname(parentPath), {
                  initialPath: parentPath,
                  initialFocus: "preview",
                  initialTreeVisible: false,
                });
              });
          }
        : undefined,
    }),
  );
}

export async function launchDirectory(
  rootPath: string,
  options: {
    initialPath?: string;
    initialFocus?: "tree" | "preview";
    initialTreeVisible?: boolean;
  } = {},
) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 40,
    useConsole: true,
    consoleOptions: {
      position: ConsolePosition.BOTTOM,
      sizePercent: 30,
      colorInfo: "#00FFFF",
      colorWarn: "#FFFF00",
      colorError: "#FF0000",
      startInDebugMode: false,
    },
  });
  createRoot(renderer).render(
    createElement(DirectoryMode, { rootPath, ...options }),
  );
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      query: {
        type: "string",
        short: "q",
      },
      help: {
        type: "boolean",
        short: "h",
      },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
${"tablen".padEnd(14)}  Terminal data viewer powered by DuckDB

Usage:
  bun run index.ts [file-or-dir] [options]

Arguments:
  file-or-dir      Path to a CSV, Parquet or JSON file, a SQLite/DuckDB
                   database, or a directory. Directories and databases open
                   a broot-like explorer with live preview.

Options:
  -q, --query <sql> Execute SQL query instead of loading file
  -h, --help        Show this help message

Explorer shortcuts:
  ↑/↓ j/k          Navigate tree
  →/↵ l            Expand dir or database / open preview
  ← h              Collapse / move to parent
  /                Filter tree by name
  Tab              Toggle focus between tree and preview
  q/C-c            Quit

Table shortcuts (in app):
  q/C-c              Quit
  j/k / arrows      Navigate
  ← at first column  Open the parent-directory browser
  /                  Search
  f                  Filter column (column mode)
  t                  Toggle column types
  i                  Toggle column stats
  s                  Export current view
  x                  Auto-resize columns
  :                  Query editor
`);
    process.exit(0);
  }

  let query = values.query;
  let file = positionals[0];

  if (!file && !query) {
    file = "data.csv";
  }

  // Direct tabular files open as a full-width table. The parent-directory
  // explorer is opened on demand with ←/h at the first column.
  if (!query && file) {
    const resolved = resolve(file);
    let isDir = false;
    try {
      isDir = statSync(resolved).isDirectory();
    } catch {
      // not found — fall through to engine which will surface the error.
    }
    if (isDir || sniffDbFlavor(resolved)) {
      await launchDirectory(resolved);
      return;
    }
  }

  await launchTablens({
    file: file || "data.csv",
    query,
    parentPath: !query && file ? resolve(file) : undefined,
  });
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
