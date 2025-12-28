export type Action =
  | { type: "MOVE_UP" }
  | { type: "MOVE_DOWN" }
  | { type: "MOVE_LEFT" }
  | { type: "MOVE_RIGHT" }
  | { type: "PAGE_UP"; pageSize: number }
  | { type: "PAGE_DOWN"; pageSize: number }
  | { type: "CYCLE_SELECTION_MODE" }
  | { type: "INC_COUNTER" }
  | { type: "SET_TOTAL_ROW_COUNT"; count: number }
  | { type: "SET_HEADERS"; headers: string[] }
  | { type: "APPLY_VIEWPORT_PATCH"; patch: any; requestId: number }
  | { type: "RESIZE_COLUMN"; delta: number; currentWidth?: number };
