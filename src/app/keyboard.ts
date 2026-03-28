import { type KeyEvent } from "@opentui/core";
import { Action } from "src/app/actions";
import { appendFileSync } from "fs";

export function keyToActions(key: KeyEvent, ctx: { pageSize: number }): Action[] {
  // Debug logging to help identify why shift+up/down might not be working
  try {
    appendFileSync("keyboard_debug.log", JSON.stringify(key) + " mode: " + ctx.pageSize + "\n");
  } catch (e) { }

  const actions: Action[] = [];

  switch (key.name) {
    case "/":
      actions.push({ type: "ENTER_SEARCH" });
      break;
    case "up":
    case "Up":
    case "k":
    case "K":
      if (key.shift || key.name === "K" || key.name === "Up") {
        actions.push({ type: "SORT", direction: "asc" });
      } else {
        actions.push({ type: "MOVE_UP", pageSize: ctx.pageSize });
      }
      break;
    case "down":
    case "Down":
    case "j":
    case "J":
      if (key.shift || key.name === "J" || key.name === "Down") {
        actions.push({ type: "SORT", direction: "desc" });
      } else {
        actions.push({ type: "MOVE_DOWN", pageSize: ctx.pageSize });
      }
      break;
    case "[":
      actions.push({ type: "SORT", direction: "asc" });
      break;
    case "]":
      actions.push({ type: "SORT", direction: "desc" });
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
      if (key.name === ">" || key.name === ".") {
        actions.push({ type: "RESIZE_COLUMN", delta: 1 });
      }
      break;
    case "<":
    case ",":
      if (key.name === "<" || key.name === ",") {
        actions.push({ type: "RESIZE_COLUMN", delta: -1 });
      }
      break;
  }

  return actions;
}
