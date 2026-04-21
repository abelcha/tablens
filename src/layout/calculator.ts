import type { WrapMode } from "src/types";
import { wrapText, NUM_SPACES_BETWEEN_COLUMNS } from "src/utils/text";

export const MAX_COLUMN_WIDTH_FRACTION = 0.3;

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0]!;

  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) {
    return sortedValues[lower]!;
  }

  return Math.ceil(sortedValues[lower]! * (1 - weight) + sortedValues[upper]! * weight);
}

export function computeColumnWidths(
  headers: string[],
  rows: string[][],
  tableWidth: number,
  columnOverrides: Record<number, number> = {},
) {
  const sampleSize = Math.min(200, rows.length);
  const sampleRows = rows.slice(0, sampleSize);

  const columnWidthsData: number[][] = headers.map((h, i) => {
    if (columnOverrides[i] !== undefined) return [];
    return [h.length];
  });

  sampleRows.forEach((row) => {
    row.forEach((cell, i) => {
      if (i >= columnWidthsData.length || columnOverrides[i] !== undefined) return;
      const lines = (cell || "").split("\n");
      lines.forEach((line) => {
        const valueLen = line.length;
        columnWidthsData[i]!.push(valueLen);
      });
    });
  });

  const MIN_COLUMN_WIDTH = 6;
  let columnWidths = columnWidthsData.map((widths, i) => {
    if (columnOverrides[i] !== undefined) {
      return Math.max(columnOverrides[i]!, MIN_COLUMN_WIDTH);
    }
    if (widths.length === 0) {
      return Math.max(headers[i]?.length || 0, MIN_COLUMN_WIDTH);
    }
    const sorted = [...widths].sort((a, b) => a - b);
    const p50 = percentile(sorted, 0.5);
    const p90 = percentile(sorted, 0.9);
    // Use p50 as base; only use p90 if data varies widely (p90 > 2x p50)
    const useMedian = p90 <= p50 * 2;
    return Math.max(useMedian ? p50 : p90, MIN_COLUMN_WIDTH);
  });

  const maxSingleColumnWidth = Math.floor(tableWidth * MAX_COLUMN_WIDTH_FRACTION);
  const clippedColumns: [number, number][] = [];

  columnWidths = columnWidths.map((w, i) => {
    let newWidth = w + NUM_SPACES_BETWEEN_COLUMNS;
    if (columnOverrides[i] !== undefined) {
      return w;
    }
    if (newWidth > maxSingleColumnWidth) {
      clippedColumns.push([i, newWidth]);
      newWidth = maxSingleColumnWidth;
    }
    return newWidth;
  });

  redistributeWidthsAfterClipping(columnWidths, tableWidth, clippedColumns);

  return columnWidths;
}

export function redistributeWidthsAfterClipping(
  columnWidths: number[],
  areaWidth: number,
  clippedColumns: [number, number][],
) {
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
  if (wrapMode === "disabled") {
    return rows.map(() => 1);
  }

  return rows.map((row) => {
    let height = 1;
    row.forEach((cell, i) => {
      const colWidth = columnWidths[i];
      if (colWidth === undefined) return;

      const width = colWidth - NUM_SPACES_BETWEEN_COLUMNS;
      const wrapped = wrapText(cell || "", width, wrapMode === "words");
      height = Math.max(height, wrapped.length);
    });
    return height;
  });
}
