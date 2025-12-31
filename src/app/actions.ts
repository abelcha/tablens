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
  | { type: "AUTO_RESIZE_COLUMNS"; headers: string[]; visibleRows: string[][] }
  | {
      type: "YANK";
      selectionMode: "cell" | "row" | "column";
      cursorRow: number;
      cursorCol: number;
      visibleRows: string[][];
      headers: string[];
      rowsOffset: number;
    };
