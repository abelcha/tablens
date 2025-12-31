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
    this.instance = await DuckDBInstance.create();
    this.conn = await this.instance.connect();

    let sql = "";
    if (typeof args === "string") {
      sql = `SELECT * FROM '${args}'`;
    } else {
      sql = args.query || `SELECT * FROM '${args.filePath}'`;
    }

    // Create a view instead of a table to avoid full scans on connect
    // Especially important for large Parquet files where window functions (row_number)
    // would force a full scan of the dataset.
    await this.conn.run(
      `CREATE OR REPLACE VIEW ${this.tableName} AS ${sql}`,
    );

    // Get headers
    const result = await this.conn.run(`SELECT * FROM ${this.tableName} LIMIT 0`);
    this.headers = result.columnNames().filter((h) => h !== this.rowIdCol);

    // Get total rows
    const countResult = await this.conn.run(`SELECT COUNT(*) as count FROM ${this.tableName}`);
    const countRows = await countResult.getRows();
    // DuckDB returns BigInt for count usually, cast to string or number
    const countVal = countRows[0] ? countRows[0][0] : 0;
    this.totalRows = Number(countVal);

    // Background materialization: Load the full thing into RAM as a table
    // so subsequent searches and scrolling are fast, while the first row
    // is shown immediately via the view.
    const instance = this.instance;
    const tableName = this.tableName;
    (async () => {
      if (!instance) return;
      try {
        const bgConn = await instance.connect();
        const materializedName = `${tableName}_materialized`;
        await bgConn.run(`CREATE TABLE ${materializedName} AS SELECT * FROM ${tableName}`);
        await bgConn.run(`CREATE OR REPLACE VIEW ${tableName} AS SELECT * FROM ${materializedName}`);
        this.isMaterialized = true;
      } catch (err) {
        // If background materialization fails (e.g. out of memory), 
        // we still have the view to fall back on.
        console.error("Background materialization failed:", err);
      }
    })();
  }

  getIsMaterialized(): boolean {
    return this.isMaterialized;
  }

  getHeaders(): string[] {
    return this.headers;
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
        const val = row[i];
        if (val === null || val === undefined) {
          stringRow.push("");
        } else {
          stringRow.push(String(val));
        }
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
        : colIdents.map((colIdent) => this.buildMatchExpr({ colIdent, query, useRegex, wholeWord, caseSensitive }));

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
        const val = row[i];
        stringRow.push(val === null || val === undefined ? "" : String(val));
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
        stringRow.push(row[i] === null || row[i] === undefined ? "" : String(row[i]));
      }
      for (let i = 0; i < this.headers.length; i++) {
        matchRow.push(Boolean(row[this.headers.length + i]));
      }
      stringRows.push(stringRow);
      matches.push(matchRow);
    }

    return { rows: stringRows, matches };
  }

  async close() {
    this.conn = null;
    this.instance = null;
  }
}
