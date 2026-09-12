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

export async function launchTablens(options: { file: string; query?: string }) {
  const { file, query } = options;
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

  // Direct tabular files start as a full-width table. At the left edge, the
  // table reveals this parent-directory explorer with the file still selected.
  if (!query && file) {
    const resolved = resolve(file);
    let isDir = false;
    try {
      isDir = statSync(resolved).isDirectory();
    } catch {
      // not found — fall through to engine which will surface the error.
    }
    const kind = classifyPathForLaunch(resolved, isDir);
    if (isDir || sniffDbFlavor(resolved)) {
      await launchDirectory(resolved);
      return;
    }
    if (kind === "tabular") {
      await launchDirectory(dirname(resolved), {
        initialPath: resolved,
        initialFocus: "preview",
        initialTreeVisible: false,
      });
      return;
    }
  }

  await launchTablens({ file: file || "data.csv", query });
}

function classifyPathForLaunch(path: string, isDir: boolean) {
  // Keep the CLI routing independent of the React tree module's rendering code.
  const extension = path.toLowerCase().slice(path.lastIndexOf("."));
  return [".csv", ".tsv", ".parquet", ".json", ".jsonl", ".ndjson"].includes(extension)
    ? "tabular"
    : isDir
      ? "dir"
      : "other";
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
