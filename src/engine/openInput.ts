import type { EngineInput } from "./types";

export function buildEngineInput(file: string, query?: string) {
  const sqlForFile =
    query && query.trim().length > 0
      ? query.trim()
      : /\.json$/i.test(file)
        ? `SELECT * FROM read_json_auto('${file.replaceAll("'", "''")}')`
        : /\.(csv|tsv)$/i.test(file)
          ? `SELECT * FROM read_csv_auto('${file.replaceAll("'", "''")}')`
          : `SELECT * FROM read_parquet('${file.replaceAll("'", "''")}')`;

  return (
    query && query.trim().length > 0
      ? { kind: "query", sql: query }
      : /\.json$/i.test(file)
        ? { kind: "query", sql: sqlForFile }
        : /\.(csv|tsv)$/i.test(file)
          ? { kind: "csv", path: file }
          : { kind: "parquet", path: file }
  ) as EngineInput;
}
