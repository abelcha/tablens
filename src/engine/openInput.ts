import type { EngineInput } from "./types";

export function buildEngineInput(file: string, query?: string) {
  if (query && query.trim().length > 0) {
    return { kind: "query", sql: query } as EngineInput;
  }

  const isParquet = /\.parquet$/i.test(file);
  return isParquet
    ? ({ kind: "parquet", path: file } as EngineInput)
    : ({ kind: "file", path: file } as EngineInput);
}
