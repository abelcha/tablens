/** @jsxImportSource @opentui/react */
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { type KeyEvent } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { Engine } from "src/engine/Engine";
import type { EngineInput } from "src/engine/types";
import { keyToActions } from "src/app/keyboard";
import {
  computeCursorOverlay,
  computeHeaderOverlay,
  computeTableContentModel,
} from "src/app/render";
import { initialState, reducer } from "src/app/state";
import { computeViewportPatch } from "src/app/viewport";
import { SearchBar } from "src/app/components/SearchBar";
import { ColSearchBar } from "src/app/components/ColSearchBar";
import { StatusLine } from "src/app/components/StatusLine";
import { EmptyState } from "src/app/components/EmptyState";
import { RenameBar } from "src/app/components/RenameBar";
import { SavePathBar } from "src/app/components/SavePathBar";
import { QueryEditor } from "src/app/components/QueryEditor";
import { HelpModal } from "src/app/components/HelpModal";
import { ColumnFilterModal } from "src/app/components/ColumnFilterModal";
import { parseInlineMarkup } from "src/app/markup";
import type { PageWindowCache } from "src/app/viewport";

declare module "@opentui/react" {
  namespace JSX {
    interface IntrinsicElements {
      box: any;
      text: any;
      scrollbox: any;
      span: any;
      input: any;
      textarea: any;
      code: any;
    }
  }
}

export function TablensApp({
  file,
  query,
  source,
}: {
  file: string;
  query?: string;
  source: Engine;
}) {
  const renderer = useRenderer();
  const [state, dispatch] = useReducer(reducer, initialState());
  const [terminalBgColor, setTerminalBgColor] = useState<string>("#1e1e1e");

  useEffect(() => {
    renderer
      .getPalette()
      .then((colors) => {
        if (colors.defaultBackground)
          setTerminalBgColor(colors.defaultBackground);
      })
      .catch(() => {
        // ignore
      });
  }, [renderer]);

  const queryEditorRef = useRef<any>(null);
  const lastRenderedOffset = useRef(-1);
  const lastRenderedQuery = useRef("");
  const lastRenderedUseRegex = useRef(false);
  const lastRenderedWholeWord = useRef(false);
  const lastRenderedCaseSensitive = useRef(false);
  const lastRenderedSorter = useRef<{
    column: number;
    direction: "asc" | "desc";
  } | null>(null);
  const lastRenderedFilters = useRef("");
  const pageCache = useRef<PageWindowCache | null>(null);
  const lastViewportRequestId = useRef(0);
  const viewportRunningRef = useRef(false);
  const viewportDirtyRef = useRef(false);
  const viewportSnapshotRef = useRef<{
    requestId: number;
    state: typeof state;
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
  } | null>(null);
  const currentSearchQueryRef = useRef("");

  useEffect(() => {
    async function init() {
      try {
        const input =
          (query && query.trim().length > 0
            ? { kind: "query", sql: query }
            : /\.json$/i.test(file)
              ? { kind: "query", sql: `SELECT * FROM read_json_auto('${file.replaceAll("'", "''")}')` }
              : /\.(csv|tsv)$/i.test(file)
                ? { kind: "csv", path: file }
                : { kind: "parquet", path: file }) as EngineInput;
        await source.open(input);
        dispatch({ type: "SET_HEADERS", headers: source.getHeaders() });
        dispatch({ type: "SET_TOTAL_ROW_COUNT", count: source.getTotalRows() });
      } catch (err) {
        console.error("Failed to connect to source:", err);
      }
    }
    init();
  }, [file, query, source]);

  const {
    headers,
    totalRowCount,
    rowsOffset,
    colsOffset,
    cursorRow,
    cursorCol,
    selectionMode,
    wrapMode,
    visibleRows,
    visibleMatches,
    columnOverrides,
    searchActive,
    searchQuery,
    searchUseRegex,
    searchWholeWord,
    searchCaseSensitive,
    searchMatchRowCount,
    sorter,
    renameActive,
    renameQuery,
    savePathPromptActive,
    savePathQuery,
    queryEditorActive,
    queryEditorValue,
    showColumnFilter,
    columnFilterCol,
    columnFilterData,
    columnFilterCursor,
    columnFilterSelectedValues,
    columnFilterSelectionsByCol,
    columnFilterSearchActive,
    columnFilterSearchQuery,
  } = state;

  const filteredColumnFilterData = useMemo(() => {
    if (!columnFilterData) return [];
    const query = columnFilterSearchQuery.trim().toLowerCase();
    if (!query) return columnFilterData;
    return columnFilterData.filter((item) => item.value.toLowerCase().includes(query));
  }, [columnFilterData, columnFilterSearchQuery]);

  const columnFilterPageSize = 16;
  const activeColumnFilterCursor = Math.max(
    0,
    Math.min(
      filteredColumnFilterData.length - 1,
      filteredColumnFilterData.length === 0 ? 0 : columnFilterCursor,
    ),
  );
  const columnFilterWindowStart = useMemo(() => {
    const len = filteredColumnFilterData.length;
    if (len <= columnFilterPageSize) return 0;
    const maxStart = Math.max(0, len - columnFilterPageSize);
    const half = Math.floor(columnFilterPageSize / 2);
    return Math.max(0, Math.min(maxStart, activeColumnFilterCursor - half));
  }, [filteredColumnFilterData.length, activeColumnFilterCursor]);
  const visibleColumnFilterData = useMemo(
    () =>
      filteredColumnFilterData.slice(
        columnFilterWindowStart,
        columnFilterWindowStart + columnFilterPageSize,
      ),
    [filteredColumnFilterData, columnFilterWindowStart],
  );
  const visibleColumnFilterCursor = activeColumnFilterCursor - columnFilterWindowStart;

  const [appliedSearchQuery, setAppliedSearchQuery] = useState(searchQuery);
  const [searchLoading, setSearchLoading] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const lastAppliedParams = useRef({
    query: "",
    useRegex: false,
    wholeWord: false,
    caseSensitive: false,
  });

  // Keep ref in sync with current searchQuery
  useEffect(() => {
    currentSearchQueryRef.current = searchQuery;
    // If query is cleared, clear applied search too
    if (searchQuery === "" && appliedSearchQuery !== "") {
      setAppliedSearchQuery("");
      dispatch({ type: "SET_SEARCH_MATCH_ROW_COUNT", count: null });
      lastAppliedParams.current = {
        query: "",
        useRegex: false,
        wholeWord: false,
        caseSensitive: false,
      };
    }
  }, [searchQuery, appliedSearchQuery]);

  const performSearch = useCallback(
    (
      query: string,
      useRegex: boolean,
      wholeWord: boolean,
      caseSensitive: boolean,
    ) => {
      lastAppliedParams.current = { query, useRegex, wholeWord, caseSensitive };
      setSearchLoading(true);
      source
        .applySearch({
          query,
          useRegex,
          wholeWord,
          caseSensitive,
        })
        .then((count) => {
          setAppliedSearchQuery(query);
          if (count !== null) {
            dispatch({ type: "SET_TOTAL_ROW_COUNT", count });
          }
          dispatch({ type: "SET_SEARCH_MATCH_ROW_COUNT", count });
        })
        .catch((err) => {
          console.error("Search failed:", err);
          dispatch({ type: "SET_SEARCH_MATCH_ROW_COUNT", count: 0 });
        })
        .finally(() => {
          setSearchLoading(false);
        });
    },
    [source],
  );

  const performRename = useCallback(
    (oldName: string, newName: string) => {
      if (oldName === newName || newName.trim() === "") {
        dispatch({ type: "EXIT_RENAME_COLUMN" });
        return;
      }

      setRenaming(true);
      source
        .renameColumn(oldName, newName.trim())
        .then(() => {
          dispatch({ type: "SET_HEADERS", headers: source.getHeaders() });
          dispatch({ type: "EXIT_RENAME_COLUMN" });
        })
        .catch((err) => {
          console.error("Rename failed:", err);
          dispatch({ type: "EXIT_RENAME_COLUMN" });
        })
        .finally(() => {
          setRenaming(false);
        });
    },
    [source],
  );

  const [saving, setSaving] = useState(false);
  const [executingQuery, setExecutingQuery] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [unnesting, setUnnesting] = useState(false);

  const performUnnest = useCallback(
    (colName: string) => {
      setUnnesting(true);
      dispatch({ type: "SET_VISIBLE_ROWS", rows: [] });
      source
        .unnestColumn(colName)
        .then(() => {
          dispatch({ type: "SET_HEADERS", headers: source.getHeaders() });
          dispatch({ type: "SET_TOTAL_ROW_COUNT", count: source.getTotalRows() });
          // Keep cursor on same column — don't reset position
          lastRenderedOffset.current = -1;
        })
        .catch((err) => {
          console.error("Unnest failed:", err);
        })
        .finally(() => {
          setUnnesting(false);
        });
    },
    [source],
  );

  const performDeleteColumn = useCallback(
    (colName: string) => {
      if (headers.length <= 1) return;

      setDeleting(true);
      source
        .deleteColumn(colName)
        .then(() => {
          dispatch({ type: "SET_HEADERS", headers: source.getHeaders() });
          // Adjust cursor if we deleted the rightmost column
          if (cursorCol >= source.getHeaders().length) {
            dispatch({ type: "MOVE_LEFT" });
          }
          // Force viewport refresh
          lastRenderedOffset.current = -1;
        })
        .catch((err) => {
          console.error("Delete column failed:", err);
        })
        .finally(() => {
          setDeleting(false);
        });
    },
    [source, headers.length, cursorCol],
  );

  const performColumnFilter = useCallback(
    (columnName: string, values: string[]) => {
      setExecutingQuery(true);
      dispatch({ type: "SET_VISIBLE_ROWS", rows: [] });
      source
        .applyColumnFilter(columnName, values)
        .then(() => {
          dispatch({ type: "SET_HEADERS", headers: source.getHeaders() });
          dispatch({ type: "SET_TOTAL_ROW_COUNT", count: source.getTotalRows() });
          dispatch({ type: "CLOSE_COLUMN_FILTER" });
          dispatch({ type: "RESET_VIEWPORT", preserveColumn: true });
          lastRenderedOffset.current = -1;
          if (appliedSearchQuery.length > 0) {
            performSearch(
              appliedSearchQuery,
              searchUseRegex,
              searchWholeWord,
              searchCaseSensitive,
            );
          }
        })
        .catch((err) => {
          console.error("Column filter failed:", err);
        })
        .finally(() => {
          setExecutingQuery(false);
        });
    },
    [source, appliedSearchQuery, searchUseRegex, searchWholeWord, searchCaseSensitive, performSearch],
  );

  const handleQuerySubmit = useCallback((sql: string) => {
    if (!sql.trim()) {
      dispatch({ type: "CLOSE_QUERY_EDITOR" });
      return;
    }
    setExecutingQuery(true);
    // Clear old data immediately
    dispatch({ type: "SET_VISIBLE_ROWS", rows: [] });
    dispatch({ type: "SET_HEADERS", headers: [] });
    source
      .runQuery(sql.trim())
      .then(() => {
        dispatch({ type: "SET_HEADERS", headers: source.getHeaders() });
        dispatch({ type: "SET_TOTAL_ROW_COUNT", count: source.getTotalRows() });
        dispatch({ type: "CLOSE_QUERY_EDITOR" });
        // Reset viewport to top
        dispatch({ type: "RESET_VIEWPORT" });
        // Reset lastRendered refs to force re-fetch
        lastRenderedOffset.current = -1;
      })
      .catch((err) => {
        console.error("Query failed:", err);
      })
      .finally(() => {
        setExecutingQuery(false);
      });
  }, [source]);

  const handleSavePathSubmit = useCallback(
    (path: string) => {
      if (!path.trim()) {
        dispatch({ type: "EXIT_SAVE_PATH_PROMPT" });
        return;
      }
      setSaving(true);
      source
        .saveToFile(path.trim())
        .then(() => {
          dispatch({ type: "EXIT_SAVE_PATH_PROMPT" });
        })
        .catch((err) => {
          console.error("Save failed:", err);
          dispatch({ type: "EXIT_SAVE_PATH_PROMPT" });
        })
        .finally(() => {
          setSaving(false);
        });
    },
    [source],
  );

  // Handle sorting
  useEffect(() => {
    if (!sorter) return;

    const colName = headers[sorter.column];
    if (!colName) return;

    setSorting(true);
    source
      .applySort({
        column: colName,
        direction: sorter.direction,
      })
      .then(() => {
        // Refresh viewport/search
        dispatch({ type: "SET_TOTAL_ROW_COUNT", count: source.getTotalRows() });
        if (appliedSearchQuery.length > 0) {
          performSearch(
            appliedSearchQuery,
            searchUseRegex,
            searchWholeWord,
            searchCaseSensitive,
          );
        }
      })
      .catch((err) => {
        console.error("Sort failed:", err);
      })
      .finally(() => {
        setSorting(false);
      });
  }, [
    sorter,
    source,
    headers,
    appliedSearchQuery,
    searchUseRegex,
    searchWholeWord,
    searchCaseSensitive,
    performSearch,
  ]);

  useEffect(() => {
    if (headers.length === 0) return;

    const consoleHeight =
      renderer.console.visible && renderer.console.bounds?.height
        ? Number(renderer.console.bounds.height) || 0
        : 0;
    const tableH = Math.max(1, renderer.terminalHeight - 1 - consoleHeight);
    const tableW = renderer.terminalWidth;
    const requestId = ++lastViewportRequestId.current;

    viewportSnapshotRef.current = {
      requestId,
      state: { ...state, searchQuery: appliedSearchQuery },
      termW: tableW,
      termH: tableH,
      source,
      lastRenderedOffset: lastRenderedOffset.current,
      lastRenderedQuery: lastRenderedQuery.current,
      lastRenderedUseRegex: lastRenderedUseRegex.current,
      lastRenderedWholeWord: lastRenderedWholeWord.current,
      lastRenderedCaseSensitive: lastRenderedCaseSensitive.current,
      lastRenderedSorter: lastRenderedSorter.current,
      lastRenderedFilters: lastRenderedFilters.current,
      pageCache: pageCache.current,
    };
    viewportDirtyRef.current = true;
    if (viewportRunningRef.current) return;

    viewportRunningRef.current = true;
    async function runViewportLoop(): Promise<void> {
      try {
        while (viewportDirtyRef.current) {
          viewportDirtyRef.current = false;
          const snapshot = viewportSnapshotRef.current;
          if (!snapshot) break;
          const requestId = snapshot.requestId;

          const patch = await computeViewportPatch(snapshot);

          if (requestId < lastViewportRequestId.current) continue;

          const currentState = snapshot.state;
          const previousSorter = lastRenderedSorter.current;
          const shouldApply =
            patch.rowsOffset !== currentState.rowsOffset ||
            patch.colsOffset !== currentState.colsOffset ||
            patch.visibleRows !== currentState.visibleRows ||
            patch.visibleMatches !== currentState.visibleMatches ||
            JSON.stringify(currentState.sorter) !== JSON.stringify(previousSorter);

          lastRenderedOffset.current = patch.rowsOffset;
          lastRenderedQuery.current = currentState.searchQuery;
          lastRenderedUseRegex.current = currentState.searchUseRegex;
          lastRenderedWholeWord.current = currentState.searchWholeWord;
          lastRenderedCaseSensitive.current = currentState.searchCaseSensitive;
          lastRenderedSorter.current = currentState.sorter;
          lastRenderedFilters.current = JSON.stringify(currentState.columnFilterSelectionsByCol);
          pageCache.current = patch.pageCache;

          lastRenderedSorter.current = currentState.sorter;

          if (shouldApply) {
            dispatch({ type: "APPLY_VIEWPORT_PATCH", patch, requestId });
          }
        }
      } finally {
        viewportRunningRef.current = false;
        if (viewportDirtyRef.current) {
          viewportRunningRef.current = true;
          void runViewportLoop();
        }
      }
    }

    void runViewportLoop();
  }, [
    renderer.terminalHeight,
    renderer.terminalWidth,
    renderer.console.visible,
    headers,
    totalRowCount,
    rowsOffset,
    colsOffset,
    cursorRow,
    cursorCol,
    selectionMode,
    wrapMode,
    columnOverrides,
    searchActive,
    appliedSearchQuery,
    searchUseRegex,
    searchWholeWord,
    searchCaseSensitive,
    searchMatchRowCount,
    columnFilterSelectionsByCol,
    source,
    sorter,
  ]);

  // Refresh search when flags change (if there's a search query)
  useEffect(() => {
    // If the box has content, we want to refresh search with new flags
    // Even if it hasn't been "applied" yet (e.g. while typing)
    const queryToUse =
      currentSearchQueryRef.current.length > 0
        ? currentSearchQueryRef.current
        : appliedSearchQuery;
    if (queryToUse.length === 0) return;

    performSearch(
      queryToUse,
      state.searchUseRegex,
      state.searchWholeWord,
      state.searchCaseSensitive,
    );
    // We only want to trigger this when flags change or appliedSearchQuery changes.
    // We use a ref for the current searchQuery to avoid triggering while typing.
  }, [
    state.searchUseRegex,
    state.searchWholeWord,
    state.searchCaseSensitive,
    appliedSearchQuery,
    performSearch,
  ]);

  const colSearchQuery = state.colSearchQuery;
  const filteredColIndices = useMemo(() => {
    if (!colSearchQuery) return null;
    const q = colSearchQuery.toLowerCase();
    return headers.map((h, i) => ({ h, i })).filter(({ h }) => h.toLowerCase().includes(q)).map(({ i }) => i);
  }, [headers, colSearchQuery]);

  const tableContent = useMemo(() => {
    if (headers.length === 0 || totalRowCount === 0 || visibleRows.length === 0)
      return null;

    const tableW = renderer.terminalWidth;
    const consoleHeight =
      renderer.console.visible && renderer.console.bounds?.height
        ? Number(renderer.console.bounds.height) || 0
        : 0;
    const tableH = Math.max(1, renderer.terminalHeight - 1 - consoleHeight);

    const dispHeaders = filteredColIndices ? filteredColIndices.map((i) => headers[i]!) : headers;
    const dispRows = filteredColIndices
      ? visibleRows.map((r) => filteredColIndices.map((i) => r[i] ?? ""))
      : visibleRows;
    const dispMatches = filteredColIndices && visibleMatches
      ? visibleMatches.map((m) => filteredColIndices.map((i) => m[i] ?? false))
      : visibleMatches;
    const dispTypes = filteredColIndices && state.columnTypes.length
      ? filteredColIndices.map((i) => state.columnTypes[i] ?? "")
      : state.columnTypes;
    const dispStats = filteredColIndices && state.columnStats.length
      ? filteredColIndices.map((i) => state.columnStats[i] ?? "")
      : state.columnStats;

    return computeTableContentModel({
      headers: dispHeaders,
      visibleRows: dispRows,
      visibleMatches: dispMatches,
      rowsOffset,
      colsOffset: filteredColIndices ? 0 : colsOffset,
      wrapMode,
      columnOverrides,
      termW: tableW,
      termH: tableH,
      totalRowCount,
      selectionMode: state.selectionMode,
      cursorCol: state.cursorCol,
      showTypes: state.showTypes,
      columnTypes: dispTypes,
      showStats: state.showStats,
      columnStats: dispStats,
      columnCompaction: state.columnCompaction,
    });
  }, [
    headers,
    totalRowCount,
    visibleRows,
    visibleMatches,
    colsOffset,
    rowsOffset,
    wrapMode,
    columnOverrides,
    state.selectionMode,
    state.cursorCol,
    state.showTypes,
    state.columnTypes,
    state.showStats,
    state.columnStats,
    state.columnCompaction,
    filteredColIndices,
    renderer.terminalWidth,
    renderer.terminalHeight,
    renderer.console.visible,
  ]);

  const cursorStyle = useMemo(() => {
    if (!tableContent) return { visible: false };

    const consoleHeight =
      renderer.console.visible && renderer.console.bounds?.height
        ? Number(renderer.console.bounds.height) || 0
        : 0;
    const tableH = Math.max(1, renderer.terminalHeight - 1 - consoleHeight);

    return computeCursorOverlay({
      state,
      colWidths: tableContent.colWidths,
      rowHeights: tableContent.rowHeights,
      gutterWidth: tableContent.gutterWidth,
      termH: tableH,
      visCount: tableContent.visCount,
    });
  }, [state, tableContent, renderer.terminalHeight, renderer.console.visible]);

  const headerOverlay = useMemo(() => {
    if (!tableContent) return { visible: false };

    return computeHeaderOverlay({
      state,
      colWidths: tableContent.colWidths,
      gutterWidth: tableContent.gutterWidth,
      dispHeaders: headers.slice(state.colsOffset),
      colsOffset: state.colsOffset,
    });
  }, [state, tableContent, headers]);

  useKeyboard((key: KeyEvent) => {
    if (key.ctrl && key.name === "c") {
      renderer.destroy();
      process.exit(0);
    }

    if (key.ctrl && key.name === "`") {
      renderer.console.toggle();
      return;
    }
    if (key.name === "`") {
      renderer.console.toggle();
      return;
    }
    if (renderer.console.visible) return;

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
      const autocomplete = (queryEditorRef.current as any)?.autocomplete;

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
          // Tab cycles through autocomplete suggestions
          if (key.shift) {
            autocomplete.selectPrev();
          } else {
            autocomplete.selectNext();
          }
        } else {
          // Tab triggers autocomplete when not visible
          autocomplete?.trigger?.();
        }
        return;
      }
      if ((key.name === "down" || key.name === "up") && autocomplete?.isVisible) {
        // Arrow keys for autocomplete navigation
        if (key.name === "down") {
          autocomplete.selectNext();
        } else {
          autocomplete.selectPrev();
        }
        return;
      }
      if (key.name === "return" && !key.shift) {
        if (autocomplete?.isVisible) {
          // Confirm autocomplete selection
          autocomplete.confirm();
          return;
        }
        // Enter without shift = run query
        const text = queryEditorRef.current?.getText?.() || "";
        handleQuerySubmit(text);
        return;
      }
      // Let textarea handle other keys (including Shift+Enter for newline)
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

    if (key.name === "x") {
      // Toggle auto-resize: if columns are resized, reset to default; otherwise auto-resize
      dispatch({
        type: "AUTO_RESIZE_COLUMNS",
        headers: state.headers,
        visibleRows: state.visibleRows,
      });
      return;
    }

    if (key.name === "e" && state.selectionMode === "column") return;
    if ((key.name === "U" || (key.name === "u" && key.shift)) && state.selectionMode === "column") return;
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
      dispatch({
        type: "OPEN_QUERY_EDITOR",
        query: source.getQuery(),
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
  });

  return (
    <>
      <box
        id="table"
        top={0}
        left={0}
        width="100%"
        height={(() => {
          const consoleHeight =
            renderer.console.visible && renderer.console.bounds?.height
              ? Number(renderer.console.bounds.height) || 0
              : 0;
          return Math.max(1, renderer.terminalHeight - 1 - consoleHeight);
        })()}
      >
        {tableContent ? (
          <text
            id="table-text"
            content={tableContent.content}
            top={0}
            left={0}
            zIndex={1}
            wrapMode="none"
          />
        ) : (
          <EmptyState
            type={(() => {
              if (headers.length === 0) return "loading";

              if (appliedSearchQuery.length > 0) {
                if (visibleRows.length === 0) return "no-results";
                if (searchMatchRowCount === 0) return "no-results";
                if (searchMatchRowCount === null) return "loading";
              }

              if (totalRowCount === 0) return "empty-file";

              return "loading";
            })()}
            query={appliedSearchQuery}
          />
        )}
        <box
          id="cursor-overlay"
          {...cursorStyle}
          backgroundColor="#ffffff"
          opacity={0.2}
          zIndex={10}
          position="absolute"
        />
        {headerOverlay.visible && (
          <box
            id="header-overlay"
            top={headerOverlay.top}
            left={headerOverlay.left}
            width={headerOverlay.width}
            height={headerOverlay.height}
            zIndex={15}
            position="absolute"
            backgroundColor={terminalBgColor}
          >
            <text
              content={parseInlineMarkup(
                ` {orange}{bold}{underline}${headerOverlay.headerText}{/underline}{/bold}{/orange} `,
              )}
              left={0}
            />
          </box>
        )}
      </box>
      <box
        id="status"
        bottom={renderer.console.visible ? renderer.console.bounds.height : 0}
        left={0}
        width="100%"
        height={1}
      >
        {savePathPromptActive ? (
          <SavePathBar
            query={savePathQuery}
            onInput={(value) =>
              dispatch({ type: "SET_SAVE_PATH_QUERY", query: value })
            }
            onSubmit={handleSavePathSubmit}
            saving={saving}
          />
        ) : renameActive ? (
          <RenameBar
            query={renameQuery}
            onInput={(value) =>
              dispatch({ type: "SET_RENAME_QUERY", query: value })
            }
            onSubmit={(value) => {
              const oldName = headers[cursorCol];
              if (oldName) performRename(oldName, value);
            }}
            columnName={headers[cursorCol] || ""}
            saving={renaming}
          />
        ) : state.colSearchActive || colSearchQuery.length > 0 ? (
          <ColSearchBar
            query={colSearchQuery}
            active={state.colSearchActive}
            matchCount={filteredColIndices ? filteredColIndices.length : headers.length}
            totalCols={headers.length}
            onInput={(value) => dispatch({ type: "SET_COL_SEARCH_QUERY", query: value })}
            onSubmit={() => dispatch({ type: "EXIT_COL_SEARCH" })}
          />
        ) : state.searchActive ||
        searchQuery.length > 0 ||
        searchUseRegex ||
        searchWholeWord ||
        searchCaseSensitive ? (
          <SearchBar
            query={searchQuery}
            onInput={(value) =>
              dispatch({ type: "SET_SEARCH_QUERY", query: value })
            }
            onSubmit={(value) => {
              performSearch(
                value,
                searchUseRegex,
                searchWholeWord,
                searchCaseSensitive,
              );
              dispatch({ type: "EXIT_SEARCH" });
            }}
            useRegex={searchUseRegex}
            wholeWord={searchWholeWord}
            caseSensitive={searchCaseSensitive}
            matchRowCount={searchMatchRowCount}
            active={searchActive}
            cursorRow={cursorRow}
            totalRowCount={totalRowCount}
            cursorCol={cursorCol}
            numCols={headers.length}
            loading={searchLoading}
            sorting={sorting}
          />
        ) : (
          <StatusLine
            file={file}
            cursorRow={cursorRow}
            totalRowCount={totalRowCount}
            cursorCol={cursorCol}
            numCols={headers.length}
            searchQuery={searchQuery}
            searchUseRegex={searchUseRegex}
            searchWholeWord={searchWholeWord}
            searchCaseSensitive={searchCaseSensitive}
            searchMatchRowCount={searchMatchRowCount}
            searchError={state.searchError}
            sorting={sorting}
            selectionMode={selectionMode}
          />
        )}
      </box>
      {queryEditorActive && (
        <QueryEditor
          ref={queryEditorRef}
          initialQuery={queryEditorValue}
          onSubmit={handleQuerySubmit}
          loading={executingQuery}
          termHeight={renderer.terminalHeight}
          getAutocompleteSuggestions={(sql) => source.getAutocompleteSuggestions(sql)}
        />
      )}
      {showColumnFilter && columnFilterData && (
        <ColumnFilterModal
          columnName={headers[columnFilterCol || 0] || "Column"}
          data={visibleColumnFilterData}
          cursor={visibleColumnFilterCursor}
          selectedValues={columnFilterSelectedValues}
          searchActive={columnFilterSearchActive}
          searchQuery={columnFilterSearchQuery}
          filteredCount={filteredColumnFilterData.length}
          windowStart={columnFilterWindowStart}
        />
      )}
      {state.showHelp && <HelpModal />}
    </>
  );
}
