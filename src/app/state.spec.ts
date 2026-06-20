import { describe, expect, it } from "bun:test";
import { initialState, reducer } from "./state";

describe("app state", () => {
  it("tracks column order and keeps the cursor on a visible column", () => {
    let state = initialState();
    state = reducer(state, { type: "SET_HEADERS", headers: ["A", "B", "C"] });
    state = reducer(state, { type: "MOVE_RIGHT", pageSize: 10 });
    expect(state.cursorCol).toBe(1);

    state = reducer(state, { type: "OPEN_COLUMN_MANAGER" });
    state = reducer(state, { type: "MOVE_COLUMN_MANAGER_CURSOR", delta: 1 });
    expect(state.columnManagerCursor).toBe(2);
    state = reducer(state, { type: "MOVE_COLUMN_IN_LAYOUT", delta: -1 });

    expect(state.columnOrder).toEqual([0, 2, 1]);
    state = reducer(state, { type: "TOGGLE_COLUMN_HIDDEN" });
    expect(state.hiddenColumns.has(2)).toBe(true);
  });
});
