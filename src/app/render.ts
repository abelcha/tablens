import type { StyledText } from "@opentui/core";
import type { State, WrapMode, SelectionMode } from "src/types";
import { computeColumnWidths, computeRowHeights } from "src/layout/calculator";
import {
  buildHeaderLine,
  buildSeparatorLine,
  buildBottomSeparatorLine,
  buildRowLine,
} from "src/utils/text";
import { parseInlineMarkup } from "src/app/markup";
export { computeHeaderOverlay } from "src/app/headerOverlay";

export interface TableContentModel {
  content: StyledText;
  colWidths: number[];
  rowHeights: number[];
  gutterWidth: number;
  visCount: number;
}

export function computeTableContentModel(args: {
  headers: string[];
  visibleRows: string[][];
  visibleMatches?: boolean[][];
  rowsOffset: number;
  colsOffset: number;
  wrapMode: WrapMode;
  columnOverrides: Record<number, number>;
  termW: number;
  termH: number;
  totalRowCount: number;
  selectionMode?: SelectionMode;
  cursorCol?: number;
}): TableContentModel {
  const {
    headers,
    visibleRows,
    visibleMatches,
    rowsOffset,
    colsOffset,
    wrapMode,
    columnOverrides,
    termW,
    termH,
    totalRowCount,
    selectionMode,
    cursorCol,
  } = args;

  // Calculate gutter width based on estimated max visible row
  const estimatedPageSize = Math.max(termH - 4, 10);
  const maxVisibleRow = Math.min(rowsOffset + estimatedPageSize, totalRowCount);
  let gutterWidth = String(maxVisibleRow).length;
  const dataPadding = 2; // "│ "
  let tableW = termW - gutterWidth - dataPadding;

  const dispHeaders = headers.slice(colsOffset);
  const adjustedOverrides: Record<number, number> = {};
  for (const [idx, width] of Object.entries(columnOverrides)) {
    const i = parseInt(idx);
    if (i >= colsOffset) adjustedOverrides[i - colsOffset] = width;
  }

  const colWidths = computeColumnWidths(
    dispHeaders,
    visibleRows.map((r) => r.slice(colsOffset)),
    tableW,
    adjustedOverrides,
  );
  const rowHeights = computeRowHeights(
    visibleRows.map((r) => r.slice(colsOffset, colsOffset + colWidths.length)),
    colWidths,
    wrapMode,
  );

  let curH = 0,
    visCount = 0;
  const availableRowHeight = termH - 4; // blank line + header + separator + bottom separator
  for (const h of rowHeights) {
    if (curH + h > availableRowHeight && visCount > 0) break;
    curH += h;
    visCount++;
  }

  // Recalculate gutter width based on actual visible rows
  const actualMaxVisibleRow = rowsOffset + visCount;
  const newGutterWidth = String(actualMaxVisibleRow).length;
  if (newGutterWidth !== gutterWidth) {
    gutterWidth = newGutterWidth;
  }

  const visRows = visibleRows.slice(0, visCount).map((r) => r.slice(colsOffset));
  const visMatches = visibleMatches
    ? visibleMatches.slice(0, visCount).map((m) => m.slice(colsOffset))
    : undefined;
  const visHeights = rowHeights.slice(0, visCount);

  // Determine selected column index relative to displayed columns
  const selectedColIdx =
    selectionMode === "column" && cursorCol !== undefined ? cursorCol - colsOffset : undefined;
  const validSelectedColIdx =
    selectedColIdx !== undefined && selectedColIdx >= 0 && selectedColIdx < dispHeaders.length
      ? selectedColIdx
      : undefined;

  const content = parseInlineMarkup(
    // "\n" + // Blank line at the top
    buildSeparatorLine(colWidths, 0) +
      buildHeaderLine(dispHeaders, colWidths, gutterWidth, validSelectedColIdx, true) +
      buildSeparatorLine(colWidths, gutterWidth) +
      visRows
        .map((r, i) => {
          const rowNum = rowsOffset + i + 1;
          return Array.from({ length: visHeights[i] || 1 }, (_, h) =>
            buildRowLine(r, colWidths, wrapMode, h, rowNum, gutterWidth, visMatches?.[i]),
          ).join("");
        })
        .join("") +
      buildBottomSeparatorLine(colWidths, gutterWidth),
  );

  return { content, colWidths, rowHeights, gutterWidth, visCount };
}

export function computeCursorOverlay(args: {
  state: State;
  colWidths: number[];
  rowHeights: number[];
  gutterWidth: number;
  termH: number;
  visCount: number;
}) {
  const { state, colWidths, rowHeights, gutterWidth, termH, visCount } = args;
  const { cursorRow, cursorCol, rowsOffset, colsOffset, selectionMode } = state;

  const relR = cursorRow - rowsOffset;
  const relC = cursorCol - colsOffset;
  const dataOffset = gutterWidth + 2; // "│ "
  const headerHeight = 3; // blank line + header + separator

  // Clamp to visible range to prevent flicker during scroll
  // When at/past last row, keep at second-to-last; when before first, keep at first
  const lastVisibleIdx = visCount - 1;
  const scrollZoneIdx = Math.max(0, visCount - 2);
  let clampedRelR: number;
  if (relR < 0) {
    clampedRelR = 0; // Keep at top when scrolling up
  } else if (relR >= lastVisibleIdx) {
    clampedRelR = scrollZoneIdx; // Keep at second-to-last when scrolling down
  } else {
    clampedRelR = relR;
  }
  const clampedRelC = Math.max(0, Math.min(relC, colWidths.length - 1));

  let cursorStyle: any = { visible: false };
  switch (selectionMode) {
    case "row": {
      // Always visible if cursor is in or past visible range (we clamp position)
      const visible = relR >= 0;
      cursorStyle = {
        visible,
        top: headerHeight + rowHeights.slice(0, clampedRelR).reduce((a, b) => a + b, 0),
        left: dataOffset,
        width: colWidths.reduce((a, b) => a + b, 0),
        height: rowHeights[clampedRelR] || 1,
      };
      break;
    }
    case "column": {
      const visible = relC >= 0 && relC < colWidths.length;
      const dataHeight = termH - headerHeight;
      cursorStyle = {
        visible,
        top: headerHeight,
        left: dataOffset + colWidths.slice(0, clampedRelC).reduce((a, b) => a + b, 0),
        width: colWidths[clampedRelC] || 0,
        height: dataHeight,
      };
      break;
    }
    case "cell":
    default: {
      const visible = relR >= 0 && relC >= 0 && relC < colWidths.length;
      cursorStyle = {
        visible,
        top: headerHeight + rowHeights.slice(0, clampedRelR).reduce((a, b) => a + b, 0),
        left: dataOffset + colWidths.slice(0, clampedRelC).reduce((a, b) => a + b, 0),
        width: colWidths[clampedRelC] || 0,
        height: rowHeights[clampedRelR] || 1,
      };
      break;
    }
  }

  return cursorStyle;
}
