#!/usr/bin/env -S bun run
import { createElement } from "react";
import { parseArgs } from "node:util";
import { ConsolePosition, createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { DuckDBDataSource } from "src/data/source";
import { TablensApp } from "src/index";

export async function launchTablens(options: { file?: string; query?: string }) {
  const { file, query } = options;
  const source = new DuckDBDataSource();

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
    },
    allowPositionals: true,
  });

  let query = values.query;
  let file = positionals[0];

  if (!file && !query) {
    file = "data.csv";
  }

  await launchTablens({ file, query });
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
