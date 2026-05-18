# Tablens v2 Engine Rewrite Spec

## Goal

Split Tablens into two layers:

```txt
frontend(s): OpenTUI / Web React / Native wrapper
  ↓
engine: Parquet-normalized DuckDB browsing engine
```

The engine owns data loading, query planning, sort/filter/search indexes, paging, and export. Frontends own rendering, keyboard/mouse interaction, viewport state, and UI components.

The main invariant for v2:

```txt
The engine browses Parquet only.
All non-Parquet inputs are normalized to a temporary Parquet file on load.
```

This lets every source use the same fast `read_parquet(..., file_row_number=true)` path.

---

## Non-goals

- No multi-user/session system for v2.
- No complex cache metadata database initially.
- No REST API required for the first rewrite.
- No full-table RAM materialization by default.
- No frontend-specific code inside the engine.
- No OpenTUI dependency inside the engine.

---

## Engine responsibilities

The engine provides a small typed API:

```ts
interface TablensEngine {
  open(input: EngineInput): Promise<EngineSchema>;
  getSchema(): EngineSchema;
  getPage(request: PageRequest): Promise<PageResult>;
  buildView(spec: ViewSpec): Promise<ViewHandle>;
  getColumnTypes(): Promise<string[]>;
  getColumnStats(): Promise<string[]>;
  getColumnValueDistribution(request: ColumnDistributionRequest): Promise<ColumnDistributionResult>;
  exportView(request: ExportRequest): Promise<void>;
  close(): Promise<void>;
}
```

The frontend should not call DuckDB directly.

---

## Input normalization

### Supported inputs

```ts
type EngineInput =
  | { kind: "parquet"; path: string }
  | { kind: "csv"; path: string }
  | { kind: "query"; sql: string; basePath?: string };
```

### Behavior

#### Parquet

Use the file directly:

```txt
activeParquetPath = input.path
ownsActiveParquet = false
```

#### CSV

Convert to a temp Parquet on open:

```sql
COPY (
  SELECT * FROM read_csv_auto($csvPath)
) TO $tmpParquetPath (FORMAT PARQUET);
```

#### Custom SQL query

Snapshot to temp Parquet on open or query execution:

```sql
COPY (
  $query
) TO $tmpParquetPath (FORMAT PARQUET);
```

After this step, all engine operations use:

```sql
read_parquet($activeParquetPath, file_row_number=true)
```

---

## Core browsing model

The engine always pages through an index table. There is no special direct mode in v2.

For every current view, including the default unsorted/unfiltered file order, the engine builds a narrow row-id table:

```sql
CREATE TABLE IF NOT EXISTS ordered_filtered_${hash} AS
SELECT file_row_number
FROM read_parquet($activeParquetPath, file_row_number=true)
WHERE <filter/search predicates or true>
ORDER BY <sort keys if any>, file_row_number;
```

For the default view this is simply:

```sql
CREATE TABLE IF NOT EXISTS ordered_filtered_${hash} AS
SELECT file_row_number
FROM read_parquet($activeParquetPath, file_row_number=true)
ORDER BY file_row_number;
```

Pages are loaded by joining ids back to the Parquet file:

```sql
WITH page_ids AS (
  SELECT file_row_number, row_number() OVER () AS page_pos
  FROM (
    SELECT file_row_number
    FROM ordered_filtered_${hash}
    LIMIT $limit OFFSET $offset
  )
)
SELECT p.<columns>
FROM page_ids ids
JOIN read_parquet($activeParquetPath, file_row_number=true) p
USING (file_row_number)
ORDER BY ids.page_pos;
```

Important: always preserve page order with `page_pos`; joins do not guarantee order.

---

## View hash

For simplicity, v2 uses deterministic cache table names.

```txt
ordered_filtered_${hash}
```

Keep invalidation simple. The source identity is only:

```ts
type SourceFingerprint = {
  activeParquetPath: string;
  fileSize: number;
};
```

The view table hash is derived from:

```ts
type ViewHashInput = {
  source: SourceFingerprint;
  sort: SortSpec[];
  filter: FilterQuery;
  search: SearchSpec | null;
};
```

No mtime, schema fingerprint, engine version, or cache metadata table is required initially.

Use `CREATE TABLE IF NOT EXISTS` for simplicity. Since the app is mono-client, concurrent cache creation is not a v2 concern.

---

## Types

```ts
type SortDirection = "asc" | "desc";

type SortSpec = {
  column: string;
  direction: SortDirection;
  nulls?: "first" | "last";
};

type SearchSpec = {
  query: string;
  useRegex: boolean;
  wholeWord: boolean;
  caseSensitive: boolean;
  columns?: string[];
};

type FilterValue = string | number | boolean | null;

type FilterOperator = {
  $eq?: FilterValue;
  $ne?: FilterValue;
  $in?: FilterValue[];
  $nin?: FilterValue[];
  $gt?: FilterValue;
  $gte?: FilterValue;
  $lt?: FilterValue;
  $lte?: FilterValue;
  $like?: string;
  $ilike?: string;
  $similarTo?: string;
  $regex?: string;
  $isNull?: boolean;
};

// Mongo-like shape. Keys are column names. Multiple operators on one column are ANDed.
// v2 intentionally does not include boolean composition operators.
type ColumnFilter = FilterValue | FilterOperator;

type FilterQuery = {
  [column: string]: ColumnFilter;
};

type ViewSpec = {
  sort: SortSpec[];
  filter: FilterQuery;
  search: SearchSpec | null;
};

type ViewHandle = {
  tableName: string;
  hash: string;
  totalRows: number;
  buildTimeMs?: number;
};

type PageRequest = {
  view: ViewSpec;
  offset: number;
  limit: number;
  columns?: string[];
  includeMatches?: boolean;
};

type PageResult = {
  offset: number;
  limit: number;
  totalRows: number;
  rows: string[][];
  columns: string[];
  matches?: boolean[][];
  view: ViewHandle;
};
```

---

## Search

Search predicates are generated over selected columns or all columns.

Plain substring, case-insensitive:

```sql
instr(lower(CAST(col AS VARCHAR)), lower($query)) > 0
```

Plain substring, case-sensitive:

```sql
instr(CAST(col AS VARCHAR), $query) > 0
```

Regex / whole word:

```sql
regexp_matches(CAST(col AS VARCHAR), $pattern)
```

The indexed table stores only `file_row_number`, not full rows and not match booleans.

If the frontend needs match highlighting, the page query computes match booleans only for the current page.

---

## Filters

Filters use a Mongo-like object shape.

Examples:

```ts
// equality shorthand
{ status: "active" }

// operators
{ age: { $gte: 18, $lte: 65 } }
{ city: { $in: ["Paris", "Lyon"] } }
{ name: { $ilike: "%dupont%" } }
{ code: { $similarTo: "[0-9]{3}[A-Z]+" } }

// multiple columns are ANDed
{
  status: "active",
  priority: { $gte: 10 },
}
```

Initial operator mapping:

| Operator     | SQL shape                         |
| ------------ | --------------------------------- |
| `$eq`        | `col = value` / `IS NULL`         |
| `$ne`        | `col <> value` / `IS NOT NULL`    |
| `$in`        | `col IN (...)`                    |
| `$nin`       | `col NOT IN (...)`                |
| `$gt`        | `col > value`                     |
| `$gte`       | `col >= value`                    |
| `$lt`        | `col < value`                     |
| `$lte`       | `col <= value`                    |
| `$like`      | `CAST(col AS VARCHAR) LIKE value` |
| `$ilike`     | `CAST(col AS VARCHAR) ILIKE value` |
| `$similarTo` | `CAST(col AS VARCHAR) SIMILAR TO value` |
| `$regex`     | `regexp_matches(CAST(col AS VARCHAR), value)` |
| `$isNull`    | `IS NULL` / `IS NOT NULL`         |

---

## Sorting

Sort SQL must be deterministic:

```sql
ORDER BY column ASC NULLS LAST, file_row_number
```

For descending:

```sql
ORDER BY column DESC NULLS LAST, file_row_number
```

Multi-column sort:

```sql
ORDER BY col1 ASC NULLS LAST, col2 DESC NULLS LAST, file_row_number
```

---

## Paging and cache window

The engine API supports arbitrary offset/limit. The frontend should keep a small row window cache so arrow-down does not query every single row movement.

Recommended frontend fetch size:

```txt
max(visibleRows * 4, 500)
```

Engine itself may stay stateless for page caching in v2.

---

## Export

Export is read-only: it writes the current view to a new file. It does not mutate the loaded Parquet, rename columns, or save edits back into the source.

```sql
COPY (
  WITH ids AS (
    SELECT file_row_number, row_number() OVER () AS page_pos
    FROM ordered_filtered_${hash}
  )
  SELECT p.<columns>
  FROM ids
  JOIN read_parquet($activeParquetPath, file_row_number=true) p
  USING (file_row_number)
  ORDER BY ids.page_pos
) TO $outPath (FORMAT PARQUET);
```

Support formats:

```ts
type ExportFormat = "parquet" | "csv" | "json";
```

---

## Editing and mutation

Disabled for v2:

- column rename
- column delete
- cell/data editing
- saving mutations back to source
- rewriting the active Parquet as an edited dataset

The engine is read-only except for internal cache/index tables and explicit export to a new output file.

---

## Quack compatibility

The engine should be written so that the SQL execution layer is swappable:

```ts
interface SqlExecutor {
  run(sql: string): Promise<QueryResult>;
}
```

Initial implementation uses local `@duckdb/node-api`.

Later implementation can use DuckDB Quack:

- local/remote server started with `CALL quack_serve(...)`
- client queries through `quack_query(...)` or `ATTACH 'quack:host' AS remote`
- if cached id tables are persistent tables, stateless `quack_query` is enough
- if temp tables/settings are needed, use `ATTACH` for sticky remote state

Quack should be an implementation detail of the engine, not a frontend concern.

---

## Migration from current code

Remove or replace these concepts from `DuckDBDataSource`:

- full RAM materialization as default
- `data_table_materialized`
- sorting by rewriting the full materialized table
- search table containing full rows
- `isMaterialized` UI as the primary mode

Replace with:

- `activeParquetPath`
- `buildView(spec)`
- `ordered_filtered_${hash}` id tables
- `getPage(request)`
- optional import/conversion status

Current reusable frontend/core code:

- `src/app/state.ts`
- `src/app/actions.ts`
- `src/app/keyboard.ts`
- `src/app/viewport.ts`, after adapting to `getPage`
- `src/layout/calculator.ts`
- `src/utils/text.ts`
- `src/app/render.ts`

Current engine-adjacent code to rewrite:

- `src/data/source.ts`

---

## Implementation phases

### Phase 1: Engine interface

- Add `src/engine/types.ts`.
- Add `src/engine/Engine.ts`.
- Implement Parquet-only indexed paging for every view, including default order.
- Adapt current TUI to use `engine.getPage()`.

### Phase 2: Input normalization

- Add CSV to temp Parquet.
- Add custom query to temp Parquet.
- Keep `activeParquetPath` invariant.

### Phase 3: Indexed views

- Implement `ViewSpec` hashing using source path + size + view spec.
- Implement `buildView(spec)`.
- Implement default/sorted/filtered/search paging through `ordered_filtered_${hash}`.

### Phase 4: Search highlighting

- Keep id index narrow.
- Compute match booleans only on returned page.

### Phase 5: Export

- Export the current indexed view to Parquet/CSV/JSON.

### Phase 6: Optional Quack executor

- Keep local executor as default.
- Add Quack executor only if needed for web/remote.

---

## Success criteria

- Opening a Parquet file creates only a narrow id index table, not a full data materialization.
- Sorting/filtering/searching a wide Parquet file creates only an id index table.
- Deep offset pages are fast through the id table + Parquet join path.
- CSV/custom SQL are converted once to temp Parquet and then use the same path.
- Frontend has no direct DuckDB dependency.
- Column rename/edit/save mutations are disabled.
- OpenTUI frontend continues to work.
- Engine can later be reused by web/native frontends.
