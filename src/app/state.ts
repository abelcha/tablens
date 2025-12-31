import type { State, SelectionMode } from "src/types";
import type { Action } from "src/app/actions";
import { copyToClipboard, formatRowAsCsv } from "src/utils/clipboard";

export function initialState(): State & { lastRequestId: number; counter: number } {
  return {
    rowsOffset: 0,
    colsOffset: 0,
    cursorRow: 0,
    cursorCol: 0,
    numFreezeCols: 0,
    selectionMode: "row",
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
    isMaterialized: false,
    lastRequestId: 0,
    counter: 0,
  };
}

export function reducer(
  state: State & { lastRequestId: number; counter: number },
  action: Action,
): State & { lastRequestId: number; counter: number } {
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
      return next;
    }
    case "MOVE_DOWN": {
      const next = { ...state };
      const maxRows = state.searchMatchRowCount !== null ? state.searchMatchRowCount : state.totalRowCount;
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
      return next;
    }
    case "MOVE_LEFT": {
      const next = { ...state };
      if (state.selectionMode === "row") {
        next.colsOffset = Math.max(0, state.colsOffset - 1);
      } else {
        next.cursorCol = Math.max(0, state.cursorCol - 1);
      }
      return next;
    }
    case "MOVE_RIGHT": {
      const next = { ...state };
      if (state.selectionMode === "row") {
        next.colsOffset = Math.min(state.headers.length - 1, state.colsOffset + 1);
      } else {
        next.cursorCol = Math.min(state.headers.length - 1, state.cursorCol + 1);
      }
      return next;
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
      return next;
    }
    case "PAGE_DOWN": {
      const next = { ...state };
      const maxRows = state.searchMatchRowCount !== null ? state.searchMatchRowCount : state.totalRowCount;
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
      return next;
    }
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
    case "SET_MATERIALIZED":
      return { ...state, isMaterialized: action.isMaterialized };
    case "SET_TOTAL_ROW_COUNT": {
      const maxRows = state.searchMatchRowCount !== null ? state.searchMatchRowCount : action.count;
      return {
        ...state,
        totalRowCount: action.count,
        cursorRow: maxRows <= 0 ? 0 : Math.max(0, Math.min(maxRows - 1, state.cursorRow)),
        rowsOffset: maxRows <= 0 ? 0 : Math.max(0, Math.min(maxRows - 1, state.rowsOffset)),
      };
    }
    case "SET_HEADERS":
      return { ...state, headers: action.headers };
    case "APPLY_VIEWPORT_PATCH":
      // Only apply if it's the latest request
      if (action.requestId >= state.lastRequestId) {
        return { ...state, ...action.patch, lastRequestId: action.requestId };
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
    case "AUTO_RESIZE_COLUMNS": {
      const hasOverrides = Object.keys(state.columnOverrides).length > 0;
      
      if (hasOverrides) {
        // Reset to default (clear all overrides)
        return {
          ...state,
          columnOverrides: {},
        };
      }
      
      // Auto-resize all columns to fit header and cell content
      const widths: Record<number, number> = {};
      const MIN_COLUMN_WIDTH = 6;
      
      for (let colIdx = 0; colIdx < action.headers.length; colIdx++) {
        const headerLength = action.headers[colIdx]?.length || 0;
        let maxCellLength = 0;
        
        // Check all visible rows for this column
        for (const row of action.visibleRows) {
          if (colIdx < row.length) {
            const cell = row[colIdx] || "";
            // For multi-line cells, check each line
            const lines = cell.split("\n");
            for (const line of lines) {
              maxCellLength = Math.max(maxCellLength, line.length);
            }
          }
        }
        
        // Set width to max of header and max cell content, with minimum width
        widths[colIdx] = Math.max(headerLength, maxCellLength, MIN_COLUMN_WIDTH);
      }
      
      return {
        ...state,
        columnOverrides: widths,
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
    default:
      return state;
  }
}
