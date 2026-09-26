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
import { handleTablensKey } from "src/app/handleKeyboard";
import {
  computeCursorOverlay,
  computeHeaderOverlay,
  computeTableContentModel,
} from "src/app/render";
import { initialState, reducer } from "src/app/state";
import { computeViewportPatch, trySyncViewportPatch } from "src/app/viewport";
import { SearchBar } from "src/app/components/SearchBar";
import { ColSearchBar } from "src/app/components/ColSearchBar";
import { StatusLine } from "src/app/components/StatusLine";
import { EmptyState } from "src/app/components/EmptyState";
import { RenameBar } from "src/app/components/RenameBar";
import { SavePathBar } from "src/app/components/SavePathBar";
import { QueryEditor } from "src/app/components/QueryEditor";
import { HelpModal } from "src/app/components/HelpModal";
import { ColumnFilterModal } from "src/app/components/ColumnFilterModal";
import { ColumnManagerModal } from "src/app/components/ColumnManagerModal";
import { parseInlineMarkup } from "src/app/markup";
import { formatError } from "src/utils/error";
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
  width,
  height,
  keyboardEnabled = true,
  onNavigateLeft,
}: {
  file: string;
  query?: string;
  source: Engine;
  /** Pane width in chars. Defaults to full terminal width. */
  width?: number;
  /** Pane height in rows (incl. status line). Defaults to terminal height minus console. */
  height?: number;
  /** When false, all keyboard input is ignored (used by Directory mode). */
  keyboardEnabled?: boolean;
  /** Called instead of moving left when the cursor is already at the first column. */
  onNavigateLeft?: () => void;
}) {
  const renderer = useRenderer();
  const [state, dispatch] = useReducer(reducer, initialState());

  // Effective pane dimensions. When embedded (Directory mode) the parent passes
  // explicit dims; otherwise we fall back to the full terminal and account for
  // the built-in console.
  const consoleHeight =
    height === undefined &&
    renderer.console.visible &&
    renderer.console.bounds?.height
      ? Number(renderer.console.bounds.height) || 0
      : 0;
  const termH = height ?? Math.max(1, renderer.terminalHeight - consoleHeight);
  const termW = width ?? renderer.terminalWidth;
  const tableH = Math.max(1, termH - 1);
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
  const consoleCaptureRef = useRef(false);
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
  const prevSorterRef = useRef<typeof sorter>(null);

  useEffect(() => {
    dispatch({ type: "SET_HEADERS", headers: source.getHeaders() });
    dispatch({ type: "SET_TOTAL_ROW_COUNT", count: source.getTotalRows() });
  }, [source]);

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
    visibleRowIds,
    visibleMatches,
    markedRows,
    columnOrder,
    hiddenColumns,
    columnManagerActive,
    columnManagerCursor,
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
    scrollRowsPerSec,
    scrollBenchAt,
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

  const orderedColumnIndices = useMemo(() => {
    const canonicalOrder =
      columnOrder.length === headers.length
        ? columnOrder
        : headers.map((_, index) => index);
    return canonicalOrder.filter((columnIndex) => columnIndex >= 0 && columnIndex < headers.length);
  }, [columnOrder, headers]);

  const visibleLayoutColumnIndices = useMemo(
    () => orderedColumnIndices.filter((columnIndex) => !hiddenColumns.has(columnIndex)),
    [orderedColumnIndices, hiddenColumns],
  );
  const visibleLayoutColumnNames = useMemo(
    () => visibleLayoutColumnIndices.map((i) => headers[i]!).filter(Boolean),
    [visibleLayoutColumnIndices, headers],
  );

  const columnManagerHeight = Math.max(24, Math.min(40, termH - 2));
  const columnManagerBodyHeight = Math.max(1, columnManagerHeight - 5);
  const columnManagerWindowStart = useMemo(() => {
    const len = columnOrder.length;
    if (len <= columnManagerBodyHeight) return 0;
    const maxStart = Math.max(0, len - columnManagerBodyHeight);
    const half = Math.floor(columnManagerBodyHeight / 2);
    return Math.max(0, Math.min(maxStart, columnManagerCursor - half));
  }, [columnOrder.length, columnManagerBodyHeight, columnManagerCursor]);
  const visibleColumnManagerColumns = useMemo(
    () => columnOrder.slice(columnManagerWindowStart, columnManagerWindowStart + columnManagerBodyHeight),
    [columnOrder, columnManagerWindowStart, columnManagerBodyHeight],
  );
  const visibleColumnManagerCursor = Math.max(
    0,
    Math.min(
      visibleColumnManagerColumns.length - 1,
      visibleColumnManagerColumns.length === 0 ? 0 : columnManagerCursor - columnManagerWindowStart,
    ),
  );

  const [appliedSearchQuery, setAppliedSearchQuery] = useState(searchQuery);
  const [searchLoading, setSearchLoading] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [columnStatsLoading, setColumnStatsLoading] = useState(false);

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

  useEffect(() => {
    if (!columnManagerActive) return;
    if (state.columnStats.length > 0 || columnStatsLoading) return;

    setColumnStatsLoading(true);
    source
      .getColumnStats()
      .then((stats) => {
        dispatch({ type: "SET_COLUMN_STATS", stats });
      })
      .catch((err) => {
        console.error("Column summarize failed:", err);
      })
      .finally(() => {
        setColumnStatsLoading(false);
      });
  }, [columnManagerActive, columnStatsLoading, source, state.columnStats.length]);

  const [saving, setSaving] = useState(false);
  const [executingQuery, setExecutingQuery] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [unnesting, setUnnesting] = useState(false);

  const performUnnest = useCallback(
    (colName: string) => {
      setUnnesting(true);
      dispatch({ type: "SET_VISIBLE_ROWS", rows: [], rowIds: [] });
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
      dispatch({ type: "SET_VISIBLE_ROWS", rows: [], rowIds: [] });
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

  const handleQuerySubmit = useCallback(
    (sql: string) => {
      if (!sql.trim()) {
        dispatch({ type: "CLOSE_QUERY_EDITOR" });
        return;
      }
      setExecutingQuery(true);
      dispatch({ type: "SET_VISIBLE_ROWS", rows: [], rowIds: [] });
      dispatch({ type: "SET_HEADERS", headers: [] });
      source
        .runQuery(sql.trim())
        .then(() => {
          dispatch({ type: "SET_HEADERS", headers: source.getHeaders() });
          dispatch({ type: "SET_TOTAL_ROW_COUNT", count: source.getTotalRows() });
          dispatch({ type: "CLOSE_QUERY_EDITOR" });
          dispatch({ type: "RESET_VIEWPORT" });
          lastRenderedOffset.current = -1;
        })
        .catch((err) => {
          console.error(`tablens: ${formatError(err)}`);
          renderer.destroy();
          process.exit(1);
        })
        .finally(() => {
          setExecutingQuery(false);
        });
    },
    [source, renderer],
  );

  const handleSavePathSubmit = useCallback(
    (path: string) => {
      if (!path.trim()) {
        dispatch({ type: "EXIT_SAVE_PATH_PROMPT" });
        return;
      }
      setSaving(true);
      const markedRowIds = markedRows.size > 0 ? [...markedRows] : null;
      source
        .saveToFile(
          path.trim(),
          markedRowIds ?? undefined,
          visibleLayoutColumnNames.length > 0 ? visibleLayoutColumnNames : undefined,
        )
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
    [source, markedRows, visibleLayoutColumnNames],
  );

  // Handle sorting
  useEffect(() => {
    const prev = prevSorterRef.current;
    prevSorterRef.current = sorter;

    if (!sorter) {
      if (!prev) return;

      setSorting(true);
      source
        .clearSort()
        .then(() => {
          dispatch({ type: "SET_TOTAL_ROW_COUNT", count: source.getTotalRows() });
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
          console.error("Clear sort failed:", err);
        })
        .finally(() => {
          setSorting(false);
        });
      return;
    }

    const colName = headers[sorter.column];
    if (!colName) return;

    setSorting(true);
    source
      .applySort({
        column: colName,
        direction: sorter.direction,
      })
      .then(() => {
        dispatch({ type: "SET_TOTAL_ROW_COUNT", count: source.getTotalRows() });
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

  // Viewport: prefer sync slice from PageWindowCache; async getPage uses file_row_number index only
  // (see Engine.ts — never materialize full rows into indexed tables for scroll perf).
  useEffect(() => {
    if (headers.length === 0) return;

    const viewportState = { ...state, searchQuery: appliedSearchQuery };

    // Fast path — no DuckDB; keeps rowsOffset and visibleRows in sync when still inside cache.
    const syncPatch = trySyncViewportPatch({
      state: viewportState,
      termW,
      termH: tableH,
      lastRenderedQuery: lastRenderedQuery.current,
      lastRenderedUseRegex: lastRenderedUseRegex.current,
      lastRenderedWholeWord: lastRenderedWholeWord.current,
      lastRenderedCaseSensitive: lastRenderedCaseSensitive.current,
      lastRenderedSorter: lastRenderedSorter.current,
      lastRenderedFilters: lastRenderedFilters.current,
      pageCache: pageCache.current,
    });

    if (syncPatch) {
      const requestId = ++lastViewportRequestId.current;
      pageCache.current = syncPatch.pageCache;
      lastRenderedOffset.current = syncPatch.rowsOffset;
      dispatch({ type: "APPLY_VIEWPORT_PATCH", patch: syncPatch, requestId });
      return;
    }

    dispatch({ type: "SET_VIEWPORT_PENDING", pending: true });

    const requestId = ++lastViewportRequestId.current;

    viewportSnapshotRef.current = {
      requestId,
      state: viewportState,
      termW,
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
          } else {
            dispatch({ type: "SET_VIEWPORT_PENDING", pending: false });
          }
        }
      } catch (err) {
        console.error("Viewport fetch failed:", err);
        dispatch({ type: "SET_VIEWPORT_PENDING", pending: false });
      } finally {
        viewportRunningRef.current = false;
        if (viewportDirtyRef.current) {
          viewportRunningRef.current = true;
          void runViewportLoop();
        } else {
          dispatch({ type: "SET_VIEWPORT_PENDING", pending: false });
        }
      }
    }

    void runViewportLoop();
  }, [
    termH,
    termW,
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

  useEffect(() => {
    if (scrollRowsPerSec === null) return;
    const idleMs = 500;
    const remaining = idleMs - (performance.now() - scrollBenchAt);
    const timeout = setTimeout(
      () => dispatch({ type: "CLEAR_SCROLL_SPEED" }),
      Math.max(0, remaining),
    );
    return () => clearTimeout(timeout);
  }, [scrollRowsPerSec, scrollBenchAt]);

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
    return visibleLayoutColumnIndices
      .map((i) => ({ h: headers[i]!, i }))
      .filter(({ h }) => h.toLowerCase().includes(q))
      .map(({ i }) => i);
  }, [headers, colSearchQuery, visibleLayoutColumnIndices]);

  const displayColumnIndices = filteredColIndices ?? visibleLayoutColumnIndices;
  const cursorDisplayColIndex = displayColumnIndices.indexOf(cursorCol);
  const sortDisplayColIndex =
    sorter === null ? undefined : displayColumnIndices.indexOf(sorter.column);
  const displayColumnOverrides = useMemo(() => {
    const overrides: Record<number, number> = {};
    displayColumnIndices.forEach((columnIndex, displayIndex) => {
      const width = columnOverrides[columnIndex];
      if (width !== undefined) overrides[displayIndex] = width;
    });
    return overrides;
  }, [columnOverrides, displayColumnIndices]);

  const tableContent = useMemo(() => {
    if (headers.length === 0 || totalRowCount === 0 || visibleRows.length === 0)
      return null;
    if (displayColumnIndices.length === 0) return null;

    const dispHeaders = displayColumnIndices.map((i) => headers[i]!).filter(Boolean);
    const dispRows = visibleRows.map((r) => displayColumnIndices.map((i) => r[i] ?? ""));
    const dispMatches = visibleMatches
      ? visibleMatches.map((m) => displayColumnIndices.map((i) => m[i] ?? false))
      : visibleMatches;
    const dispTypes = state.columnTypes.length
      ? displayColumnIndices.map((i) => state.columnTypes[i] ?? "")
      : state.columnTypes;
    const dispStats = state.columnStats.length
      ? displayColumnIndices.map((i) => state.columnStats[i] ?? "")
      : state.columnStats;

    const sortColumnInHeaders =
      sortDisplayColIndex !== undefined && sortDisplayColIndex >= 0
        ? sortDisplayColIndex
        : undefined;
    const sortDirection =
      sortColumnInHeaders !== undefined ? sorter?.direction : undefined;

    return computeTableContentModel({
      headers: dispHeaders,
      visibleRows: dispRows,
      visibleRowIds,
      visibleMatches: dispMatches,
      markedRows,
      rowsOffset,
      colsOffset,
      wrapMode,
      multilineMode: state.multilineMode,
      columnOverrides: displayColumnOverrides,
      termW,
      termH: tableH,
      totalRowCount,
      selectionMode: state.selectionMode,
      selectedColIndex: cursorDisplayColIndex >= 0 ? cursorDisplayColIndex : undefined,
      showTypes: state.showTypes,
      columnTypes: dispTypes,
      showStats: state.showStats,
      columnStats: dispStats,
      columnWidthMode: state.columnWidthMode,
      sortColumnInHeaders:
        sortColumnInHeaders,
      sortDirection,
    });
  }, [
    headers,
    totalRowCount,
    visibleRows,
    visibleRowIds,
    visibleMatches,
    markedRows,
    displayColumnIndices,
    displayColumnOverrides,
    cursorDisplayColIndex,
    sortDisplayColIndex,
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
    state.columnWidthMode,
    state.sorter,
    termW,
    tableH,
  ]);

  const cursorStyle = useMemo(() => {
    if (!tableContent) return { visible: false };

    return computeCursorOverlay({
      state: { ...state, cursorCol: cursorDisplayColIndex } as typeof state,
      colWidths: tableContent.colWidths,
      rowHeights: tableContent.rowHeights,
      gutterWidth: tableContent.gutterWidth,
      termH: tableH,
      visCount: tableContent.visCount,
    });
  }, [state, tableContent, tableH, cursorDisplayColIndex]);

  const headerOverlay = useMemo(() => {
    if (!tableContent) return { visible: false };

    return computeHeaderOverlay({
      selectionMode: state.selectionMode,
      selectedColIndex: cursorDisplayColIndex >= 0 ? cursorDisplayColIndex : undefined,
      sortColumnIndex: sortDisplayColIndex >= 0 ? sortDisplayColIndex : undefined,
      sortDirection: sorter?.direction,
      colWidths: tableContent.colWidths,
      gutterWidth: tableContent.gutterWidth,
      dispHeaders: displayColumnIndices.map((i) => headers[i]!).slice(colsOffset),
      colsOffset,
    });
  }, [state.selectionMode, cursorDisplayColIndex, sortDisplayColIndex, sorter?.direction, tableContent, displayColumnIndices, headers, colsOffset]);

  useKeyboard((key: KeyEvent) => {
    if (!keyboardEnabled) return;
    if (
      onNavigateLeft &&
      !state.showHelp &&
      !state.showColumnFilter &&
      !state.columnManagerActive &&
      !state.searchActive &&
      !state.colSearchActive &&
      !state.renameActive &&
      !state.savePathPromptActive &&
      !state.queryEditorActive &&
      !key.shift &&
      (key.name === "left" || key.name === "h")
    ) {
      const firstColumn = displayColumnIndices[0];
      const isAtLeftEdge =
        state.selectionMode === "row"
          ? state.colsOffset === 0
          : firstColumn !== undefined && state.cursorCol === firstColumn;
      if (isAtLeftEdge) {
        onNavigateLeft();
        return;
      }
    }
    handleTablensKey(key, {
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
      visibleColumnIndices: displayColumnIndices,
      consoleCaptureRef,
    });
  });

  return (
    <box
      id="tablens-root"
      width={termW}
      height={termH}
      flexDirection="column"
    >
      <box
        id="table"
        top={0}
        left={0}
        width="100%"
        height={tableH}
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
              if (visibleLayoutColumnIndices.length === 0) return "no-columns";
              if (colSearchQuery.length > 0 && displayColumnIndices.length === 0) return "no-results";

              if (appliedSearchQuery.length > 0) {
                if (visibleRows.length === 0) return "no-results";
                if (searchMatchRowCount === 0) return "no-results";
                if (searchMatchRowCount === null) return "loading";
              }

              if (totalRowCount === 0) return "empty-file";

              return "loading";
              })()}
              query={colSearchQuery.length > 0 && displayColumnIndices.length === 0 ? colSearchQuery : appliedSearchQuery}
              width={termW}
              height={tableH}
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
            matchCount={filteredColIndices ? filteredColIndices.length : displayColumnIndices.length}
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
            markedCount={markedRows.size}
            scrollRowsPerSec={scrollRowsPerSec}
          />
        )}
      </box>
      {queryEditorActive && (
        <QueryEditor
          ref={queryEditorRef}
          initialQuery={queryEditorValue}
          onSubmit={handleQuerySubmit}
          loading={executingQuery}
          termHeight={termH}
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
      {columnManagerActive && (
        <ColumnManagerModal
          headers={headers}
          columns={visibleColumnManagerColumns}
          hiddenColumns={hiddenColumns}
          cursor={visibleColumnManagerCursor}
          windowStart={columnManagerWindowStart}
          stats={state.columnStats}
          loading={columnStatsLoading}
          termWidth={termW}
          termHeight={termH}
        />
      )}
      {state.showHelp && <HelpModal />}
    </box>
  );
}
