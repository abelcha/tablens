import type { State, SelectionMode } from "src/types";
import type { Action } from "src/app/actions";
import { copyToClipboard, formatRowAsCsv } from "src/utils/clipboard";

type ExtendedState = State & {
  lastRequestId: number;
  viewportPending: boolean;
  scrollRowsPerSec: number | null;
  scrollBenchAt: number;
  counter: number;
  renameActive: boolean;
  renameQuery: string;
  savePathPromptActive: boolean;
  savePathQuery: string;
  queryEditorActive: boolean;
  queryEditorValue: string;
  showTypes: boolean;
  columnTypes: string[];
  showStats: boolean;
  columnStats: string[];
  loadError: string | null;
};

export function initialState(): ExtendedState {
  return {
    rowsOffset: 0,
    colsOffset: 0,
    cursorRow: 0,
    cursorCol: 0,
    numFreezeCols: 0,
    selectionMode: "column",
    markedRows: new Set(),
    found: [],
    searchActive: false,
    searchQuery: "",
    searchUseRegex: false,
    searchWholeWord: false,
    searchCaseSensitive: false,
    searchMatchRowCount: null,
    searchError: null,
    visibleMatches: [],
    sorter: null,
    wrapMode: "disabled",
    columnOverrides: {},
    headers: [],
    totalRowCount: 0,
    visibleRows: [],
    lastRequestId: 0,
    viewportPending: false,
    scrollRowsPerSec: null,
    scrollBenchAt: 0,
    counter: 0,
    renameActive: false,
    renameQuery: "",
    savePathPromptActive: false,
    savePathQuery: "",
    queryEditorActive: false,
    queryEditorValue: "",
    showTypes: false,
    columnTypes: [],
    showStats: false,
    columnStats: [],
    showHelp: false,
    columnWidthMode: "compact",
    colSearchActive: false,
    colSearchQuery: "",
    showColumnFilter: false,
    columnFilterCol: null,
    columnFilterData: null,
    columnFilterCursor: 0,
    columnFilterSelectedValues: [],
    columnFilterSelectionsByCol: {},
    columnFilterSearchActive: false,
    columnFilterSearchQuery: "",
    loadError: null,
  };
}

/**
 * Gate scroll input while a viewport fetch is in flight.
 *
 * If we advance rowsOffset/cursorRow before visibleRows catches up, the UI desyncs: gutter row
 * numbers move (they use rowsOffset) but cell text stays on the old page — "frozen cells".
 * Do not remove this guard to "speed up" scroll; use viewport PageWindowCache + trySyncViewportPatch
 * and Engine row-id pagination instead of materializing parquet into DuckDB.
 */
function acceptViewportScroll(state: ExtendedState, next: ExtendedState) {
  if (state.viewportPending) return state;
  if (
    next.cursorRow === state.cursorRow &&
    next.cursorCol === state.cursorCol &&
    next.rowsOffset === state.rowsOffset &&
    next.colsOffset === state.colsOffset
  ) {
    return state;
  }
  return { ...next, viewportPending: true };
}

function sampleScrollSpeed(state: ExtendedState, next: ExtendedState) {
  const useOffset = state.selectionMode === "column";
  const before = useOffset ? state.rowsOffset : state.cursorRow;
  const after = useOffset ? next.rowsOffset : next.cursorRow;
  const delta = Math.abs(after - before);
  if (delta === 0) {
    return { scrollRowsPerSec: state.scrollRowsPerSec, scrollBenchAt: state.scrollBenchAt };
  }

  const now = performance.now();
  const elapsed = state.scrollBenchAt > 0 ? now - state.scrollBenchAt : 0;
  const instant = elapsed >= 16 ? (delta / elapsed) * 1000 : null;
  const prev = state.scrollRowsPerSec;
  const smoothed =
    instant !== null && prev !== null
      ? Math.round(prev * 0.55 + instant * 0.45)
      : instant ?? prev;

  return {
    scrollRowsPerSec: smoothed ?? instant,
    scrollBenchAt: now,
  };
}

function applyVerticalScroll(state: ExtendedState, next: ExtendedState) {
  const scrolled = acceptViewportScroll(state, next);
  if (scrolled === state) return state;
  return { ...scrolled, ...sampleScrollSpeed(state, scrolled) };
}

export function reducer(state: ExtendedState, action: Action): ExtendedState {
  switch (action.type) {
    case "INC_COUNTER":
      return { ...state, counter: state.counter + 1 };
    case "MOVE_UP": {
      const next = { ...state };
      if (state.selectionMode === "column") {
        // In column mode, scroll up as if cursor is at first visible row
        next.rowsOffset = Math.max(0, state.rowsOffset - 1);
      } else {
        next.cursorRow = Math.max(0, state.cursorRow - 1);
        // Push rowsOffset up if cursor moves above it
        if (next.cursorRow < next.rowsOffset) {
          next.rowsOffset = next.cursorRow;
        }
      }
      return applyVerticalScroll(state, next);
    }
    case "MOVE_DOWN": {
      const next = { ...state };
      const maxRows =
        state.searchMatchRowCount !== null ? state.searchMatchRowCount : state.totalRowCount;
      if (state.selectionMode === "column") {
        // In column mode, scroll down as if cursor is at last visible row
        const maxScroll = Math.max(0, maxRows - action.pageSize);
        next.rowsOffset = Math.max(0, Math.min(maxScroll, state.rowsOffset + 1));
      } else {
        next.cursorRow = Math.max(0, Math.min(maxRows - 1, state.cursorRow + 1));
        // Push rowsOffset down if cursor moves below it
        if (next.cursorRow >= next.rowsOffset + action.pageSize) {
          next.rowsOffset = next.cursorRow - action.pageSize + 1;
        }
      }
      return applyVerticalScroll(state, next);
    }
    case "MOVE_LEFT": {
      const next = { ...state };
      if (state.selectionMode === "row") {
        next.colsOffset = Math.max(0, state.colsOffset - 1);
      } else {
        next.cursorCol = Math.max(0, state.cursorCol - 1);
      }
      return acceptViewportScroll(state, next);
    }
    case "MOVE_RIGHT": {
      const next = { ...state };
      if (state.selectionMode === "row") {
        next.colsOffset = Math.min(state.headers.length - 1, state.colsOffset + 1);
      } else {
        next.cursorCol = Math.min(state.headers.length - 1, state.cursorCol + 1);
      }
      return acceptViewportScroll(state, next);
    }
    case "PAGE_UP": {
      const next = { ...state };
      const isAtTop = state.cursorRow === state.rowsOffset;
      if (isAtTop) {
        next.cursorRow = Math.max(0, state.cursorRow - action.pageSize);
        next.rowsOffset = Math.max(0, state.rowsOffset - action.pageSize);
      } else {
        // Move cursor to top of current page
        next.cursorRow = state.rowsOffset;
      }
      return applyVerticalScroll(state, next);
    }
    case "PAGE_DOWN": {
      const next = { ...state };
      const maxRows =
        state.searchMatchRowCount !== null ? state.searchMatchRowCount : state.totalRowCount;
      const lastVisibleRow = state.rowsOffset + action.pageSize - 3;
      const isAtBottom = state.cursorRow >= lastVisibleRow;
      if (isAtBottom) {
        next.cursorRow = Math.max(0, Math.min(maxRows - 1, state.cursorRow + action.pageSize));
        next.rowsOffset =
          next.cursorRow - action.pageSize + 1 < 0 ? 0 : next.cursorRow - action.pageSize + 1;
      } else {
        next.cursorRow = Math.max(0, Math.min(maxRows - 1, lastVisibleRow));
      }
      // Final clamp for rowsOffset
      next.rowsOffset = Math.max(0, Math.min(maxRows - 1, next.rowsOffset));
      return applyVerticalScroll(state, next);
    }
    case "CLEAR_SCROLL_SPEED":
      return { ...state, scrollRowsPerSec: null, scrollBenchAt: 0 };
    case "CYCLE_SELECTION_MODE": {
      let nextMode: SelectionMode = "row";
      if (state.selectionMode === "row") nextMode = "column";
      else if (state.selectionMode === "column") nextMode = "cell";
      else nextMode = "row";
      return { ...state, selectionMode: nextMode };
    }
    case "ENTER_SEARCH":
      return {
        ...state,
        searchActive: true,
        // keep previous query/toggles like vscode
      };
    case "EXIT_SEARCH":
      return { ...state, searchActive: false, searchError: null };
    case "SET_SEARCH_QUERY":
      return { ...state, searchQuery: action.query, searchError: null };
    case "TOGGLE_SEARCH_REGEX":
      return { ...state, searchUseRegex: !state.searchUseRegex, searchError: null };
    case "TOGGLE_SEARCH_WHOLE_WORD":
      return { ...state, searchWholeWord: !state.searchWholeWord, searchError: null };
    case "TOGGLE_SEARCH_CASE_SENSITIVE":
      return { ...state, searchCaseSensitive: !state.searchCaseSensitive, searchError: null };
    case "SET_SEARCH_MATCH_ROW_COUNT": {
      const isNewSearch = action.count !== null;
      const maxRows = isNewSearch ? action.count! : state.totalRowCount;
      return {
        ...state,
        searchMatchRowCount: action.count,
        cursorRow: isNewSearch ? 0 : Math.max(0, Math.min(maxRows - 1, state.cursorRow)),
        rowsOffset: isNewSearch ? 0 : Math.max(0, Math.min(maxRows - 1, state.rowsOffset)),
      };
    }
    case "SET_SEARCH_ERROR":
      return { ...state, searchError: action.error };
    case "SET_LOAD_ERROR":
      return {
        ...state,
        loadError: action.error,
        viewportPending: false,
        visibleRows: [],
        headers: action.error ? [] : state.headers,
        totalRowCount: action.error ? 0 : state.totalRowCount,
      };
    case "SORT": {
      if (state.selectionMode !== "column") return state;

      // Cycle nulls position: nulls last → nulls first → nulls last on repeat
      const cycleNulls = (
        current: "last" | "first" | undefined
      ): "last" | "first" => {
        if (current === undefined || current === "last") return "first";
        return "last";
      };

      // Check if toggling off (same column + direction)
      const sameColumnDirection =
        state.sorter !== null &&
        state.sorter.column === state.cursorCol &&
        state.sorter.direction === action.direction;

      if (sameColumnDirection) {
        // Cycle the nulls position, or clear sort if we've cycled back to nulls last
        if (state.sorter.nulls === "first") {
          return {
            ...state,
            sorter: null,
            rowsOffset: 0,
            cursorRow: 0,
          };
        }
        return {
          ...state,
          sorter: {
            column: state.sorter.column,
            direction: state.sorter.direction,
            nulls: cycleNulls(state.sorter.nulls),
          },
          rowsOffset: 0,
          cursorRow: 0,
        };
      }

      return {
        ...state,
        sorter: {
          column: state.cursorCol,
          direction: action.direction,
          nulls: "last",
        },
        rowsOffset: 0,
        cursorRow: 0,
      };
    }
    case "SET_TOTAL_ROW_COUNT": {
      const maxRows = state.searchMatchRowCount !== null ? state.searchMatchRowCount : action.count;
      return {
        ...state,
        totalRowCount: action.count,
        cursorRow: maxRows <= 0 ? 0 : Math.max(0, Math.min(maxRows - 1, state.cursorRow)),
        rowsOffset: maxRows <= 0 ? 0 : Math.max(0, Math.min(maxRows - 1, state.rowsOffset)),
      };
    }
    case "RESET_VIEWPORT":
      return {
        ...state,
        rowsOffset: 0,
        cursorRow: 0,
        colsOffset: action.preserveColumn ? state.colsOffset : 0,
        cursorCol: action.preserveColumn ? state.cursorCol : 0,
        viewportPending: true,
      };
    case "SET_HEADERS":
      return { ...state, headers: action.headers, columnTypes: [], columnStats: [] };
    case "SET_VIEWPORT_PENDING":
      return { ...state, viewportPending: action.pending };
    case "APPLY_VIEWPORT_PATCH":
      // Only apply if it's the latest request
      if (action.requestId >= state.lastRequestId) {
        return {
          ...state,
          ...action.patch,
          lastRequestId: action.requestId,
          viewportPending: false,
        };
      }
      return state;
    case "RESIZE_COLUMN": {
      if (state.selectionMode !== "column") return state;
      // Use provided currentWidth if available, otherwise use override, otherwise use header length
      const currentWidth =
        action.currentWidth !== undefined
          ? action.currentWidth
          : state.columnOverrides[state.cursorCol] !== undefined
            ? state.columnOverrides[state.cursorCol]!
            : state.headers[state.cursorCol]?.length || 10;
      const nextWidth = Math.max(1, currentWidth + action.delta);
      return {
        ...state,
        columnOverrides: {
          ...state.columnOverrides,
          [state.cursorCol]: nextWidth,
        },
      };
    }
    case "YANK": {
      const { selectionMode, cursorRow, cursorCol, visibleRows, headers, rowsOffset } = action;

      if (selectionMode === "cell") {
        // Copy cell value
        const relativeRow = cursorRow - rowsOffset;
        if (relativeRow >= 0 && relativeRow < visibleRows.length && cursorCol < headers.length) {
          const cellValue = visibleRows[relativeRow]?.[cursorCol] || "";
          copyToClipboard(cellValue).catch((err) => {
            console.error("Failed to copy to clipboard:", err);
          });
        }
      } else if (selectionMode === "row") {
        // Copy row as CSV
        const relativeRow = cursorRow - rowsOffset;
        if (relativeRow >= 0 && relativeRow < visibleRows.length) {
          const row = visibleRows[relativeRow];
          if (row) {
            const csv = formatRowAsCsv(row);
            copyToClipboard(csv).catch((err) => {
              console.error("Failed to copy to clipboard:", err);
            });
          }
        }
      } else if (selectionMode === "column") {
        // Copy header name
        if (cursorCol >= 0 && cursorCol < headers.length) {
          const headerName = headers[cursorCol];
          if (headerName) {
            copyToClipboard(headerName).catch((err) => {
              console.error("Failed to copy to clipboard:", err);
            });
          }
        }
      }

      // No state change, just side effect
      return state;
    }
    case "ENTER_RENAME_COLUMN": {
      if (state.selectionMode !== "column") return state;
      const currentHeader = state.headers[state.cursorCol] || "";
      return { ...state, renameActive: true, renameQuery: currentHeader };
    }
    case "EXIT_RENAME_COLUMN":
      return { ...state, renameActive: false, renameQuery: "" };
    case "SET_RENAME_QUERY":
      return { ...state, renameQuery: action.query };
    case "PROMPT_SAVE_PATH":
      return {
        ...state,
        savePathPromptActive: true,
        savePathQuery: action.defaultPath || "",
      };
    case "SET_SAVE_PATH_QUERY":
      return { ...state, savePathQuery: action.query };
    case "EXIT_SAVE_PATH_PROMPT":
      return { ...state, savePathPromptActive: false, savePathQuery: "" };
    case "OPEN_QUERY_EDITOR":
      return { ...state, queryEditorActive: true, queryEditorValue: action.query };
    case "SET_QUERY_EDITOR_VALUE":
      return { ...state, queryEditorValue: action.query };
    case "CLOSE_QUERY_EDITOR":
      return { ...state, queryEditorActive: false };
    case "SET_VISIBLE_ROWS":
      return { ...state, visibleRows: action.rows };
    case "TOGGLE_SHOW_TYPES":
      return { ...state, showTypes: !state.showTypes };
    case "SET_COLUMN_TYPES":
      return { ...state, columnTypes: action.types };
    case "TOGGLE_SHOW_STATS":
      return { ...state, showStats: !state.showStats };
    case "SET_COLUMN_STATS":
      return { ...state, columnStats: action.stats };
    case "TOGGLE_HELP":
      return { ...state, showHelp: !state.showHelp };
    case "CYCLE_COLUMN_WIDTH_MODE": {
      const next =
        state.columnWidthMode === "compact"
          ? "fitCells"
          : state.columnWidthMode === "fitCells"
            ? "fitCellsAndHeaders"
            : "compact";
      return { ...state, columnWidthMode: next, columnOverrides: {} };
    }
    case "ENTER_COL_SEARCH":
      return { ...state, colSearchActive: true };
    case "EXIT_COL_SEARCH":
      return { ...state, colSearchActive: false, colSearchQuery: "" };
    case "SET_COL_SEARCH_QUERY":
      return { ...state, colSearchQuery: action.query };
    case "OPEN_COLUMN_FILTER": {
      const openedCol = state.cursorCol;
      return {
        ...state,
        showColumnFilter: true,
        columnFilterCol: openedCol,
        columnFilterData: null,
        columnFilterCursor: 0,
        columnFilterSelectedValues: state.columnFilterSelectionsByCol[openedCol]?.slice() || [],
        columnFilterSearchActive: false,
        columnFilterSearchQuery: "",
      };
    }
    case "CLOSE_COLUMN_FILTER":
      return { 
        ...state, 
        showColumnFilter: false, 
        columnFilterData: null,
        columnFilterCursor: 0,
        columnFilterSearchActive: false,
        columnFilterSearchQuery: "",
      };
    case "SET_COLUMN_FILTER_DATA":
      return { ...state, columnFilterData: action.data };
    case "MOVE_FILTER_CURSOR": {
      if (!state.columnFilterData) return state;
      const len = Math.max(0, action.visibleCount);
      if (len === 0) return state;
      let newCursor = state.columnFilterCursor + action.delta;
      if (newCursor < 0) newCursor = 0;
      if (newCursor >= len) newCursor = len - 1;
      return { ...state, columnFilterCursor: newCursor };
    }
    case "ENTER_COLUMN_FILTER_SEARCH":
      return { ...state, columnFilterSearchActive: true };
    case "EXIT_COLUMN_FILTER_SEARCH":
      return { ...state, columnFilterSearchActive: false };
    case "SET_COLUMN_FILTER_SEARCH_QUERY":
      return { ...state, columnFilterSearchQuery: action.query, columnFilterCursor: 0 };
    case "RESET_COLUMN_FILTER": {
      const colIdx = state.columnFilterCol;
      return {
        ...state,
        columnFilterSearchActive: false,
        columnFilterSearchQuery: "",
        columnFilterSelectedValues: [],
        columnFilterCursor: 0,
        columnFilterSelectionsByCol:
          colIdx === null
            ? state.columnFilterSelectionsByCol
            : {
                ...state.columnFilterSelectionsByCol,
                [colIdx]: [],
              },
      };
    }
    case "TOGGLE_COLUMN_FILTER_VALUE": {
      const value = action.value;
      const selected = state.columnFilterSelectedValues;
      const exists = selected.includes(value);
      const nextSelected = exists
        ? selected.filter((v) => v !== value)
        : [...selected, value];
      const colIdx = state.columnFilterCol;
      return {
        ...state,
        columnFilterSelectedValues: nextSelected,
        columnFilterSelectionsByCol:
          colIdx === null
            ? state.columnFilterSelectionsByCol
            : {
                ...state.columnFilterSelectionsByCol,
                [colIdx]: nextSelected,
              },
      };
    }
    case "APPLY_COLUMN_FILTER":
      return { ...state, showColumnFilter: false };
    default:
      return state;
  }
}
