import { openSync, readSync, closeSync } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";
import type { SqlExecutor } from "./types";

export const DB_ALIAS = "tablens_db";

/** Header sniff — extension is a hint, the magic bytes are the truth. */
export type DbFlavor = "sqlite" | "duckdb" | null;

export function sniffDbFlavor(path: string): DbFlavor {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(16);
    if (readSync(fd, buf, 0, 16, 0) < 16) return null;
    if (buf.toString("latin1", 0, 15) === "SQLite format 3") return "sqlite";
    if (buf.toString("latin1", 8, 12) === "DUCK") return "duckdb";
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

const literal = (value: string) => `'${value.replaceAll(`'`, `''`)}'`;

/** ATTACH a SQLite or DuckDB file read-only under `alias`. */
export async function attachDatabase(
  executor: SqlExecutor,
  path: string,
  alias: string,
): Promise<DbFlavor> {
  const flavor = sniffDbFlavor(path);
  if (!flavor) throw new Error(`Not a SQLite or DuckDB database: ${path}`);
  if (flavor === "sqlite") {
    await executor.run(`INSTALL sqlite; LOAD sqlite;`);
  }
  const opts = flavor === "sqlite" ? "TYPE SQLITE, READ_ONLY" : "READ_ONLY";
  await executor.run(`ATTACH ${literal(path)} AS ${alias} (${opts})`);
  return flavor;
}

/**
 * List table + view names in a SQLite/DuckDB file. Uses a throwaway in-memory
 * DuckDB so the tree can list tables without owning a long-lived connection.
 */
export async function listDbTables(path: string): Promise<string[]> {
  const instance = await DuckDBInstance.create();
  const connection = await instance.connect();
  const executor = { run: (sql: string) => connection.run(sql) } as unknown as SqlExecutor;
  try {
    await attachDatabase(executor, path, DB_ALIAS);
    const result = await connection.run(
      `SELECT table_name FROM duckdb_tables() WHERE database_name = ${literal(DB_ALIAS)}
       UNION ALL
       SELECT view_name FROM duckdb_views() WHERE database_name = ${literal(DB_ALIAS)}
       ORDER BY 1`,
    );
    const rows = await result.getRows();
    return rows.map((row) => String(row[0]));
  } finally {
    connection.closeSync?.();
  }
}
