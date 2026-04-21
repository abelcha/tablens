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
import { DuckDBDataSource } from "src/data/source";
import { keyToActions } from "src/app/keyboard";
import {
  computeCursorOverlay,
  computeHeaderOverlay,
  computeTableContentModel,
} from "src/app/render";
import { initialState, reducer } from "src/app/state";
import { computeViewportPatch } from "src/app/viewport";
import { SearchBar } from "src/app/components/SearchBar";
import { StatusLine } from "src/app/components/StatusLine";
import { EmptyState } from "src/app/components/EmptyState";
import { RenameBar } from "src/app/components/RenameBar";
import { SavePathBar } from "src/app/components/SavePathBar";
import { QueryEditor } from "src/app/components/QueryEditor";
import { HelpModal } from "src/app/components/HelpModal";
import { parseInlineMarkup } from "src/app/markup";

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
  source: DuckDBDataSource;
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
  const lastViewportRequestId = useRef(0);
  const currentSearchQueryRef = useRef("");

  useEffect(() => {
    async function init() {
      try {
        await source.connect({ filePath: file, query });
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
    isMaterialized,
    sorter,
    renameActive,
    renameQuery,
    savePathPromptActive,
    savePathQuery,
    queryEditorActive,
    queryEditorValue,
  } = state;

  // Poll for materialization status until complete
  useEffect(() => {
    if (isMaterialized) return;

    const interval = setInterval(() => {
      const materialized = source.getIsMaterialized();
      if (materialized) {
        dispatch({ type: "SET_MATERIALIZED", isMaterialized: true });
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [source, isMaterialized]);

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
      // Avoid redundant searches
      if (
        query === lastAppliedParams.current.query &&
        useRegex === lastAppliedParams.current.useRegex &&
        wholeWord === lastAppliedParams.current.wholeWord &&
        caseSensitive === lastAppliedParams.current.caseSensitive
      ) {
        return;
      }

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
          dispatch({ type: "SET_MATERIALIZED", isMaterialized: true });
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
        dispatch({ type: "SET_MATERIALIZED", isMaterialized: false });
        dispatch({ type: "CLOSE_QUERY_EDITOR" });
        // Reset viewport to top
        dispatch({ type: "MOVE_UP", pageSize: 999999 });
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
    if (headers.length === 0 || totalRowCount === 0) return;

    const consoleHeight =
      renderer.console.visible && renderer.console.bounds?.height
        ? Number(renderer.console.bounds.height) || 0
        : 0;
    const tableH = Math.max(1, renderer.terminalHeight - 1 - consoleHeight);
    const tableW = renderer.terminalWidth;
    const requestId = ++lastViewportRequestId.current;

    computeViewportPatch({
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
    }).then((patch) => {
      // Only update if this is the latest request to avoid race conditions
      if (requestId < lastViewportRequestId.current) return;

      if (
        patch.rowsOffset !== state.rowsOffset ||
        patch.colsOffset !== state.colsOffset ||
        patch.visibleRows !== state.visibleRows ||
        patch.visibleMatches !== state.visibleMatches ||
        JSON.stringify(state.sorter) !==
          JSON.stringify(lastRenderedSorter.current)
      ) {
        lastRenderedOffset.current = patch.rowsOffset;
        lastRenderedQuery.current = appliedSearchQuery;
        lastRenderedUseRegex.current = searchUseRegex;
        lastRenderedWholeWord.current = searchWholeWord;
        lastRenderedCaseSensitive.current = searchCaseSensitive;
        lastRenderedSorter.current = state.sorter;
        dispatch({ type: "APPLY_VIEWPORT_PATCH", patch, requestId });
      }
    });
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

  const tableContent = useMemo(() => {
    if (headers.length === 0 || totalRowCount === 0 || visibleRows.length === 0)
      return null;

    const tableW = renderer.terminalWidth;
    const consoleHeight =
      renderer.console.visible && renderer.console.bounds?.height
        ? Number(renderer.console.bounds.height) || 0
        : 0;
    const tableH = Math.max(1, renderer.terminalHeight - 1 - consoleHeight);

    return computeTableContentModel({
      headers,
      visibleRows,
      visibleMatches,
      rowsOffset,
      colsOffset,
      wrapMode,
      columnOverrides,
      termW: tableW,
      termH: tableH,
      totalRowCount,
      selectionMode: state.selectionMode,
      cursorCol: state.cursorCol,
      showTypes: state.showTypes,
      columnTypes: state.columnTypes,
      showStats: state.showStats,
      columnStats: state.columnStats,
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

    if (key.name === "e" && state.selectionMode === "column") {
      dispatch({ type: "ENTER_RENAME_COLUMN" });
      return;
    }

    if ((key.name === "U" || (key.name === "u" && key.shift)) && state.selectionMode === "column") {
      if (source.hasUnnestHistory() && !unnesting) {
        setUnnesting(true);
        dispatch({ type: "SET_VISIBLE_ROWS", rows: [] });
        source.resetUnnest().then(() => {
          dispatch({ type: "SET_HEADERS", headers: source.getHeaders() });
          dispatch({ type: "SET_TOTAL_ROW_COUNT", count: source.getTotalRows() });
          dispatch({ type: "SET_MATERIALIZED", isMaterialized: false });
          dispatch({ type: "MOVE_UP", pageSize: 999999 });
          lastRenderedOffset.current = -1;
        }).catch((err) => {
          console.error("Reset unnest failed:", err);
        }).finally(() => {
          setUnnesting(false);
        });
      }
      return;
    }

    if (key.name === "u" && state.selectionMode === "column") {
      const colName = headers[cursorCol];
      if (colName && !unnesting) {
        performUnnest(colName);
      }
      return;
    }

    if (key.name === "d" && state.selectionMode === "column") {
      const colName = headers[cursorCol];
      if (colName && !deleting) {
        performDeleteColumn(colName);
      }
      return;
    }

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
            isMaterialized={isMaterialized}
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
            isMaterialized={isMaterialized}
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
      {state.showHelp && <HelpModal />}
    </>
  );
}
