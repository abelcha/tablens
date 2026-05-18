export type Action =
  | { type: "MOVE_UP"; pageSize: number }
  | { type: "MOVE_DOWN"; pageSize: number }
  | { type: "MOVE_LEFT" }
  | { type: "MOVE_RIGHT" }
  | { type: "PAGE_UP"; pageSize: number }
  | { type: "PAGE_DOWN"; pageSize: number }
  | { type: "CYCLE_SELECTION_MODE" }
  | { type: "INC_COUNTER" }
  | { type: "SET_TOTAL_ROW_COUNT"; count: number }
  | { type: "RESET_VIEWPORT"; preserveColumn?: boolean }
  | { type: "SET_HEADERS"; headers: string[] }
  | { type: "APPLY_VIEWPORT_PATCH"; patch: any; requestId: number }
  | { type: "RESIZE_COLUMN"; delta: number; currentWidth?: number }
  | { type: "ENTER_SEARCH" }
  | { type: "EXIT_SEARCH" }
  | { type: "SET_SEARCH_QUERY"; query: string }
  | { type: "TOGGLE_SEARCH_REGEX" }
  | { type: "TOGGLE_SEARCH_WHOLE_WORD" }
  | { type: "TOGGLE_SEARCH_CASE_SENSITIVE" }
  | { type: "SET_SEARCH_MATCH_ROW_COUNT"; count: number | null }
  | { type: "SET_SEARCH_ERROR"; error: string | null }
  | { type: "SET_MATERIALIZED"; isMaterialized: boolean }
  | { type: "SORT"; direction: "asc" | "desc" }
  | { type: "AUTO_RESIZE_COLUMNS"; headers: string[]; visibleRows: string[][] }
  | { type: "ENTER_RENAME_COLUMN" }
  | { type: "EXIT_RENAME_COLUMN" }
  | { type: "SET_RENAME_QUERY"; query: string }
  | { type: "PROMPT_SAVE_PATH"; defaultPath?: string }
  | { type: "SET_SAVE_PATH_QUERY"; query: string }
  | { type: "EXIT_SAVE_PATH_PROMPT" }
  | { type: "OPEN_QUERY_EDITOR"; query: string }
  | { type: "SET_QUERY_EDITOR_VALUE"; query: string }
  | { type: "CLOSE_QUERY_EDITOR" }
  | { type: "SET_VISIBLE_ROWS"; rows: string[][] }
  | { type: "TOGGLE_SHOW_TYPES" }
  | { type: "SET_COLUMN_TYPES"; types: string[] }
  | { type: "TOGGLE_SHOW_STATS" }
  | { type: "SET_COLUMN_STATS"; stats: string[] }
  | {
    type: "YANK";
    selectionMode: "cell" | "row" | "column";
    cursorRow: number;
    cursorCol: number;
    visibleRows: string[][];
    headers: string[];
    rowsOffset: number;
  }
  | { type: "TOGGLE_HELP" }
  | { type: "TOGGLE_COLUMN_COMPACTION" }
    | { type: "ENTER_COL_SEARCH" }
    | { type: "EXIT_COL_SEARCH" }
  | { type: "SET_COL_SEARCH_QUERY"; query: string }
  | { type: "OPEN_COLUMN_FILTER" }
  | { type: "CLOSE_COLUMN_FILTER" }
  | { type: "SET_COLUMN_FILTER_DATA"; data: any }
  | { type: "MOVE_FILTER_CURSOR"; delta: number; visibleCount: number }
  | { type: "ENTER_COLUMN_FILTER_SEARCH" }
  | { type: "EXIT_COLUMN_FILTER_SEARCH" }
  | { type: "SET_COLUMN_FILTER_SEARCH_QUERY"; query: string }
  | { type: "RESET_COLUMN_FILTER" }
  | { type: "TOGGLE_COLUMN_FILTER_VALUE"; value: string }
  | { type: "APPLY_COLUMN_FILTER"; value: string };
