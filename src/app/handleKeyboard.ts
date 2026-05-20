import { type KeyEvent } from "@opentui/core";
import type { Engine } from "src/engine/Engine";
import type { Action } from "src/app/actions";
import { keyToActions } from "src/app/keyboard";
import type { TableContentModel } from "src/app/render";
import { initialState } from "src/app/state";

type AppState = ReturnType<typeof initialState>;

type QueryEditorHandle = {
  getText?: () => string;
  autocomplete?: {
    isVisible: boolean;
    dismiss: () => void;
    selectPrev: () => void;
    selectNext: () => void;
    trigger?: () => void;
    confirm: () => void;
  };
};

type ConsoleHandle = {
  visible: boolean;
  toggle: () => void;
  blur: () => void;
};

function consoleHasFocus(console: ConsoleHandle) {
  return (console as ConsoleHandle & { isFocused?: boolean }).isFocused === true;
}

function syncConsoleCapture(console: ConsoleHandle, captureRef?: { current: boolean }) {
  if (!captureRef) return;
  captureRef.current = consoleHasFocus(console);
}

function isConsoleCapturingKeys(
  console: ConsoleHandle,
  captureRef?: { current: boolean },
) {
  if (captureRef?.current) return true;
  return consoleHasFocus(console);
}

export type KeyboardContext = {
  dispatch: (action: Action) => void;
  renderer: {
    destroy: () => void;
    terminalHeight: number;
    console: ConsoleHandle;
  };
  source: Engine;
  state: AppState;
  filteredColumnFilterData: Array<{ value: string; count: number; percent: number }>;
  activeColumnFilterCursor: number;
  columnFilterPageSize: number;
  queryEditorRef: { current: QueryEditorHandle | null };
  performColumnFilter: (columnName: string, values: string[]) => void;
  performRename: (oldName: string, newName: string) => void;
  handleSavePathSubmit: (path: string) => void;
  handleQuerySubmit: (sql: string) => void;
  tableContent: TableContentModel | null;
  /** Tracks console keyboard focus; synced on toggle / escape */
  consoleCaptureRef?: { current: boolean };
};

export function handleTablensKey(key: KeyEvent, ctx: KeyboardContext): void {
  const {
    dispatch,
    renderer,
    source,
    state,
    filteredColumnFilterData,
    activeColumnFilterCursor,
    columnFilterPageSize,
    queryEditorRef,
    performColumnFilter,
    performRename,
    handleSavePathSubmit,
    handleQuerySubmit,
    tableContent,
    consoleCaptureRef,
  } = ctx;

  const { headers, cursorCol } = state;
  const {
    columnFilterSearchActive,
    columnFilterSearchQuery,
    columnFilterSelectedValues,
    columnFilterCol,
    savePathPromptActive,
    savePathQuery,
    queryEditorActive,
  } = state;

  if (key.ctrl && key.name === "c") {
    renderer.destroy();
    process.exit(0);
  }

  if (key.ctrl && key.name === "`") {
    renderer.console.toggle();
    syncConsoleCapture(renderer.console, consoleCaptureRef);
    return;
  }
  if (key.name === "`") {
    renderer.console.toggle();
    syncConsoleCapture(renderer.console, consoleCaptureRef);
    return;
  }

  // Console stays visible after Escape (blur only). Block app keys only while focused.
  if (isConsoleCapturingKeys(renderer.console, consoleCaptureRef)) {
    if (key.name === "escape") {
      renderer.console.blur();
      if (consoleCaptureRef) consoleCaptureRef.current = false;
    }
    return;
  }

  if (key.name === "escape" && renderer.console.visible) {
    renderer.console.blur();
    if (consoleCaptureRef) consoleCaptureRef.current = false;
  }

  if (state.showHelp) {
    dispatch({ type: "TOGGLE_HELP" });
    return;
  }

  if (state.showColumnFilter) {
    if (columnFilterSearchActive) {
      if (key.name === "up" || key.name === "k" || key.name === "K") {
        dispatch({
          type: "MOVE_FILTER_CURSOR",
          delta: -1,
          visibleCount: filteredColumnFilterData.length,
        });
        return;
      }
      if (key.name === "down" || key.name === "j" || key.name === "J") {
        dispatch({
          type: "MOVE_FILTER_CURSOR",
          delta: 1,
          visibleCount: filteredColumnFilterData.length,
        });
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        dispatch({ type: "EXIT_COLUMN_FILTER_SEARCH" });
        return;
      }
      if (key.name === "escape") {
        dispatch({ type: "EXIT_COLUMN_FILTER_SEARCH" });
        return;
      }
      if (key.name === "backspace") {
        dispatch({
          type: "SET_COLUMN_FILTER_SEARCH_QUERY",
          query: columnFilterSearchQuery.slice(0, -1),
        });
        return;
      }
      if (!key.ctrl && !key.meta && typeof key.raw === "string" && key.raw.length === 1) {
        dispatch({
          type: "SET_COLUMN_FILTER_SEARCH_QUERY",
          query: `${columnFilterSearchQuery}${key.raw}`,
        });
        return;
      }
      return;
    }
    if (key.name === "escape" || key.name === "q") {
      dispatch({ type: "CLOSE_COLUMN_FILTER" });
      return;
    }
    if (key.name === "/") {
      dispatch({ type: "ENTER_COLUMN_FILTER_SEARCH" });
      return;
    }
    if (key.name === "r" || key.name === "R") {
      dispatch({ type: "RESET_COLUMN_FILTER" });
      return;
    }
    if (key.name === "up" || key.name === "k" || key.name === "K") {
      dispatch({
        type: "MOVE_FILTER_CURSOR",
        delta: -1,
        visibleCount: filteredColumnFilterData.length,
      });
      return;
    }
    if (key.name === "down" || key.name === "j" || key.name === "J") {
      dispatch({
        type: "MOVE_FILTER_CURSOR",
        delta: 1,
        visibleCount: filteredColumnFilterData.length,
      });
      return;
    }
    if (key.name === "pageup") {
      dispatch({
        type: "MOVE_FILTER_CURSOR",
        delta: -columnFilterPageSize,
        visibleCount: filteredColumnFilterData.length,
      });
      return;
    }
    if (key.name === "pagedown") {
      dispatch({
        type: "MOVE_FILTER_CURSOR",
        delta: columnFilterPageSize,
        visibleCount: filteredColumnFilterData.length,
      });
      return;
    }
    if (key.name === "space" || key.raw === " ") {
      const selectedItem = filteredColumnFilterData[activeColumnFilterCursor];
      if (selectedItem) {
        dispatch({ type: "TOGGLE_COLUMN_FILTER_VALUE", value: selectedItem.value });
      }
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      const selectedValues = columnFilterSelectedValues;
      const currentItem = filteredColumnFilterData[activeColumnFilterCursor];
      const values =
        selectedValues.length > 0
          ? selectedValues
          : currentItem
            ? [currentItem.value]
            : [];
      const columnName = headers[columnFilterCol || 0];
      if (columnName && values.length > 0) {
        performColumnFilter(columnName, values);
      }
      return;
    }
    return;
  }

  if (key.option && key.name === "r") {
    dispatch({ type: "TOGGLE_SEARCH_REGEX" });
    return;
  }
  if (key.option && key.name === "w") {
    dispatch({ type: "TOGGLE_SEARCH_WHOLE_WORD" });
    return;
  }
  if (key.option && key.name === "c") {
    dispatch({ type: "TOGGLE_SEARCH_CASE_SENSITIVE" });
    return;
  }

  if (state.colSearchActive) {
    if (key.name === "escape") {
      dispatch({ type: "EXIT_COL_SEARCH" });
      return;
    }
    return;
  }

  if (state.searchActive) {
    if (key.name === "escape") {
      dispatch({ type: "EXIT_SEARCH" });
      return;
    }
    return;
  }

  if (state.renameActive) {
    if (key.name === "escape") {
      dispatch({ type: "EXIT_RENAME_COLUMN" });
      return;
    }
    if (key.name === "return") {
      const oldName = headers[cursorCol];
      if (oldName) performRename(oldName, state.renameQuery);
      return;
    }
    return;
  }

  if (savePathPromptActive) {
    if (key.name === "escape") {
      dispatch({ type: "EXIT_SAVE_PATH_PROMPT" });
      return;
    }
    if (key.name === "return") {
      handleSavePathSubmit(savePathQuery);
      return;
    }
    return;
  }

  if (queryEditorActive) {
    const autocomplete = queryEditorRef.current?.autocomplete;

    if (key.name === "escape") {
      if (autocomplete?.isVisible) {
        autocomplete.dismiss();
      } else {
        dispatch({ type: "CLOSE_QUERY_EDITOR" });
      }
      return;
    }
    if (key.name === "tab") {
      if (autocomplete?.isVisible) {
        if (key.shift) {
          autocomplete.selectPrev();
        } else {
          autocomplete.selectNext();
        }
      } else {
        autocomplete?.trigger?.();
      }
      return;
    }
    if ((key.name === "down" || key.name === "up") && autocomplete?.isVisible) {
      if (key.name === "down") {
        autocomplete.selectNext();
      } else {
        autocomplete.selectPrev();
      }
      return;
    }
    if (key.name === "return" && !key.shift) {
      if (autocomplete?.isVisible) {
        autocomplete.confirm();
        return;
      }
      const text = queryEditorRef.current?.getText?.() || "";
      handleQuerySubmit(text);
      return;
    }
    return;
  }

  if (key.name === "y") {
    dispatch({
      type: "YANK",
      selectionMode: state.selectionMode,
      cursorRow: state.cursorRow,
      cursorCol: state.cursorCol,
      visibleRows: state.visibleRows,
      headers: state.headers,
      rowsOffset: state.rowsOffset,
    });
    return;
  }

  if (key.name === "e" && state.selectionMode === "column") return;
  if ((key.name === "U" || (key.name === "u" && key.shift)) && state.selectionMode === "column")
    return;
  if (key.name === "u" && state.selectionMode === "column") return;
  if (key.name === "d" && state.selectionMode === "column") return;

  if (key.name === "s") {
    dispatch({
      type: "PROMPT_SAVE_PATH",
      defaultPath: source.suggestSavePath(),
    });
    return;
  }

  if (key.name === "t") {
    if (!state.showTypes && state.columnTypes.length === 0) {
      source.getColumnTypes().then((types) => {
        dispatch({ type: "SET_COLUMN_TYPES", types });
        dispatch({ type: "TOGGLE_SHOW_TYPES" });
      });
    } else {
      dispatch({ type: "TOGGLE_SHOW_TYPES" });
    }
    return;
  }

  if (key.name === "i") {
    if (!state.showStats && state.columnStats.length === 0) {
      source.getColumnStats().then((stats) => {
        dispatch({ type: "SET_COLUMN_STATS", stats });
        dispatch({ type: "TOGGLE_SHOW_STATS" });
      });
    } else {
      dispatch({ type: "TOGGLE_SHOW_STATS" });
    }
    return;
  }

  if (key.name === "f" && state.selectionMode === "column") {
    if (state.showColumnFilter) {
      dispatch({ type: "CLOSE_COLUMN_FILTER" });
    } else {
      dispatch({ type: "OPEN_COLUMN_FILTER" });
      source.getColumnValueDistribution(state.cursorCol).then((data) => {
        dispatch({ type: "SET_COLUMN_FILTER_DATA", data: data || [] });
      });
    }
    return;
  }

  if (key.raw === ":") {
    const editorQuery =
      state.queryEditorValue.trim().length > 0
        ? state.queryEditorValue
        : source.getQuery();
    dispatch({
      type: "OPEN_QUERY_EDITOR",
      query: editorQuery,
    });
    return;
  }

  const pageSize = renderer.terminalHeight - 4;
  const actions = keyToActions(key, { pageSize });
  actions.forEach((action) => {
    if (
      action.type === "RESIZE_COLUMN" &&
      tableContent &&
      state.selectionMode === "column"
    ) {
      const colIdx = state.cursorCol - state.colsOffset;
      if (colIdx >= 0 && colIdx < tableContent.colWidths.length) {
        dispatch({ ...action, currentWidth: tableContent.colWidths[colIdx] });
        return;
      }
    }
    dispatch(action);
  });

  if (key.name === "q") {
    renderer.destroy();
    process.exit(0);
  }
}
