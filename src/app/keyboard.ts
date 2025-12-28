import { type KeyEvent } from "@opentui/core";
import { Action } from "./actions";

export function keyToActions(key: KeyEvent, ctx: { pageSize: number }): Action[] {
    const actions: Action[] = [];

    switch (key.name) {
        case "up":
        case "k":
            actions.push({ type: "MOVE_UP" });
            break;
        case "down":
        case "j":
            actions.push({ type: "MOVE_DOWN" });
            break;
        case "left":
        case "h":
            actions.push({ type: "MOVE_LEFT" });
            break;
        case "right":
        case "l":
            actions.push({ type: "MOVE_RIGHT" });
            break;
        case "pageup":
            actions.push({ type: "PAGE_UP", pageSize: ctx.pageSize });
            break;
        case "pagedown":
            actions.push({ type: "PAGE_DOWN", pageSize: ctx.pageSize });
            break;
        case "tab":
            actions.push({ type: "CYCLE_SELECTION_MODE" });
            break;
        case "c":
            actions.push({ type: "INC_COUNTER" });
            break;
        case ">":
        case ".":
            if (key.name === ">" || key.name === "." ) {
                actions.push({ type: "RESIZE_COLUMN", delta: 1 });
            }
            break;
        case "<":
        case ",":
            if (key.name === "<" || key.name === "," ) {
                actions.push({ type: "RESIZE_COLUMN", delta: -1 });
            }
            break;
    }

    return actions;
}
