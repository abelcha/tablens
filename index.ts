#!/usr/bin/env -S bun run
import { createElement } from "react";
import { parseArgs } from "node:util";
import { ConsolePosition, createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Engine } from "src/engine/Engine";
import { buildEngineInput } from "src/engine/openInput";
import { TablensApp } from "src/index";
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
  bun run index.ts [file] [options]

Arguments:
  file              Path to CSV, Parquet, or JSON file

Options:
  -q, --query <sql> Execute SQL query instead of loading file
  -h, --help        Show this help message

Keyboard shortcuts (in app):
  q/C-c              Quit
  j/k / arrows      Navigate
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

  await launchTablens({ file: file || "data.csv", query });
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
