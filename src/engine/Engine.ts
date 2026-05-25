import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { appendFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import type {
  ColumnDistributionRequest,
  ColumnDistributionResult,
  ColumnFilter,
  EngineInput,
  EngineSchema,
  ExportRequest,
  FilterOperator,
  FilterQuery,
  FilterValue,
  PageRequest,
  PageResult,
  QueryResult,
  SearchSpec,
  SortSpec,
  SourceFingerprint,
  SqlExecutor,
  TablensEngine,
  ViewHandle,
  ViewHashInput,
  ViewSpec,
} from "./types";

/**
 * ## Tablens storage model (read this before changing buildView / getPage)
 *
 * We deliberately do **NOT** materialize full row payloads into DuckDB indexed views.
 *
 * ### What we store per view (`buildView`)
 * Only `file_row_number` — an integer row id from `read_parquet(..., file_row_number=true)`.
 * The indexed table is a **filtered/sorted list of row ids**, not a copy of cell values.
 *
 * ### How we load a page (`getPage`)
 * 1. `LIMIT/OFFSET` on the small indexed table (cheap: one integer column).
 * 2. `JOIN read_parquet(...) USING (file_row_number)` to hydrate **just that window** of rows.
 *
 * DuckDB can scan parquet by row group; joining on `file_row_number` keeps IO proportional to the
 * page size, not the whole file.
 *
 * ### Why NOT `CREATE TABLE indexed AS SELECT p.*` (materialize all columns)
 * We tried this for scroll perf. On large files (e.g. multi‑GB parquet) it caused:
 * - **Init regression**: `duckdb:3` jumped from ~milliseconds to **seconds** (full copy on open).
 * - **Memory/disk blow-up**: duplicate of every column for every filtered row in the temp DB.
 * - Marginal scroll win that does not justify destroying startup; scroll is handled in the UI layer
 *   via `PageWindowCache` + `trySyncViewportPatch` instead.
 *
 * **Do not reintroduce full-row materialization** without measuring init on a large parquet and
 * getting explicit product sign-off. Future LLMs/agents: if you see slow scroll, fix caching /
 * viewport coalescing first — not `SELECT p.*` into indexed tables.
 *
 * ### `file_row_number=true` is required everywhere
 * All parquet reads that participate in the join must use the same option so ids align with the
 * indexed table. Breaking this breaks pagination silently (wrong rows) or kills the join plan.
 *
 * ### View cache (`viewCache`)
 * `buildView` is keyed by filter/sort/search hash. Rebuild only when the view spec changes, not on
 * every scroll. `getPage` always reuses the handle; it must stay a row-id index, not a data table.
 */

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function hashViewInput(input: ViewHashInput): string {
  return createHash("sha1").update(stableStringify(input)).digest("hex").slice(0, 16);
}

class DuckDBSqlExecutor implements SqlExecutor {
  private nextQueryId = 0;

  constructor(private readonly connection: DuckDBConnection) {}

  private log(sql: string): void {
    try {
      appendFileSync(
        ".log",
        `[${new Date().toISOString()}]\n${sql.trim()}\n\n`,
        "utf8",
      );
    } catch {
      // ignore logging failures
    }
  }

  async run(sql: string): Promise<QueryResult> {
    const queryId = ++this.nextQueryId;
    const label = `duckdb:${queryId}`;
    console.time(label);
    this.log(sql);
    try {
      const result = await this.connection.run(sql);
      return {
        columns: result.columnNames(),
        rows: await result.getRows(),
      };
    } finally {
      console.timeEnd(label);
    }
  }
}

export class Engine implements TablensEngine {
  private instance: DuckDBInstance | null = null;
  private connection: DuckDBConnection | null = null;
  private executor: SqlExecutor | null = null;
  private tempDir: string | null = null;
  private tempParquetPath: string | null = null;
  private ownsActiveParquet = false;
  private activeParquetPath = "";
  private sourceFingerprint: SourceFingerprint | null = null;
  private schema: EngineSchema | null = null;
  private sourceColumns: string[] = [];
  private sourceColumnTypes: string[] = [];
  private currentViewSpec: ViewSpec = { sort: [], filter: {}, search: null };
  private currentViewHandle: ViewHandle | null = null;
  private viewCache = new Map<string, ViewHandle>();
  private currentSourceQuery: string | null = null;
  private autocompleteLoaded = false;

  private quoteIdent(ident: string): string {
    return `"${ident.replaceAll(`"`, `""`)}"`;
  }

  private sqlLiteral(value: string): string {
    return `'${value.replaceAll(`'`, `''`)}'`;
  }

  private ensureReady(): void {
    if (!this.executor || !this.schema || !this.sourceFingerprint) {
      throw new Error("Engine is not open");
    }
  }

  /** Parquet source with stable row ids — must match indexed table + getPage join (see module doc). */
  private getSourceSelectSql(): string {
    return `SELECT * FROM read_parquet(${this.sqlLiteral(this.activeParquetPath)}, file_row_number=true)`;
  }

  private normalizeQuerySql(sql: string): string {
    const trimmed = sql.trim().replace(/;+\s*$/, "");
    if (!trimmed) return "SELECT 1 WHERE FALSE";
    if (/^from\s+/i.test(trimmed)) return `SELECT * ${trimmed}`;
    return trimmed;
  }

  private getTempDir(): string {
    if (this.tempDir) return this.tempDir;
    this.tempDir = mkdtempSync(join(tmpdir(), "tablens-engine-"));
    return this.tempDir;
  }

  private async getFileSize(path: string): Promise<number> {
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  }

  private isDecimalValue(obj: Record<string, unknown>): boolean {
    return "width" in obj && "scale" in obj && "value" in obj;
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

  private formatComplex(val: unknown): string {
    if (val === null || val === undefined) return "null";
    if (typeof val === "bigint") return val.toString();
    if (val instanceof Date) return val.toISOString().split("T")[0] || "";
    if (typeof val === "string") return `"${val}"`;
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    if (typeof val !== "object") return String(val);
    const obj = val as Record<string, unknown>;
    if (this.isDecimalValue(obj)) return this.formatDecimal(obj);
    if ("days" in obj && typeof obj.days === "number" && Object.keys(obj).length === 1) {
      const date = new Date((obj.days as number) * 24 * 60 * 60 * 1000);
      return date.toISOString().split("T")[0] || "";
    }
    if ("micros" in obj && Object.keys(obj).length === 1) {
      const micros = typeof obj.micros === "bigint" ? obj.micros : BigInt(obj.micros as number);
      const ms = Number(micros / 1000n);
      const date = new Date(ms);
      return date.toISOString().replace("T", " ").replace(/\.000Z$/, "").replace(/Z$/, "");
    }
    if ("entries" in obj && obj.entries && typeof obj.entries === "object" && !Array.isArray(obj.entries)) {
      const entries = obj.entries as Record<string, unknown>;
      const parts = Object.entries(entries).map(([key, entry]) => `${key}: ${this.formatComplex(entry)}`);
      return `{${parts.join(", ")}}`;
    }
    if ("items" in obj && Array.isArray(obj.items)) {
      return `[${(obj.items as unknown[]).map((entry) => this.formatComplex(entry)).join(", ")}]`;
    }
    if ("entries" in obj && Array.isArray(obj.entries)) {
      const parts = (obj.entries as { key: unknown; value: unknown }[]).map(
        (entry) => `${this.formatComplex(entry.key)}: ${this.formatComplex(entry.value)}`,
      );
      return `{${parts.join(", ")}}`;
    }
    if (Array.isArray(val)) return `[${val.map((entry) => this.formatComplex(entry)).join(", ")}]`;
    return `{${Object.entries(obj)
      .map(([key, entry]) => `${key}: ${this.formatComplex(entry)}`)
      .join(", ")}}`;
  }

  private valueToString(val: unknown): string {
    if (val === null || val === undefined) return "";
    if (typeof val === "bigint") return val.toString();
    if (val instanceof Date) return val.toISOString().split("T")[0] || "";
    if (typeof val === "object") {
      const obj = val as Record<string, unknown>;
      if (this.isDecimalValue(obj)) return this.formatDecimal(obj);
      if ("days" in obj && typeof obj.days === "number" && Object.keys(obj).length === 1) {
        const date = new Date((obj.days as number) * 24 * 60 * 60 * 1000);
        return date.toISOString().split("T")[0] || "";
      }
      if ("micros" in obj && Object.keys(obj).length === 1) {
        const micros = typeof obj.micros === "bigint" ? obj.micros : BigInt(obj.micros as number);
        const ms = Number(micros / 1000n);
        const date = new Date(ms);
        return date.toISOString().replace("T", " ").replace(/\.000Z$/, "").replace(/Z$/, "");
      }
      return this.formatComplex(val);
    }
    return String(val);
  }

  private sqlValue(value: FilterValue): string {
    if (value === null) return "NULL";
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
    return this.sqlLiteral(value);
  }

  private buildSingleFilterExpr(column: string, filter: ColumnFilter): string {
    const col = this.quoteIdent(column);
    if (filter === null || typeof filter !== "object" || Array.isArray(filter)) {
      return filter === null ? `${col} IS NULL` : `${col} = ${this.sqlValue(filter as FilterValue)}`;
    }

    const ops = filter as FilterOperator;
    const parts: string[] = [];

    if (ops.$eq !== undefined) {
      parts.push(ops.$eq === null ? `${col} IS NULL` : `${col} = ${this.sqlValue(ops.$eq)}`);
    }
    if (ops.$ne !== undefined) {
      parts.push(ops.$ne === null ? `${col} IS NOT NULL` : `${col} <> ${this.sqlValue(ops.$ne)}`);
    }
    if (ops.$in !== undefined) {
      if (ops.$in.length === 0) {
        parts.push("FALSE");
      } else {
        const values = ops.$in.map((value) => this.sqlValue(value)).join(", ");
        parts.push(`${col} IN (${values})`);
      }
    }
    if (ops.$nin !== undefined) {
      if (ops.$nin.length === 0) {
        parts.push("TRUE");
      } else {
        const values = ops.$nin.map((value) => this.sqlValue(value)).join(", ");
        parts.push(`${col} NOT IN (${values})`);
      }
    }
    if (ops.$gt !== undefined) parts.push(`${col} > ${this.sqlValue(ops.$gt)}`);
    if (ops.$gte !== undefined) parts.push(`${col} >= ${this.sqlValue(ops.$gte)}`);
    if (ops.$lt !== undefined) parts.push(`${col} < ${this.sqlValue(ops.$lt)}`);
    if (ops.$lte !== undefined) parts.push(`${col} <= ${this.sqlValue(ops.$lte)}`);
    if (ops.$like !== undefined) parts.push(`CAST(${col} AS VARCHAR) LIKE ${this.sqlLiteral(ops.$like)}`);
    if (ops.$ilike !== undefined) parts.push(`CAST(${col} AS VARCHAR) ILIKE ${this.sqlLiteral(ops.$ilike)}`);
    if (ops.$similarTo !== undefined) {
      parts.push(`CAST(${col} AS VARCHAR) SIMILAR TO ${this.sqlLiteral(ops.$similarTo)}`);
    }
    if (ops.$regex !== undefined) {
      parts.push(`regexp_matches(CAST(${col} AS VARCHAR), ${this.sqlLiteral(ops.$regex)})`);
    }
    if (ops.$isNull !== undefined) {
      parts.push(ops.$isNull ? `${col} IS NULL` : `${col} IS NOT NULL`);
    }

    return parts.length > 0 ? `(${parts.join(" AND ")})` : "TRUE";
  }

  private buildFilterClause(filter: FilterQuery): string {
    const parts: string[] = [];
    for (const [column, value] of Object.entries(filter)) {
      parts.push(this.buildSingleFilterExpr(column, value));
    }
    return parts.length > 0 ? parts.join(" AND ") : "TRUE";
  }

  private escapeRegexLiteral(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private buildSearchPattern(search: SearchSpec): string {
    const base = search.useRegex ? search.query : this.escapeRegexLiteral(search.query);
    const wrapped = search.wholeWord ? `\\b(?:${base})\\b` : base;
    return search.caseSensitive ? wrapped : `(?i)${wrapped}`;
  }

  private buildSearchExpr(column: string, search: SearchSpec): string {
    if (search.query.length === 0) return "FALSE";
    const col = this.quoteIdent(column);
    if (!search.useRegex && !search.wholeWord) {
      if (search.caseSensitive) {
        return `instr(CAST(${col} AS VARCHAR), ${this.sqlLiteral(search.query)}) > 0`;
      }
      return `instr(lower(CAST(${col} AS VARCHAR)), lower(${this.sqlLiteral(search.query)})) > 0`;
    }
    return `regexp_matches(CAST(${col} AS VARCHAR), ${this.sqlLiteral(this.buildSearchPattern(search))})`;
  }

  private buildSearchPredicate(search: SearchSpec | null): string {
    if (!search || search.query.length === 0) return "TRUE";
    const columns = search.columns && search.columns.length > 0 ? search.columns : this.sourceColumns;
    if (columns.length === 0) return "FALSE";
    const parts = columns.map((column) => this.buildSearchExpr(column, search));
    return `(${parts.join(" OR ")})`;
  }

  private buildMatchExpr(column: string, search: SearchSpec | null): string {
    if (!search || search.query.length === 0) return "FALSE";
    if (search.columns && search.columns.length > 0 && !search.columns.includes(column)) {
      return "FALSE";
    }
    return this.buildSearchExpr(column, search);
  }

  private async loadSchema(): Promise<void> {
    if (!this.executor || !this.sourceFingerprint) {
      throw new Error("Engine is not open");
    }
    const query = `DESCRIBE SELECT * FROM read_parquet(${this.sqlLiteral(this.activeParquetPath)}, file_row_number=true)`;
    const result = await this.executor.run(query);
    const columns: string[] = [];
    const types: string[] = [];
    for (const row of result.rows) {
      const name = String(row[0] ?? "");
      if (!name || name === "file_row_number") continue;
      columns.push(name);
      types.push(String(row[1] ?? ""));
    }

    const countResult = await this.executor.run(
      `SELECT COUNT(*) AS count FROM read_parquet(${this.sqlLiteral(this.activeParquetPath)}, file_row_number=true)`,
    );
    const totalRows = Number(countResult.rows[0]?.[0] ?? 0);

    this.sourceColumns = columns;
    this.sourceColumnTypes = types;
    this.schema = {
      columns,
      columnTypes: types,
      totalRows,
      source: { ...this.sourceFingerprint! },
      activeParquetPath: this.activeParquetPath,
    };
  }

  private getCurrentSpecOrDefault(): ViewSpec {
    return this.currentViewSpec ?? { sort: [], filter: {}, search: null };
  }

  async open(input: EngineInput): Promise<EngineSchema> {
    await this.close();

    this.instance = await DuckDBInstance.create();
    this.connection = await this.instance.connect();
    this.executor = new DuckDBSqlExecutor(this.connection);
    this.getTempDir();

    if (input.kind === "parquet") {
      this.activeParquetPath = input.path;
      this.ownsActiveParquet = false;
      this.currentSourceQuery = null;
    } else if (input.kind === "csv") {
      this.activeParquetPath = join(this.getTempDir(), `${basename(input.path)}.parquet`);
      this.ownsActiveParquet = true;
      this.currentSourceQuery = null;
      await this.executor.run(
        `COPY (SELECT * FROM read_csv_auto(${this.sqlLiteral(input.path)})) TO ${this.sqlLiteral(this.activeParquetPath)} (FORMAT PARQUET)`,
      );
    } else {
      this.activeParquetPath = join(this.getTempDir(), "query.parquet");
      this.ownsActiveParquet = true;
      const querySql = this.normalizeQuerySql(input.sql);
      this.currentSourceQuery = querySql;
      await this.executor.run(
        `COPY (${querySql}) TO ${this.sqlLiteral(this.activeParquetPath)} (FORMAT PARQUET)`,
      );
    }

    const fileSize = await this.getFileSize(this.activeParquetPath);
    this.sourceFingerprint = { activeParquetPath: this.activeParquetPath, fileSize };
    await this.loadSchema();
    this.currentViewSpec = { sort: [], filter: {}, search: null };
    // Startup cost is mostly this row-id index (fast). Materializing SELECT p.* here took seconds
    // on large parquet — see module doc. Console label is often duckdb:3 on first open.
    await this.buildView(this.currentViewSpec);
    return this.getSchema();
  }

  getSchema(): EngineSchema {
    if (!this.schema) throw new Error("Engine is not open");
    return {
      ...this.schema,
      columns: [...this.schema.columns],
      columnTypes: [...this.schema.columnTypes],
      source: { ...this.schema.source },
    };
  }

  /**
   * Build (or reuse) a **row-id index** for the current view — filter, search, sort applied here.
   *
   * Stores ONLY `file_row_number`. Never widen this to `SELECT p.*` or column payloads: that
   * materializes the dataset and tanks init on large files (see module-level comment).
   */
  async buildView(spec: ViewSpec): Promise<ViewHandle> {
    this.ensureReady();
    const hash = hashViewInput({
      source: this.sourceFingerprint!,
      sort: spec.sort,
      filter: spec.filter,
      search: spec.search ? { ...spec.search, columns: spec.search.columns?.slice() } : null,
    });
    const tableName = `indexed_${hash}`;
    const existing = this.viewCache.get(hash);
    if (existing) {
      this.currentViewSpec = spec;
      this.currentViewHandle = existing;
      return existing;
    }

    const buildStarted = Date.now();
    // Row-id index only — do NOT materialize cell values into this table.
    await this.executor!.run(`
      CREATE TABLE IF NOT EXISTS ${tableName} AS
      SELECT file_row_number
      FROM read_parquet(${this.sqlLiteral(this.activeParquetPath)}, file_row_number=true)
      WHERE ${this.buildFilterClause(spec.filter)}
        AND ${this.buildSearchPredicate(spec.search)}
      ${spec.sort.length > 0
        ? `ORDER BY ${spec.sort
            .map((s) => `${this.quoteIdent(s.column)} ${s.direction.toUpperCase()} NULLS ${(s.nulls ?? "last").toUpperCase()}`)
            .join(", ")}, file_row_number`
        : `ORDER BY file_row_number`}
    `);
    const countResult = await this.executor!.run(`SELECT COUNT(*) AS count FROM ${tableName}`);
    const totalRows = Number(countResult.rows[0]?.[0] ?? 0);
    const handle: ViewHandle = {
      tableName,
      hash,
      totalRows,
      buildTimeMs: Date.now() - buildStarted,
    };

    this.currentViewSpec = spec;
    this.currentViewHandle = handle;
    this.viewCache.set(hash, handle);
    return handle;
  }

  /**
   * Fetch one window of rendered rows for the UI.
   *
   * Two-step pattern (intentional — do not collapse into one big materialized table):
   * 1. Page through the **small** indexed table (row ids only).
   * 2. Join back to parquet on `file_row_number` for just those ids.
   *
   * This is how we get fast startup + bounded read cost per scroll. Replacing step 2 by storing
   * all columns in step 1 was tried and reverted (multi-second init on large parquet).
   */
  async getPage(request: PageRequest): Promise<PageResult> {
    this.ensureReady();
    const handle = await this.buildView(request.view);
    const columns = request.columns && request.columns.length > 0 ? request.columns : this.sourceColumns;
    const selectColumns = columns.map((column) => `p.${this.quoteIdent(column)}`).join(", ");
    const matchColumns =
      request.includeMatches === false
        ? []
        : columns.map((column) => `${this.buildMatchExpr(column, request.view.search)} AS ${this.quoteIdent(`__m_${column}`)}`);
    // ids from index → hydrate from parquet; keep file_row_number=true on the parquet side.
    const sql = `
      WITH page_ids AS (
        SELECT rowid AS page_pos, file_row_number
        FROM ${handle.tableName}
        LIMIT ${request.limit} OFFSET ${request.offset}
      )
      SELECT ${selectColumns}${matchColumns.length > 0 ? `, ${matchColumns.join(", ")}` : ""}
      FROM page_ids ids
      JOIN read_parquet(${this.sqlLiteral(this.activeParquetPath)}, file_row_number=true) p
      USING (file_row_number)
      ORDER BY ids.page_pos
    `;

    const result = await this.executor!.run(sql);
    const rows: string[][] = [];
    const matches: boolean[][] = [];
    for (const row of result.rows) {
      const rendered = columns.map((_, index) => this.valueToString(row[index]));
      rows.push(rendered);
      if (request.includeMatches !== false) {
        const matchRow = columns.map((_, index) => Boolean(row[columns.length + index]));
        matches.push(matchRow);
      }
    }

    return {
      offset: request.offset,
      limit: request.limit,
      totalRows: handle.totalRows,
      rows,
      columns,
      matches: request.includeMatches !== false ? matches : undefined,
      view: handle,
    };
  }

  getHeaders(): string[] {
    return this.schema ? [...this.schema.columns] : [];
  }

  getTotalRows(): number {
    return this.currentViewHandle?.totalRows ?? this.schema?.totalRows ?? 0;
  }

  getQuery(): string {
    if (this.currentSourceQuery) return this.currentSourceQuery;
    if (this.activeParquetPath) return `FROM ${this.sqlLiteral(this.activeParquetPath)}`;
    return "";
  }

  getFilePath(): string | null {
    return this.ownsActiveParquet ? null : this.activeParquetPath || null;
  }

  suggestSavePath(): string {
    const filePath = this.getFilePath();
    if (filePath && /\.(parquet|csv|json|tsv)$/i.test(filePath)) {
      const ext = filePath.match(/\.(parquet|csv|json|tsv)$/i)![0];
      const base = filePath.slice(0, -ext.length);
      return `${base}.edited${ext}`;
    }

    const query = this.currentSourceQuery || filePath || "";
    const match = query.match(/['"]([^'"]+\.(parquet|csv|json|tsv))['"]/i);
    if (match) {
      const path = match[1]!;
      const ext = `.${match[2]}`;
      const base = path.slice(0, -ext.length);
      return `${base}.edited${ext}`;
    }

    return "output.parquet";
  }

  async getRows(offset: number, limit: number): Promise<string[][]> {
    const page = await this.getPage({
      view: this.getCurrentSpecOrDefault(),
      offset,
      limit,
      includeMatches: true,
    });
    return page.rows;
  }

  async getMatchingRowsWithMatches(args: {
    offset: number;
    limit: number;
    query: string;
    useRegex: boolean;
    wholeWord: boolean;
    caseSensitive: boolean;
  }): Promise<{ rows: string[][]; matches: boolean[][] }> {
    const view = {
      ...this.getCurrentSpecOrDefault(),
      search: {
        query: args.query,
        useRegex: args.useRegex,
        wholeWord: args.wholeWord,
        caseSensitive: args.caseSensitive,
      },
    };
    const page = await this.getPage({
      view,
      offset: args.offset,
      limit: args.limit,
      includeMatches: true,
    });
    return { rows: page.rows, matches: page.matches || page.rows.map((row) => row.map(() => false)) };
  }

  async applySearch(args: {
    query: string;
    useRegex: boolean;
    wholeWord: boolean;
    caseSensitive: boolean;
  }): Promise<number | null> {
    const view = {
      ...this.getCurrentSpecOrDefault(),
      search: args.query.length > 0
        ? {
            query: args.query,
            useRegex: args.useRegex,
            wholeWord: args.wholeWord,
            caseSensitive: args.caseSensitive,
          }
        : null,
    };
    const handle = await this.buildView(view);
    return handle.totalRows;
  }

  async applySort(args: { column: string; direction: "asc" | "desc" }): Promise<void> {
    const current = this.getCurrentSpecOrDefault();
    const next: ViewSpec = {
      ...current,
      sort: [{ column: args.column, direction: args.direction }],
    };
    await this.buildView(next);
  }

  async clearSort(): Promise<void> {
    const current = this.getCurrentSpecOrDefault();
    await this.buildView({ ...current, sort: [] });
  }

  async applyColumnFilter(column: string, values: string[]): Promise<void> {
    const current = this.getCurrentSpecOrDefault();
    const nextFilter = { ...current.filter };
    if (values.length === 0) {
      delete nextFilter[column];
    } else if (values.includes("(null)") && values.length === 1) {
      nextFilter[column] = { $isNull: true };
    } else if (values.length === 1) {
      nextFilter[column] = values[0]!;
    } else {
      const nonNull = values.filter((value) => value !== "(null)");
      nextFilter[column] = values.includes("(null)")
        ? { $in: nonNull, $isNull: true }
        : { $in: values };
    }
    await this.buildView({
      ...current,
      filter: nextFilter,
    });
  }

  async runQuery(sql: string): Promise<void> {
    const input = this.normalizeQuerySql(sql);
    await this.open({ kind: "query", sql: input });
  }

  async saveToFile(outPath: string): Promise<void> {
    const ext = outPath.match(/\.[^.]+$/)?.[0]?.toLowerCase() || "";
    const format: "parquet" | "csv" | "json" =
      ext === ".csv" ? "csv" : ext === ".json" ? "json" : "parquet";
    await this.exportView({
      view: this.getCurrentSpecOrDefault(),
      outPath,
      format,
    });
  }

  async getAutocompleteSuggestions(sql: string): Promise<{ suggestion: string; suggestionStart: number }[]> {
    if (!this.executor) return [];

    if (!this.autocompleteLoaded) {
      try {
        await this.executor.run("INSTALL autocomplete");
        await this.executor.run("LOAD autocomplete");
        this.autocompleteLoaded = true;
      } catch {
        return [];
      }
    }

    try {
      const result = await this.executor!.run(
        `SELECT suggestion, suggestion_start FROM sql_auto_complete(${this.sqlLiteral(sql)})`,
      );
      return result.rows.map((row) => ({
        suggestion: String(row[0] ?? ""),
        suggestionStart: Number(row[1] ?? 0),
      }));
    } catch {
      return [];
    }
  }

  async renameColumn(_oldName: string, _newName: string): Promise<void> {
    throw new Error("Editing is disabled in v2");
  }

  async resetUnnest(): Promise<void> {
    throw new Error("Editing is disabled in v2");
  }

  hasUnnestHistory(): boolean {
    return false;
  }

  async unnestColumn(_colName: string): Promise<{ newColCount: number }> {
    throw new Error("Editing is disabled in v2");
  }

  async deleteColumn(_colName: string): Promise<void> {
    throw new Error("Editing is disabled in v2");
  }

  async getColumnTypes(): Promise<string[]> {
    this.ensureReady();
    return [...this.sourceColumnTypes];
  }

  async getColumnStats(): Promise<string[]> {
    this.ensureReady();
    const result = await this.executor!.run(`
      SUMMARIZE (
        SELECT *
        FROM read_parquet(${this.sqlLiteral(this.activeParquetPath)}, file_row_number=true)
        WHERE ${this.buildFilterClause(this.getCurrentSpecOrDefault().filter)}
          AND ${this.buildSearchPredicate(this.getCurrentSpecOrDefault().search)}
      )
    `);

    const statsMap = new Map<string, string>();
    for (const row of result.rows) {
      const name = String(row[0] ?? "");
      const approxUnique = Number(row[4] ?? 0);
      const nullPct = Number.parseFloat(String(row[11] ?? "0"));
      const uniqueStr = this.compactNumber(approxUnique);
      let stat = `d${uniqueStr}`;
      if (nullPct > 0) {
        const pctStr = nullPct < 1 ? "<1" : Math.round(nullPct).toString();
        stat += ` ∅${pctStr}%`;
      }
      statsMap.set(name, stat);
    }
    return this.sourceColumns.map((column) => statsMap.get(column) || "");
  }

  private compactNumber(n: number): string {
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}b`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
    return String(n);
  }

  async getColumnValueDistribution(
    request: ColumnDistributionRequest | number,
  ): Promise<ColumnDistributionResult> {
    this.ensureReady();
    const current = this.getCurrentSpecOrDefault();
    const col =
      typeof request === "number"
        ? this.sourceColumns[request] ?? ""
        : request.column;
    const maxValues = typeof request === "number" ? 1_000_000 : request.maxValues ?? 1_000_000;
    if (!col) return [];
    const result = await this.executor!.run(`
      SELECT p.${this.quoteIdent(col)} AS value,
             COUNT(*) AS count,
             ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS percent
      FROM read_parquet(${this.sqlLiteral(this.activeParquetPath)}, file_row_number=true) p
      WHERE ${this.buildFilterClause(current.filter)}
        AND ${this.buildSearchPredicate(current.search)}
      GROUP BY p.${this.quoteIdent(col)}
      ORDER BY count DESC, value ASC
      LIMIT ${maxValues}
    `);

    return result.rows.map((row) => ({
      value: row[0] === null ? "(null)" : String(row[0]),
      count: Number(row[1] ?? 0),
      percent: Number(row[2] ?? 0),
    }));
  }

  async exportView(request: ExportRequest): Promise<void> {
    this.ensureReady();
    const handle = await this.buildView(request.view);
    const columns = request.columns && request.columns.length > 0 ? request.columns : this.sourceColumns;
    const projection = columns.map((column) => `p.${this.quoteIdent(column)}`).join(", ");
    const sortOrder =
      request.view.sort.length > 0
        ? `${request.view.sort.map((spec) => `p.${this.quoteIdent(spec.column)} ${spec.direction.toUpperCase()} NULLS ${(spec.nulls ?? "last").toUpperCase()}`).join(", ")}, p.file_row_number`
        : "p.file_row_number";
    const formatClause =
      request.format === "parquet"
        ? "(FORMAT PARQUET)"
        : request.format === "csv"
          ? "(FORMAT CSV, HEADER)"
          : "(FORMAT JSON, ARRAY TRUE)";

    await this.executor!.run(`
      COPY (
        SELECT ${projection}
        FROM read_parquet(${this.sqlLiteral(this.activeParquetPath)}, file_row_number=true) p
        WHERE ${this.buildFilterClause(request.view.filter)}
          AND ${this.buildSearchPredicate(request.view.search)}
        ORDER BY ${sortOrder}
      ) TO ${this.sqlLiteral(request.outPath)} ${formatClause}
    `);
  }

  async close(): Promise<void> {
    try {
      this.connection?.disconnectSync();
    } catch {
      // ignore
    }
    try {
      this.instance?.closeSync();
    } catch {
      // ignore
    }

    if (this.tempDir) {
      try {
        rmSync(this.tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }

    this.instance = null;
    this.connection = null;
    this.executor = null;
    this.tempDir = null;
    this.tempParquetPath = null;
    this.ownsActiveParquet = false;
    this.activeParquetPath = "";
    this.sourceFingerprint = null;
    this.schema = null;
    this.sourceColumns = [];
    this.sourceColumnTypes = [];
    this.currentViewSpec = { sort: [], filter: {}, search: null };
    this.currentViewHandle = null;
    this.viewCache.clear();
    this.currentSourceQuery = null;
  }
}
