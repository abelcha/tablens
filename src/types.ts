export interface StateData {
  headers: string[];
  rows: string[][];
}

export type WrapMode = "chars" | "words" | "disabled";

export type SelectionMode = "row" | "column" | "cell";

/** compact = p50/p90 sample; fitCells = max cell; fitCellsAndHeaders = max cell + column name */
export type ColumnWidthMode = "compact" | "fitCells" | "fitCellsAndHeaders";

export interface State {
  rowsOffset: number;
  colsOffset: number;
  cursorRow: number;
  cursorCol: number;
  numFreezeCols: number;
  selectionMode: SelectionMode;
  markedRows: Set<number>;
  found: { row: number; col: number }[];
  searchActive: boolean;
  searchQuery: string;
  searchUseRegex: boolean;
  searchWholeWord: boolean;
  searchCaseSensitive: boolean;
  searchMatchRowCount: number | null;
  searchError: string | null;
  visibleMatches: boolean[][];
  sorter: any;
  wrapMode: WrapMode;
  columnOverrides: Record<number, number>;
  visibleRows: string[][];
  totalRowCount: number;
  headers: string[];
  showTypes: boolean;
  columnTypes: string[];
  showStats: boolean;
  columnStats: string[];
  showHelp: boolean;
  columnWidthMode: ColumnWidthMode;
  colSearchActive: boolean;
  colSearchQuery: string;
  showColumnFilter: boolean;
  columnFilterCol: number | null;
  columnFilterData: Array<{value: string; count: number; percent: number}> | null;
  columnFilterCursor: number;
  columnFilterSelectedValues: string[];
  columnFilterSelectionsByCol: Record<number, string[]>;
  columnFilterSearchActive: boolean;
  columnFilterSearchQuery: string;
}
