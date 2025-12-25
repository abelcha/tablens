export interface StateData {
  headers: string[];
  rows: string[][];
}

export type WrapMode = 'chars' | 'words' | 'disabled';

export type SelectionMode = 'row' | 'column' | 'cell';

export interface State {
  rowsOffset: number;
  colsOffset: number;
  cursorRow: number;
  cursorCol: number;
  numFreezeCols: number;
  selectionMode: SelectionMode;
  markedRows: Set<number>;
  found: { row: number; col: number }[];
  sorter: any;
  wrapMode: WrapMode;
  columnOverrides: Record<number, number>;
  visibleRows: string[][];
  totalRowCount: number;
  headers: string[];
}
