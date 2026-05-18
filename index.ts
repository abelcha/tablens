#!/usr/bin/env -S bun run
import { createElement } from "react";
import { parseArgs } from "node:util";
import { ConsolePosition, createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { DuckDBDataSource } from "src/data/source";
import { TablensApp } from "src/index";

export async function launchTablens(options: { file?: string; query?: string; materialize?: string }) {
  const { file, query, materialize } = options;
  const source = new DuckDBDataSource(materialize ? parseMaterializeMode(materialize) : "auto");

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

  console.log("This appears in the overlay");
  console.error("Errors are color-coded red");
  console.warn("Warnings appear in yellow");

  createRoot(renderer).render(
    createElement(TablensApp, {
      file: file || "SQL Query",
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
      materialize: {
        type: "string",
        short: "m",
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
  -m, --materialize <mode>
                    Materialization strategy: auto|always|never|lazy
                      auto: materialize if <400MB AND <10M rows (default)
                      always: always materialize to RAM (fast, memory intensive)
                      never: never materialize (slowest, lowest memory)
                      lazy: materialize on-demand when needed
  -h, --help        Show this help message

Keyboard shortcuts (in app):
  q/C-c              Quit
  j/k / arrows      Navigate
  /                  Search
  f                  Filter column (column mode)
  t                  Toggle column types
  i                  Toggle column stats
  s                  Save
  x                  Auto-resize columns
  e                  Rename column (column mode)
  d                  Delete column (column mode)
  u                  Unnest column (column mode)
  :                  Query editor
`);
    process.exit(0);
  }

  let query = values.query;
  let file = positionals[0];

  if (!file && !query) {
    file = "data.csv";
  }

  await launchTablens({ file, query, materialize: values.materialize });
}

function parseMaterializeMode(value: string): "always" | "never" | "auto" | "lazy" {
  const v = value.toLowerCase();
  if (v === "always" || v === "a") return "always";
  if (v === "never" || v === "n") return "never";
  if (v === "lazy" || v === "l") return "lazy";
  return "auto";
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
