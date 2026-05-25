export type SortDirection = "asc" | "desc";

export type SortSpec = {
  column: string;
  direction: SortDirection;
  nulls?: "first" | "last";
};

export type SearchSpec = {
  query: string;
  useRegex: boolean;
  wholeWord: boolean;
  caseSensitive: boolean;
  columns?: string[];
};

export type FilterValue = string | number | boolean | null;

export type FilterOperator = {
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

export type ColumnFilter = FilterValue | FilterOperator;

export type FilterQuery = {
  [column: string]: ColumnFilter;
};

export type ViewSpec = {
  sort: SortSpec[];
  filter: FilterQuery;
  search: SearchSpec | null;
};

export type SourceFingerprint = {
  activeParquetPath: string;
  fileSize: number;
};

export type ViewHashInput = {
  source: SourceFingerprint;
  sort: SortSpec[];
  filter: FilterQuery;
  search: SearchSpec | null;
};

export type EngineInput =
  | { kind: "parquet"; path: string }
  | { kind: "csv"; path: string }
  | { kind: "query"; sql: string; basePath?: string };

export type EngineSchema = {
  columns: string[];
  columnTypes: string[];
  totalRows: number;
  source: SourceFingerprint;
  activeParquetPath: string;
};

/**
 * Handle to a DuckDB table that stores **only** `file_row_number` for a view (filter/sort/search).
 * Not a materialized copy of row data — see Engine.ts module doc before adding columns here.
 */
export type ViewHandle = {
  tableName: string;
  hash: string;
  totalRows: number;
  buildTimeMs?: number;
};

/** Window into a view; Engine resolves ids from ViewHandle then hydrates from parquet. */
export type PageRequest = {
  view: ViewSpec;
  offset: number;
  limit: number;
  columns?: string[];
  includeMatches?: boolean;
};

export type PageResult = {
  offset: number;
  limit: number;
  totalRows: number;
  rows: string[][];
  columns: string[];
  matches?: boolean[][];
  view: ViewHandle;
};

export type ExportFormat = "parquet" | "csv" | "json";

export type ExportRequest = {
  view: ViewSpec;
  outPath: string;
  format: ExportFormat;
  columns?: string[];
};

export type ColumnDistributionRequest = {
  column: string;
  maxValues?: number;
};

export type ColumnDistributionResult = Array<{
  value: string;
  count: number;
  percent: number;
}>;

export type QueryResult = {
  columns: string[];
  rows: unknown[][];
};

export interface SqlExecutor {
  run(sql: string): Promise<QueryResult>;
}

export interface TablensEngine {
  open(input: EngineInput): Promise<EngineSchema>;
  getSchema(): EngineSchema;
  getPage(request: PageRequest): Promise<PageResult>;
  buildView(spec: ViewSpec): Promise<ViewHandle>;
  getColumnTypes(): Promise<string[]>;
  getColumnStats(): Promise<string[]>;
  getColumnValueDistribution(
    request: ColumnDistributionRequest,
  ): Promise<ColumnDistributionResult>;
  getColumnP80ValueLengths?(sampleSize?: number): Promise<Record<string, number>>;
  exportView(request: ExportRequest): Promise<void>;
  close(): Promise<void>;
}
