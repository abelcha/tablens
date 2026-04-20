import { DuckDBInstance, DuckDBConnection } from "@duckdb/node-api";

export class DuckDBDataSource {
  private instance: DuckDBInstance | null = null;
  private conn: DuckDBConnection | null = null;
  private tableName: string = "data_table";
  private headers: string[] = [];
  private totalRows: number = 0;
  private rowIdCol: string = "__rowid";
  private currentSearchQuery: string | null = null;
  private currentSearchFlags: {
    useRegex: boolean;
    wholeWord: boolean;
    caseSensitive: boolean;
  } | null = null;
  private searchResultCount: number = 0;
  private isMaterialized: boolean = false;
  private filePath: string | null = null;
  private editedFilePath: string | null = null;
  private originalQuery: string | null = null;
  private autocompleteLoaded: boolean = false;
  private preUnnestQuery: string | null = null;

  constructor() { }

  private quoteIdent(ident: string): string {
    return `"${ident.replaceAll(`"`, `""`)}"`;
  }

  private sqlStringLiteral(value: string): string {
    return `'${value.replaceAll(`'`, `''`)}'`;
  }

  private escapeRegexLiteral(text: string): string {
    // Escape regex meta characters for DuckDB/RE2
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private formatDecimal(obj: Record<string, unknown>): string {
    const scale = Number(obj.scale);
    const value = obj.value as bigint | number;
    const str = typeof value === "bigint" ? value.toString() : String(value);
    if (!scale) return str;
    const neg = str.startsWith("-");
    const digits = neg ? str.slice(1) : str;
    const padded = digits.padStart(scale + 1, "0");
    const intPart = padded.slice(0, -scale);
    const fracPart = padded.slice(-scale);
    return `${neg ? "-" : ""}${intPart}.${fracPart}`;
  }

  private isDecimal(obj: Record<string, unknown>): boolean {
    return "width" in obj && "scale" in obj && "value" in obj;
  }

  private formatComplex(val: unknown): string {
    if (val === null || val === undefined) return "null";
    if (typeof val === "bigint") return val.toString();
    if (val instanceof Date) return val.toISOString().split("T")[0];
    if (typeof val === "string") return `"${val}"`;
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    if (typeof val !== "object") return String(val);
    const obj = val as Record<string, unknown>;
    // DuckDB DECIMAL → {width, scale, value}
    if (this.isDecimal(obj)) return this.formatDecimal(obj);
    // DuckDB Date32 → {days: number}
    if ("days" in obj && typeof obj.days === "number" && Object.keys(obj).length === 1) {
      const date = new Date(obj.days * 24 * 60 * 60 * 1000);
      return date.toISOString().split("T")[0];
    }
    // DuckDB STRUCT → {entries: Record<string, DuckDBValue>}
    if ("entries" in obj && obj.entries && typeof obj.entries === "object" && !Array.isArray(obj.entries)) {
      const entries = obj.entries as Record<string, unknown>;
      const parts = Object.entries(entries).map(([k, v]) => `${k}: ${this.formatComplex(v)}`);
      return `{${parts.join(", ")}}`;
    }
    // DuckDB LIST → {items: DuckDBValue[]}
    if ("items" in obj && Array.isArray(obj.items)) {
      return `[${(obj.items as unknown[]).map((v) => this.formatComplex(v)).join(", ")}]`;
    }
    // DuckDB MAP → {entries: [{key, value}, ...]}
    if ("entries" in obj && Array.isArray(obj.entries)) {
      const parts = (obj.entries as { key: unknown; value: unknown }[]).map(
        (e) => `${this.formatComplex(e.key)}: ${this.formatComplex(e.value)}`
      );
      return `{${parts.join(", ")}}`;
    }
    // Plain object fallback
    if (Array.isArray(val)) return `[${val.map((v) => this.formatComplex(v)).join(", ")}]`;
    const parts = Object.entries(obj).map(([k, v]) => `${k}: ${this.formatComplex(v)}`);
    return `{${parts.join(", ")}}`;
  }

  private valueToString(val: unknown): string {
    if (val === null || val === undefined) return "";
    if (typeof val === "bigint") return val.toString();
    if (val instanceof Date) return val.toISOString().split("T")[0];
    if (typeof val === "object") {
      const obj = val as Record<string, unknown>;
      // DuckDB DECIMAL → {width, scale, value}
      if (this.isDecimal(obj)) return this.formatDecimal(obj);
      // DuckDB Date32 returns {days: number} - convert to ISO date
      if ("days" in obj && typeof obj.days === "number" && Object.keys(obj).length === 1) {
        const date = new Date(obj.days * 24 * 60 * 60 * 1000);
        return date.toISOString().split("T")[0];
      }
      return this.formatComplex(val);
    }
    return String(val);
  }

  private buildMatchExpr(args: {
    colIdent: string;
    query: string;
    useRegex: boolean;
    wholeWord: boolean;
    caseSensitive: boolean;
  }): string {
    const { colIdent, query, useRegex, wholeWord, caseSensitive } = args;
    if (query.length === 0) return "false";

    // Regex path (either explicit regex mode, or whole-word requires regex)
    if (useRegex || wholeWord) {
      let pattern = useRegex ? query : this.escapeRegexLiteral(query);
      if (wholeWord) {
        pattern = `\\b(?:${pattern})\\b`;
      }
      if (!caseSensitive) {
        pattern = `(?i)${pattern}`;
      }
      return `regexp_matches(CAST(${colIdent} AS VARCHAR), ${this.sqlStringLiteral(pattern)})`;
    }

    // Plain substring
    if (caseSensitive) {
      return `instr(CAST(${colIdent} AS VARCHAR), ${this.sqlStringLiteral(query)}) > 0`;
    }
    return `instr(lower(CAST(${colIdent} AS VARCHAR)), lower(${this.sqlStringLiteral(query)})) > 0`;
  }

  async connect(args: string | { filePath?: string; query?: string }) {
    console.log({ args });
    this.instance = await DuckDBInstance.create();
    this.conn = await this.instance.connect();

    let sql = "";
    if (typeof args === "string") {
      this.filePath = args;
      sql = `SELECT * FROM '${args}'`;
    } else {
      this.filePath = args.filePath || null;
      this.originalQuery = args.query || null;
      sql = args.query || `SELECT * FROM '${args.filePath}'`;
    }
    sql = sql.replace('grid_mess_poids', 'import_cache.grid_mess_poids')

    const [...statements] = sql.split(";");
    if (statements.length > 1) {
      sql = statements.pop() as string
      console.log('RUNNING PRE STATEMENT', statements.slice(0, 1).join(';'))
      await this.conn.run(statements.slice(0, 1).join(';'))
    }
    // Create a view instead of a table to avoid full scans on connect
    // Especially important for large Parquet files where window functions (row_number)
    // would force a full scan of the dataset.
    await this.conn.run(`CREATE OR REPLACE VIEW ${this.tableName} AS ${sql}`);

    // Get headers and detect unsupported types (GEOMETRY, etc.)
    const descResult = await this.conn.run(`DESCRIBE ${this.tableName}`);
    const descRows = await descResult.getRows();
    const unsupportedCols = new Set<string>();
    for (const row of descRows) {
      const colName = String(row[0]);
      const colType = String(row[1]).toUpperCase();
      if (colType.includes("GEOMETRY") || colType === "WKB_BLOB" || colType.startsWith("UNKNOWN")) {
        unsupportedCols.add(colName);
      }
    }
    // Rebuild view with unsupported columns cast to a short hash
    if (unsupportedCols.size > 0) {
      const cols = descRows.map((row) => {
        const name = String(row[0]);
        if (unsupportedCols.has(name)) {
          return `CAST(${this.quoteIdent(name)} AS VARCHAR) AS ${this.quoteIdent(name)}`;
        }
        return this.quoteIdent(name);
      });
      await this.conn.run(`CREATE OR REPLACE VIEW ${this.tableName} AS SELECT ${cols.join(", ")} FROM (${sql})`);
    }

    const result = await this.conn.run(`SELECT * FROM ${this.tableName} LIMIT 0`);
    this.headers = result.columnNames().filter((h) => h !== this.rowIdCol);

    // Get total rows
    const countResult = await this.conn.run(`SELECT COUNT(*) as count FROM ${this.tableName}`);
    const countRows = await countResult.getRows();
    // DuckDB returns BigInt for count usually, cast to string or number
    const countVal = countRows[0] ? countRows[0][0] : 0;
    this.totalRows = Number(countVal);

    // Materialize into RAM table for fast scrolling/search
    await this.materialize();
  }

  private async materialize(): Promise<void> {
    if (!this.instance) return;
    try {
      const materializedName = `${this.tableName}_materialized`;
      await this.conn!.run(`DROP TABLE IF EXISTS ${materializedName}`);
      await this.conn!.run(`CREATE TABLE ${materializedName} AS SELECT * FROM ${this.tableName}`);
      await this.conn!.run(`CREATE OR REPLACE VIEW ${this.tableName} AS SELECT * FROM ${materializedName}`);
      this.isMaterialized = true;
    } catch (err) {
      console.error("Materialization failed:", err);
    }
  }

  getIsMaterialized(): boolean {
    return this.isMaterialized;
  }

  getHeaders(): string[] {
    return this.headers;
  }

  async getColumnTypes(): Promise<string[]> {
    if (!this.conn) return [];
    const result = await this.conn.run(`DESCRIBE ${this.tableName}`);
    const rows = await result.getRows();
    const typeMap = new Map<string, string>();
    for (const row of rows) {
      typeMap.set(String(row[0]), String(row[1]));
    }
    return this.headers.map((h) => typeMap.get(h) || "");
  }

  async getColumnStats(): Promise<string[]> {
    if (!this.conn) return [];
    const result = await this.conn.run(`SUMMARIZE ${this.tableName}`);
    const rows = await result.getRows();
    // columns: column_name(0), column_type(1), min(2), max(3), approx_unique(4),
    //          avg(5), std(6), q25(7), q50(8), q75(9), count(10), null_percentage(11)
    const statsMap = new Map<string, string>();
    for (const row of rows) {
      const name = String(row[0]);
      const approxUnique = Number(row[4]);
      const nullPct = parseFloat(String(row[11]));
      const uniqueStr = this.compactNumber(approxUnique);
      let stat = `d${uniqueStr}`;
      if (nullPct > 0) {
        const pctStr = nullPct < 1 ? "<1" : Math.round(nullPct).toString();
        stat += ` ∅${pctStr}%`;
      }
      statsMap.set(name, stat);
    }
    return this.headers.map((h) => statsMap.get(h) || "");
  }

  private compactNumber(n: number): string {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "b";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "m";
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
    return n.toString();
  }

  getTotalRows(): number {
    return this.totalRows;
  }

  async getRows(offset: number, limit: number): Promise<string[][]> {
    if (!this.conn) throw new Error("Not connected");

    const result = await this.conn.run(
      `SELECT ${this.headers.map((h) => this.quoteIdent(h)).join(", ")} FROM ${this.tableName} LIMIT ${limit} OFFSET ${offset}`,
    );
    const rows = await result.getRows();

    const stringRows: string[][] = [];
    // columnNames from this result should match headers, but safer to use known headers order if possible,
    // or just iterate index-based since SELECT * preserves order from VIEW

    for (const row of rows) {
      const stringRow: string[] = [];
      for (let i = 0; i < this.headers.length; i++) {
        stringRow.push(this.valueToString(row[i]));
      }
      stringRows.push(stringRow);
    }
    return stringRows;
  }

  async getRowsWithMatches(args: {
    offset: number;
    limit: number;
    query: string;
    useRegex: boolean;
    wholeWord: boolean;
    caseSensitive: boolean;
    restrictToColIndex?: number;
  }): Promise<{ rows: string[][]; matches: boolean[][] }> {
    const { offset, limit, query, useRegex, wholeWord, caseSensitive, restrictToColIndex } = args;
    if (!this.conn) throw new Error("Not connected");

    const colIdents = this.headers.map((h) => this.quoteIdent(h));
    const matchExprs =
      restrictToColIndex !== undefined
        ? colIdents.map((colIdent, i) =>
          i === restrictToColIndex
            ? this.buildMatchExpr({ colIdent, query, useRegex, wholeWord, caseSensitive })
            : "false",
        )
        : colIdents.map((colIdent) =>
          this.buildMatchExpr({ colIdent, query, useRegex, wholeWord, caseSensitive }),
        );

    const sql = `SELECT ${colIdents.join(", ")}, ${matchExprs
      .map((e, i) => `${e} AS ${this.quoteIdent(`__m${i}`)}`)
      .join(", ")} FROM ${this.tableName} LIMIT ${limit} OFFSET ${offset}`;

    const result = await this.conn.run(sql);
    const rows = await result.getRows();

    const stringRows: string[][] = [];
    const matches: boolean[][] = [];

    for (const row of rows) {
      const stringRow: string[] = [];
      const matchRow: boolean[] = [];
      for (let i = 0; i < this.headers.length; i++) {
        stringRow.push(this.valueToString(row[i]));
      }
      for (let i = 0; i < this.headers.length; i++) {
        matchRow.push(Boolean(row[this.headers.length + i]));
      }
      stringRows.push(stringRow);
      matches.push(matchRow);
    }

    return { rows: stringRows, matches };
  }

  async applySearch(args: {
    query: string;
    useRegex: boolean;
    wholeWord: boolean;
    caseSensitive: boolean;
  }): Promise<number | null> {
    const { query, useRegex, wholeWord, caseSensitive } = args;
    if (!this.conn) throw new Error("Not connected");

    if (query.length === 0) {
      this.currentSearchQuery = null;
      this.currentSearchFlags = null;
      this.searchResultCount = 0;
      await this.conn.run(`DROP TABLE IF EXISTS search_results`);
      return null;
    }

    const colIdents = this.headers.map((h) => this.quoteIdent(h));
    const matchExprs = colIdents.map((colIdent) =>
      this.buildMatchExpr({ colIdent, query, useRegex, wholeWord, caseSensitive }),
    );

    const rowMatchExpr = matchExprs.join(" OR ");

    // Materialize the search results including match markers
    // We use a TABLE here so scrolling is instant (no re-calculation)
    const sql = `CREATE OR REPLACE TEMP TABLE search_results AS 
      SELECT ${colIdents.join(", ")}, 
      ${matchExprs.map((e, i) => `${e} AS ${this.quoteIdent(`__m${i}`)}`).join(", ")}
      FROM ${this.tableName} 
      WHERE ${rowMatchExpr}`;

    const conn = this.conn;
    if (!conn) throw new Error("Not connected");

    await conn.run(sql);

    const countResult = await conn.run(`SELECT COUNT(*) FROM search_results`);
    const countRows = await countResult.getRows();
    const resultCount = countRows[0] && countRows[0][0] !== undefined ? Number(countRows[0][0]) : 0;
    this.searchResultCount = resultCount;
    this.currentSearchQuery = query;
    this.currentSearchFlags = { useRegex, wholeWord, caseSensitive };

    return this.searchResultCount;
  }

  async getMatchingRowsWithMatches(args: {
    offset: number;
    limit: number;
    query: string;
    useRegex: boolean;
    wholeWord: boolean;
    caseSensitive: boolean;
  }): Promise<{ rows: string[][]; matches: boolean[][] }> {
    const { offset, limit, query } = args;
    if (!this.conn) throw new Error("Not connected");

    if (query.length === 0) {
      const rows = await this.getRows(offset, limit);
      const matches = rows.map((r) => r.map(() => false));
      return { rows, matches };
    }

    // If the query matches our materialized table, use it for instant pagination
    const isApplied =
      query === this.currentSearchQuery &&
      this.currentSearchFlags?.useRegex === args.useRegex &&
      this.currentSearchFlags?.wholeWord === args.wholeWord &&
      this.currentSearchFlags?.caseSensitive === args.caseSensitive;

    const targetTable = isApplied ? "search_results" : this.tableName;

    const colIdents = this.headers.map((h) => this.quoteIdent(h));

    // If using the materialized table Jeter markers are already computed as __m0, __m1...
    const matchExprs = isApplied
      ? this.headers.map((_, i) => this.quoteIdent(`__m${i}`))
      : this.headers.map((h) =>
        this.buildMatchExpr({
          colIdent: this.quoteIdent(h),
          query,
          useRegex: args.useRegex,
          wholeWord: args.wholeWord,
          caseSensitive: args.caseSensitive,
        }),
      );

    const whereClause = isApplied ? "" : ` WHERE ${matchExprs.join(" OR ")}`;

    const sql = `SELECT ${colIdents.join(", ")}, ${matchExprs.join(", ")} 
      FROM ${targetTable}${whereClause} 
      LIMIT ${limit} OFFSET ${offset}`;

    const result = await this.conn.run(sql);
    const rows = await result.getRows();

    const stringRows: string[][] = [];
    const matches: boolean[][] = [];

    for (const row of rows) {
      const stringRow: string[] = [];
      const matchRow: boolean[] = [];
      for (let i = 0; i < this.headers.length; i++) {
        stringRow.push(this.valueToString(row[i]));
      }
      for (let i = 0; i < this.headers.length; i++) {
        matchRow.push(Boolean(row[this.headers.length + i]));
      }
      stringRows.push(stringRow);
      matches.push(matchRow);
    }

    return { rows: stringRows, matches };
  }

  async applySort(args: { column: string; direction: "asc" | "desc" }): Promise<void> {
    const { column, direction } = args;
    if (!this.conn) throw new Error("Not connected");

    const materializedName = `${this.tableName}_materialized`;
    const colIdent = this.quoteIdent(column);
    const dirSql = direction.toUpperCase();

    // Re-materialize the table with the new sort order
    // This allows fast scrolling/pagination via CREATE TABLE AS SELECT ... ORDER BY
    await this.conn.run(`CREATE OR REPLACE TABLE ${materializedName} AS 
      SELECT * FROM ${materializedName} 
      ORDER BY ${colIdent} ${dirSql}`);

    // Update the view to point to the newly sorted materialized table
    await this.conn.run(
      `CREATE OR REPLACE VIEW ${this.tableName} AS SELECT * FROM ${materializedName}`,
    );

    // If search was applied, it will need to be re-applied against the new sort order
    // by the caller (index.tsx)
  }

  async close() {
    this.conn = null;
    this.instance = null;
  }

  getFilePath(): string | null {
    return this.filePath;
  }

  getQuery(): string {
    return this.originalQuery || `FROM '${this.filePath}'`;
  }

  async runQuery(sql: string): Promise<void> {
    if (!this.conn) throw new Error("Not connected");

    this.isMaterialized = false;

    // Create a new view with the query
    await this.conn.run(`CREATE OR REPLACE VIEW ${this.tableName} AS ${sql}`);
    this.originalQuery = sql;

    // Update headers
    const result = await this.conn.run(`SELECT * FROM ${this.tableName} LIMIT 0`);
    this.headers = result.columnNames().filter((h) => h !== this.rowIdCol);

    // Update total rows
    const countResult = await this.conn.run(`SELECT COUNT(*) as count FROM ${this.tableName}`);
    const countRows = await countResult.getRows();
    const countVal = countRows[0] ? countRows[0][0] : 0;
    this.totalRows = Number(countVal);

    // Re-materialize
    await this.materialize();
  }


  async renameColumn(oldName: string, newName: string): Promise<void> {
    if (!this.conn) throw new Error("Not connected");
    if (!this.isMaterialized) throw new Error("Cannot rename before materialization");

    const materializedName = `${this.tableName}_materialized`;

    // Rename in materialized table
    await this.conn.run(
      `ALTER TABLE ${materializedName} RENAME COLUMN ${this.quoteIdent(oldName)} TO ${this.quoteIdent(newName)}`
    );
    // Update view
    await this.conn.run(`CREATE OR REPLACE VIEW ${this.tableName} AS SELECT * FROM ${materializedName}`);

    // Update internal headers
    this.headers = this.headers.map((h) => (h === oldName ? newName : h));
  }

  hasUnnestHistory(): boolean {
    return this.preUnnestQuery !== null;
  }

  async resetUnnest(): Promise<void> {
    if (!this.preUnnestQuery || !this.conn) return;
    const query = this.preUnnestQuery;
    this.preUnnestQuery = null;
    await this.runQuery(query);
  }

  // Parse top-level field names from a STRUCT type string like "STRUCT(age INTEGER, city VARCHAR)"
  private parseStructFields(typeStr: string): string[] {
    // Extract the content inside STRUCT(...)
    const match = typeStr.match(/^STRUCT\((.+)\)$/i);
    if (!match) return [];
    const inner = match[1];
    if (!inner) return [];
    // Walk through, splitting on commas at depth 0 (skip quoted strings)
    const fields: string[] = [];
    let depth = 0;
    let start = 0;
    let inQuote = false;
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '"') { inQuote = !inQuote; continue; }
      if (inQuote) continue;
      if (inner[i] === "(" || inner[i] === "[") depth++;
      else if (inner[i] === ")" || inner[i] === "]") depth--;
      else if (inner[i] === "," && depth === 0) {
        fields.push(inner.substring(start, i).trim().split(/\s+/)[0]);
        start = i + 1;
      }
    }
    fields.push(inner.substring(start).trim().split(/\s+/)[0]);
    // Strip surrounding quotes from field names (DuckDB quotes reserved words like "value")
    return fields.map((f) => f.replace(/^"(.*)"$/, "$1"));
  }

  async unnestColumn(colName: string): Promise<{ newColCount: number }> {
    if (!this.conn) throw new Error("Not connected");

    // Save the pre-unnest query on first unnest so Shift+U can restore it
    if (!this.preUnnestQuery) {
      this.preUnnestQuery = this.originalQuery || `SELECT * FROM '${this.filePath}'`;
    }

    const col = this.quoteIdent(colName);
    const materializedName = `${this.tableName}_materialized`;
    const sourceTable = this.isMaterialized ? materializedName : this.tableName;

    // Get the column type to decide unnest strategy
    const descResult = await this.conn.run(`DESCRIBE ${sourceTable}`);
    const descRows = await descResult.getRows();
    let colType = "";
    for (const row of descRows) {
      if (String(row[0]) === colName) {
        colType = String(row[1]);
        break;
      }
    }

    const isStruct = colType.toUpperCase().startsWith("STRUCT");
    const tmpName = `__unnest_tmp`;

    if (isStruct) {
      // Parse struct field names from type string
      const fields = this.parseStructFields(colType);

      // Build SELECT with unnested fields in place, prefixed with parent name
      const selectParts: string[] = [];
      for (const h of this.headers) {
        if (h === colName) {
          for (const field of fields) {
            selectParts.push(`${col}.${this.quoteIdent(field)} AS ${this.quoteIdent(`${colName}.${field}`)}`);
          }
        } else {
          selectParts.push(this.quoteIdent(h));
        }
      }
      const selectSql = `SELECT ${selectParts.join(", ")} FROM ${sourceTable}`;

      await this.conn.run(`CREATE OR REPLACE TABLE ${tmpName} AS ${selectSql}`);
      await this.conn.run(`DROP TABLE IF EXISTS ${materializedName}`);
      await this.conn.run(`ALTER TABLE ${tmpName} RENAME TO ${materializedName}`);
      await this.conn.run(`CREATE OR REPLACE VIEW ${this.tableName} AS SELECT * FROM ${materializedName}`);

      this.isMaterialized = true;

      const result = await this.conn.run(`SELECT * FROM ${this.tableName} LIMIT 0`);
      this.headers = result.columnNames().filter((h) => h !== this.rowIdCol);

      const countResult = await this.conn.run(`SELECT COUNT(*) as count FROM ${this.tableName}`);
      const countRows = await countResult.getRows();
      this.totalRows = Number(countRows[0] ? countRows[0][0] : 0);

      return { newColCount: fields.length };
    } else {
      // List/Array: column stays in place, rows expand
      const selectParts = this.headers.map((h) =>
        h === colName ? `UNNEST(${col}) AS ${col}` : this.quoteIdent(h)
      );
      const selectSql = `SELECT ${selectParts.join(", ")} FROM ${sourceTable}`;

      await this.conn.run(`CREATE OR REPLACE TABLE ${tmpName} AS ${selectSql}`);
      await this.conn.run(`DROP TABLE IF EXISTS ${materializedName}`);
      await this.conn.run(`ALTER TABLE ${tmpName} RENAME TO ${materializedName}`);
      await this.conn.run(`CREATE OR REPLACE VIEW ${this.tableName} AS SELECT * FROM ${materializedName}`);

      this.isMaterialized = true;

      const result = await this.conn.run(`SELECT * FROM ${this.tableName} LIMIT 0`);
      this.headers = result.columnNames().filter((h) => h !== this.rowIdCol);

      const countResult = await this.conn.run(`SELECT COUNT(*) as count FROM ${this.tableName}`);
      const countRows = await countResult.getRows();
      this.totalRows = Number(countRows[0] ? countRows[0][0] : 0);

      return { newColCount: 1 };
    }
  }

  async deleteColumn(colName: string): Promise<void> {
    if (!this.conn) throw new Error("Not connected");
    if (!this.isMaterialized) throw new Error("Cannot delete column before materialization");
    if (this.headers.length <= 1) throw new Error("Cannot delete last column");

    const materializedName = `${this.tableName}_materialized`;

    await this.conn.run(
      `ALTER TABLE ${materializedName} DROP COLUMN ${this.quoteIdent(colName)}`
    );
    await this.conn.run(`CREATE OR REPLACE VIEW ${this.tableName} AS SELECT * FROM ${materializedName}`);

    this.headers = this.headers.filter((h) => h !== colName);
  }

  async saveToFile(outPath: string): Promise<void> {
    if (!this.conn) throw new Error("Not connected");
    if (!this.isMaterialized) throw new Error("Cannot save before materialization");

    const materializedName = `${this.tableName}_materialized`;
    const ext = outPath.match(/\.[^.]+$/)?.[0]?.toLowerCase() || "";

    if (ext === ".parquet") {
      await this.conn.run(`COPY ${materializedName} TO '${outPath}' (FORMAT PARQUET)`);
    } else if (ext === ".csv") {
      await this.conn.run(`COPY ${materializedName} TO '${outPath}' (FORMAT CSV, HEADER)`);
    } else if (ext === ".json") {
      await this.conn.run(`COPY ${materializedName} TO '${outPath}' (FORMAT JSON, ARRAY TRUE)`);
    } else {
      throw new Error(`Unsupported format: ${ext}`);
    }

    console.log(`Saved to ${outPath}`);
  }

  suggestSavePath(): string {
    // Try filePath first
    if (this.filePath && /\.(parquet|csv|json|tsv)$/i.test(this.filePath)) {
      const ext = this.filePath.match(/\.(parquet|csv|json|tsv)$/i)![0];
      const base = this.filePath.slice(0, -ext.length);
      return `${base}.edited${ext}`;
    }

    // Try to extract from query
    const query = this.originalQuery || this.filePath || "";
    const match = query.match(/['"]([^'"]+\.(parquet|csv|json|tsv))['"]/i);
    if (match) {
      const path = match[1];
      const ext = "." + match[2];
      const base = path.slice(0, -ext.length);
      return `${base}.edited${ext}`;
    }

    return "output.parquet";
  }

  /**
   * Get autocomplete suggestions using DuckDB's sql_auto_complete function
   */
  async getAutocompleteSuggestions(sql: string): Promise<{ suggestion: string; suggestionStart: number }[]> {
    if (!this.conn) return [];

    try {
      // Install and load autocomplete extension once
      if (!this.autocompleteLoaded) {
        await this.conn.run("INSTALL autocomplete");
        await this.conn.run("LOAD autocomplete");
        this.autocompleteLoaded = true;
      }

      // Escape single quotes in the SQL for the function call
      const escapedSql = sql.replace(/'/g, "''");
      const result = await this.conn.run(
        `SELECT suggestion, suggestion_start FROM sql_auto_complete('${escapedSql}')`
      );
      const rows = await result.getRows();

      return rows.map((row) => ({
        suggestion: String(row[0]),
        suggestionStart: Number(row[1]),
      }));
    } catch (err) {
      // Autocomplete may fail for incomplete queries - that's fine
      return [];
    }
  }
}
