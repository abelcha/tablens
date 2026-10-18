// runs DuckDB through bun:sqlite + duckdb-bun-shim off the main thread
import { Database } from "bun:sqlite";
import shim from "duckdb-bun-shim";

Database.setCustomSQLite(shim);
const db = new Database(":memory:");

// bun:sqlite only runs the first statement of a query, so split on top-level `;`
function splitStatements(sql: string) {
  const out: string[] = [];
  let start = 0;
  let quote = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "-" && sql[i + 1] === "-") i = sql.indexOf("\n", i) === -1 ? sql.length : sql.indexOf("\n", i);
    else if (c === ";") {
      out.push(sql.slice(start, i));
      start = i + 1;
    }
  }
  out.push(sql.slice(start));
  // comment-only statements segfault the shim
  return out.filter((s) => s.replace(/--.*$/gm, "").trim());
}

self.onmessage = ({ data: { id, sql } }) => {
  try {
    const statements = splitStatements(sql);
    const last = statements.pop();
    for (const s of statements) db.run(s);
    if (!last) return postMessage({ id, columns: [], rows: [] });
    const stmt = db.query(last);
    const rows = stmt.values();
    postMessage({ id, columns: stmt.columnNames, rows });
  } catch (err) {
    postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
