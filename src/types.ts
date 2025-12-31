export interface StateData {
  headers: string[];
  rows: string[][];
}

export type WrapMode = "chars" | "words" | "disabled";

export type SelectionMode = "row" | "column" | "cell";

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
  isMaterialized: boolean;
}
