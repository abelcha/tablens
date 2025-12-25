import type { WrapMode } from "../types";
import { wrapText, NUM_SPACES_BETWEEN_COLUMNS } from "../utils/text";

export const MAX_COLUMN_WIDTH_FRACTION = 0.3;

export function computeColumnWidths(headers: string[], rows: string[][], tableWidth: number) {
  let columnWidths = headers.map(h => h.length);

  rows.forEach(row => {
    row.forEach((cell, i) => {
      if (i >= columnWidths.length) return;
      const lines = (cell || '').split('\n');
      lines.forEach(line => {
        const valueLen = line.length;
        if (columnWidths[i]! < valueLen) {
          columnWidths[i] = valueLen;
        }
      });
    });
  });

  const maxSingleColumnWidth = Math.floor(tableWidth * MAX_COLUMN_WIDTH_FRACTION);
  const clippedColumns: [number, number][] = [];

  columnWidths = columnWidths.map((w, i) => {
    let newWidth = w + NUM_SPACES_BETWEEN_COLUMNS;
    if (newWidth > maxSingleColumnWidth) {
      clippedColumns.push([i, newWidth]);
      newWidth = maxSingleColumnWidth;
    }
    return newWidth;
  });

  redistributeWidthsAfterClipping(columnWidths, tableWidth, clippedColumns);

  return columnWidths;
}

export function redistributeWidthsAfterClipping(columnWidths: number[], areaWidth: number, clippedColumns: [number, number][]) {
  if (clippedColumns.length === 0) return;

  const totalWidth = columnWidths.reduce((a, b) => a + b, 0);
  if (totalWidth >= areaWidth) return;

  clippedColumns.sort((a, b) => a[1] - b[1]);

  let remainingWidth = Math.max(0, areaWidth - totalWidth - 1);
  let numColumnsToAdjust = clippedColumns.length;

  for (const [i, widthBeforeClipping] of clippedColumns) {
    if (columnWidths[i] === undefined) continue;
    
    const adjustment = Math.floor(remainingWidth / numColumnsToAdjust);
    const widthAfterAdjustment = Math.min(widthBeforeClipping, columnWidths[i]! + adjustment);
    const addedWidth = widthAfterAdjustment - columnWidths[i]!;
    columnWidths[i] = widthAfterAdjustment;
    remainingWidth -= addedWidth;
    numColumnsToAdjust -= 1;
  }
}

export function computeRowHeights(rows: string[][], columnWidths: number[], wrapMode: WrapMode) {
  if (wrapMode === 'disabled') {
    return rows.map(() => 1);
  }

  return rows.map(row => {
    let height = 1;
    row.forEach((cell, i) => {
      const colWidth = columnWidths[i];
      if (colWidth === undefined) return;
      
      const width = colWidth - NUM_SPACES_BETWEEN_COLUMNS;
      // We pass wordWrap=true if wrapMode is 'words', else false (for 'chars')
      const wrapped = wrapText(cell || '', width, wrapMode === 'words');
      height = Math.max(height, wrapped.length);
    });
    return height;
  });
}
