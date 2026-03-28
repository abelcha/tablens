import type { State } from "src/types";
import { DuckDBDataSource } from "src/data/source";
import { computeColumnWidths, computeRowHeights } from "src/layout/calculator";

export interface ViewportPatch {
  rowsOffset: number;
  colsOffset: number;
  visibleRows: string[][];
  visibleMatches: boolean[][];
}

export async function computeViewportPatch(args: {
  state: State;
  termW: number;
  termH: number;
  source: DuckDBDataSource;
  lastRenderedOffset: number;
  lastRenderedQuery: string;
  lastRenderedUseRegex: boolean;
  lastRenderedWholeWord: boolean;
  lastRenderedCaseSensitive: boolean;
  lastRenderedSorter: { column: number; direction: "asc" | "desc" } | null;
}): Promise<ViewportPatch> {
  const {
    state,
    termW,
    termH,
    source,
    lastRenderedOffset,
    lastRenderedQuery,
    lastRenderedUseRegex,
    lastRenderedWholeWord,
    lastRenderedCaseSensitive,
    lastRenderedSorter,
  } = args;
  const { headers, selectionMode, cursorRow, cursorCol, wrapMode, columnOverrides } = state;
  let { rowsOffset, colsOffset, visibleRows, visibleMatches } = state;

  // Fetch more rows to support larger sample window for column width calculation
  // This prevents columns from disappearing/reappearing with sparse data
  const fetchLimit = Math.max(Math.floor((termH || 20) * 2), 200);

  // 1. Vertical scrolling (if needed by cursor)
  if (selectionMode !== "column" && cursorRow < rowsOffset) {
    rowsOffset = cursorRow;
  }

  // 2. Fetch if offset changed, query changed, or rows empty
  const queryChanged =
    state.searchQuery !== lastRenderedQuery ||
    state.searchUseRegex !== lastRenderedUseRegex ||
    state.searchWholeWord !== lastRenderedWholeWord ||
    state.searchCaseSensitive !== lastRenderedCaseSensitive ||
    JSON.stringify(state.sorter) !== JSON.stringify(lastRenderedSorter);

  if (queryChanged) {
    // If it's a sort change, we might want to keep the offset if we were clever,
    // but resetting to 0 is safer and often what users expect when sorting changes.
    // The SORT action already resets rowsOffset to 0, so this just ensures we re-fetch.
    rowsOffset = state.rowsOffset;
  }

  if (rowsOffset !== lastRenderedOffset || visibleRows.length === 0 || queryChanged) {
    if (state.searchQuery.length > 0) {
      const res = await source.getMatchingRowsWithMatches({
        offset: rowsOffset,
        limit: fetchLimit,
        query: state.searchQuery,
        useRegex: state.searchUseRegex,
        wholeWord: state.searchWholeWord,
        caseSensitive: state.searchCaseSensitive,
      });
      visibleRows = res.rows;
      visibleMatches = res.matches;
    } else {
      visibleRows = await source.getRows(rowsOffset, fetchLimit);
      visibleMatches = visibleRows.map((r) => r.map(() => false));
    }
  }

  // 3. Horizontal scrolling (if needed by cursor)
  if (selectionMode !== "row" && cursorCol < colsOffset) {
    colsOffset = cursorCol;
  }

  let dispHeaders = headers.slice(colsOffset);
  const getAdjustedOverrides = (offset: number) => {
    const adjusted: Record<number, number> = {};
    for (const [idx, width] of Object.entries(columnOverrides)) {
      const i = parseInt(idx);
      if (i >= offset) adjusted[i - offset] = width;
    }
    return adjusted;
  };

  const gutterWidth = String(state.totalRowCount).length;
  const dataPadding = 2;
  const effectiveW = termW - gutterWidth - dataPadding;

  let colWidths = computeColumnWidths(
    dispHeaders,
    visibleRows.map((r) => r.slice(colsOffset)),
    effectiveW,
    getAdjustedOverrides(colsOffset),
  );

  if (selectionMode !== "row") {
    let relC = cursorCol - colsOffset;
    let tw = 0;
    for (let i = 0; i < relC; i++) tw += colWidths[i] || 0;

    while (
      (relC >= colWidths.length || tw + (colWidths[relC] || 0) > effectiveW) &&
      colsOffset < headers.length - 1
    ) {
      colsOffset++;
      relC = cursorCol - colsOffset;
      dispHeaders = headers.slice(colsOffset);
      colWidths = computeColumnWidths(
        dispHeaders,
        visibleRows.map((r) => r.slice(colsOffset)),
        effectiveW,
        getAdjustedOverrides(colsOffset),
      );
      tw = 0;
      for (let i = 0; i < relC; i++) tw += colWidths[i] || 0;
    }
  }

  // 4. Vertical "auto-scroll" if cursor past bottom
  const rowHeights = computeRowHeights(
    visibleRows.map((r) => r.slice(colsOffset, colsOffset + colWidths.length)),
    colWidths,
    wrapMode,
  );
  let curH = 0,
    visCount = 0;
  // termH already excludes status bar, subtract: blank line + header + separator + bottom separator + 1 buffer
  const availableRowHeight = termH - 5;
  for (const h of rowHeights) {
    if (curH + h > availableRowHeight && visCount > 0) break;
    curH += h;
    visCount++;
  }

  const relativeCursor = cursorRow - rowsOffset;
  // Scroll when cursor goes past last visible row
  if (relativeCursor >= visCount && selectionMode !== "column") {
    const diff = relativeCursor - visCount + 1;
    rowsOffset += diff;
    // Re-fetch rows after auto-scroll
    if (state.searchQuery.length > 0) {
      const res = await source.getMatchingRowsWithMatches({
        offset: rowsOffset,
        limit: fetchLimit,
        query: state.searchQuery,
        useRegex: state.searchUseRegex,
        wholeWord: state.searchWholeWord,
        caseSensitive: state.searchCaseSensitive,
      });
      visibleRows = res.rows;
      visibleMatches = res.matches;
    } else {
      visibleRows = await source.getRows(rowsOffset, fetchLimit);
      visibleMatches = visibleRows.map((r) => r.map(() => false));
    }
  }

  return { rowsOffset, colsOffset, visibleRows, visibleMatches };
}
