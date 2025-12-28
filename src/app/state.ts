import { State, SelectionMode } from "../types";
import { Action } from "./actions";

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
        sorter: null,
        wrapMode: "disabled",
        columnOverrides: {},
        headers: [],
        totalRowCount: 0,
        visibleRows: [],
        lastRequestId: 0,
        counter: 0,
    };
}

export function reducer(state: State & { lastRequestId: number; counter: number }, action: Action): State & { lastRequestId: number; counter: number } {
    switch (action.type) {
        case "INC_COUNTER":
            return { ...state, counter: state.counter + 1 };
        case "MOVE_UP": {
            const next = { ...state };
            if (state.selectionMode === 'column') {
                next.rowsOffset = Math.max(0, state.rowsOffset - 1);
            } else {
                next.cursorRow = Math.max(0, state.cursorRow - 1);
            }
            return next;
        }
        case "MOVE_DOWN": {
            const next = { ...state };
            if (state.selectionMode === 'column') {
                next.rowsOffset = Math.min(state.totalRowCount - 1, state.rowsOffset + 1);
            } else {
                next.cursorRow = Math.min(state.totalRowCount - 1, state.cursorRow + 1);
            }
            return next;
        }
        case "MOVE_LEFT": {
            const next = { ...state };
            if (state.selectionMode === 'row') {
                next.colsOffset = Math.max(0, state.colsOffset - 1);
            } else {
                next.cursorCol = Math.max(0, state.cursorCol - 1);
            }
            return next;
        }
        case "MOVE_RIGHT": {
            const next = { ...state };
            if (state.selectionMode === 'row') {
                next.colsOffset = Math.min(state.headers.length - 1, state.colsOffset + 1);
            } else {
                next.cursorCol = Math.min(state.headers.length - 1, state.cursorCol + 1);
            }
            return next;
        }
        case "PAGE_UP": {
            const next = { ...state };
            next.cursorRow = Math.max(0, state.cursorRow - action.pageSize);
            next.rowsOffset = Math.max(0, state.rowsOffset - action.pageSize);
            return next;
        }
        case "PAGE_DOWN": {
            const next = { ...state };
            next.cursorRow = Math.min(state.totalRowCount - 1, state.cursorRow + action.pageSize);
            if (next.cursorRow >= state.rowsOffset + action.pageSize) {
                next.rowsOffset = next.cursorRow - action.pageSize + 1;
                if (next.rowsOffset < 0) next.rowsOffset = 0;
            }
            return next;
        }
        case "CYCLE_SELECTION_MODE": {
            let nextMode: SelectionMode = "row";
            if (state.selectionMode === 'row') nextMode = 'column';
            else if (state.selectionMode === 'column') nextMode = 'cell';
            else nextMode = 'row';
            return { ...state, selectionMode: nextMode };
        }
        case "SET_TOTAL_ROW_COUNT":
            return { ...state, totalRowCount: action.count };
        case "SET_HEADERS":
            return { ...state, headers: action.headers };
        case "APPLY_VIEWPORT_PATCH":
            // Only apply if it's the latest request
            if (action.requestId >= state.lastRequestId) {
                return { ...state, ...action.patch, lastRequestId: action.requestId };
            }
            return state;
        case "RESIZE_COLUMN": {
            if (state.selectionMode !== 'column') return state;
            // Use provided currentWidth if available, otherwise use override, otherwise use header length
            const currentWidth = action.currentWidth !== undefined
                ? action.currentWidth
                : (state.columnOverrides[state.cursorCol] !== undefined 
                    ? state.columnOverrides[state.cursorCol] 
                    : (state.headers[state.cursorCol]?.length || 10));
            const nextWidth = Math.max(1, currentWidth + action.delta);
            return {
                ...state,
                columnOverrides: {
                    ...state.columnOverrides,
                    [state.cursorCol]: nextWidth
                }
            };
        }
        default:
            return state;
    }
}
