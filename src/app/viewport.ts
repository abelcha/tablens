import type { State } from "src/types";
import { Engine } from "src/engine/Engine";
import type { FilterQuery, ViewSpec } from "src/engine/types";
import { computeColumnWidths, computeRowHeights } from "src/layout/calculator";

export interface ViewportPatch {
  rowsOffset: number;
  colsOffset: number;
  visibleRows: string[][];
  visibleMatches: boolean[][];
  totalRows: number;
  pageCache: PageWindowCache | null;
}

export type PageWindowCache = {
  viewKey: string;
  startOffset: number;
  rows: string[][];
  matches: boolean[][];
  totalRows: number;
};

function buildFilterQuery(state: State): FilterQuery {
  const filter: FilterQuery = {};
  for (const [colIdxStr, values] of Object.entries(state.columnFilterSelectionsByCol)) {
    if (!values || values.length === 0) continue;
    const colIdx = Number(colIdxStr);
    const column = state.headers[colIdx];
    if (!column) continue;
    const hasNull = values.includes("(null)");
    const nonNull = values.filter((value) => value !== "(null)");
    if (hasNull && nonNull.length === 0) {
      filter[column] = { $isNull: true };
    } else if (hasNull) {
      filter[column] = { $in: nonNull, $isNull: true };
    } else {
      filter[column] = nonNull.length === 1 ? nonNull[0]! : { $in: nonNull };
    }
  }
  return filter;
}

function buildViewSpec(state: State): ViewSpec {
  const sort =
    state.sorter && state.headers[state.sorter.column]
      ? [
          {
            column: state.headers[state.sorter.column]!,
            direction: state.sorter.direction,
          },
        ]
      : [];

  const search =
    state.searchQuery.length > 0
      ? {
          query: state.searchQuery,
          useRegex: state.searchUseRegex,
          wholeWord: state.searchWholeWord,
          caseSensitive: state.searchCaseSensitive,
        }
      : null;

  return {
    sort,
    filter: buildFilterQuery(state),
    search,
  };
}

function buildViewKey(state: State): string {
  return JSON.stringify({
    sort: state.sorter && state.headers[state.sorter.column]
      ? [{ column: state.headers[state.sorter.column], direction: state.sorter.direction }]
      : [],
    filter: buildFilterQuery(state),
    search:
      state.searchQuery.length > 0
        ? {
            query: state.searchQuery,
            useRegex: state.searchUseRegex,
            wholeWord: state.searchWholeWord,
            caseSensitive: state.searchCaseSensitive,
          }
        : null,
  });
}

function makeFullWidthMatches(rowCount: number, columnCount: number): boolean[][] {
  return Array.from({ length: rowCount }, () => Array(columnCount).fill(false));
}

export async function computeViewportPatch(args: {
  state: State;
  termW: number;
  termH: number;
  source: Engine;
  lastRenderedOffset: number;
  lastRenderedQuery: string;
  lastRenderedUseRegex: boolean;
  lastRenderedWholeWord: boolean;
  lastRenderedCaseSensitive: boolean;
  lastRenderedSorter: { column: number; direction: "asc" | "desc" } | null;
  lastRenderedFilters: string;
  pageCache: PageWindowCache | null;
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
    lastRenderedFilters,
    pageCache,
  } = args;
  const { headers, selectionMode, cursorRow, cursorCol, wrapMode, columnOverrides } = state;
  let { rowsOffset, colsOffset, visibleRows, visibleMatches } = state;

  const fetchLimit = Math.max(Math.floor((termH || 20) * 2), 200);
  const cacheLimit = Math.max(fetchLimit * 4, 500);
  const view = buildViewSpec(state);
  const viewKey = buildViewKey(state);
  const includeMatches = view.search !== null;

  if (selectionMode !== "column" && cursorRow < rowsOffset) {
    rowsOffset = cursorRow;
  }

  const queryChanged =
    state.searchQuery !== lastRenderedQuery ||
    state.searchUseRegex !== lastRenderedUseRegex ||
    state.searchWholeWord !== lastRenderedWholeWord ||
    state.searchCaseSensitive !== lastRenderedCaseSensitive ||
    JSON.stringify(state.sorter) !== JSON.stringify(lastRenderedSorter) ||
    JSON.stringify(state.columnFilterSelectionsByCol) !== lastRenderedFilters;

  if (queryChanged) {
    rowsOffset = state.rowsOffset;
  }

  let totalRows = state.totalRowCount;
  const cacheStart = pageCache && pageCache.viewKey === viewKey ? pageCache.startOffset : -1;
  const cacheEnd = pageCache && pageCache.viewKey === viewKey ? pageCache.startOffset + pageCache.rows.length : -1;
  const canServeFromCache =
    pageCache !== null &&
    pageCache.viewKey === viewKey &&
    rowsOffset >= cacheStart &&
    rowsOffset + fetchLimit <= cacheEnd;

  let nextCache = pageCache;
  const needsFetch = visibleRows.length === 0 || queryChanged || !canServeFromCache;

  if (canServeFromCache && !needsFetch) {
    const rel = rowsOffset - pageCache!.startOffset;
    visibleRows = pageCache!.rows.slice(rel, rel + fetchLimit);
    visibleMatches = pageCache!.matches.slice(rel, rel + fetchLimit);
    totalRows = pageCache!.totalRows;
  } else {
    const res = await source.getPage({
      view,
      offset: rowsOffset,
      limit: cacheLimit,
      columns: headers,
      includeMatches,
    });
    nextCache = {
      viewKey,
      startOffset: rowsOffset,
      rows: res.rows,
      matches: res.matches || makeFullWidthMatches(res.rows.length, headers.length),
      totalRows: res.totalRows,
    };
    visibleRows = nextCache.rows.slice(0, fetchLimit);
    visibleMatches = nextCache.matches.slice(0, fetchLimit);
    totalRows = nextCache.totalRows;
  }

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

  const gutterWidth = String(totalRows).length;
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

  const rowHeights = computeRowHeights(
    visibleRows.map((r) => r.slice(colsOffset, colsOffset + colWidths.length)),
    colWidths,
    wrapMode,
  );
  let curH = 0;
  let visCount = 0;
  const availableRowHeight = termH - 5;
  for (const h of rowHeights) {
    if (curH + h > availableRowHeight && visCount > 0) break;
    curH += h;
    visCount++;
  }

  const relativeCursor = cursorRow - rowsOffset;
  if (relativeCursor >= visCount && selectionMode !== "column") {
    const diff = relativeCursor - visCount + 1;
    rowsOffset += diff;
    if (
      nextCache &&
      nextCache.viewKey === viewKey &&
      rowsOffset >= nextCache.startOffset &&
      rowsOffset + fetchLimit <= nextCache.startOffset + nextCache.rows.length
    ) {
      const rel = rowsOffset - nextCache.startOffset;
      visibleRows = nextCache.rows.slice(rel, rel + fetchLimit);
      visibleMatches = nextCache.matches.slice(rel, rel + fetchLimit);
      totalRows = nextCache.totalRows;
    } else {
      const res = await source.getPage({
        view,
        offset: rowsOffset,
        limit: cacheLimit,
        columns: headers,
        includeMatches,
      });
      nextCache = {
        viewKey,
        startOffset: rowsOffset,
        rows: res.rows,
        matches: res.matches || makeFullWidthMatches(res.rows.length, headers.length),
        totalRows: res.totalRows,
      };
      visibleRows = nextCache.rows.slice(0, fetchLimit);
      visibleMatches = nextCache.matches.slice(0, fetchLimit);
      totalRows = nextCache.totalRows;
    }
  }

  return { rowsOffset, colsOffset, visibleRows, visibleMatches, totalRows, pageCache: nextCache };
}
