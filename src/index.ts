import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  type KeyEvent,
  StyledText,
  bold,
} from "@opentui/core";
import {
  loadCSV,
  computeColumnWidths,
  computeRowHeights,
  buildHeaderLine,
  buildSeparatorLine,
  buildRowLine,
} from "./shared";
import type { State } from "./shared";

// Helper to convert blessed-style tags to OpenTUI StyledText
function parseBlessedTags(text: string): StyledText {
  const chunks: any[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const boldStart = remaining.indexOf("{bold}");
    if (boldStart === -1) {
      chunks.push({ __isChunk: true, text: remaining, attributes: 0 });
      break;
    }

    if (boldStart > 0) {
      chunks.push({ __isChunk: true, text: remaining.substring(0, boldStart), attributes: 0 });
    }

    const boldEnd = remaining.indexOf("{/bold}", boldStart);
    if (boldEnd === -1) {
      chunks.push(bold(remaining.substring(boldStart + 6)));
      break;
    }

    chunks.push(bold(remaining.substring(boldStart + 6, boldEnd)));
    remaining = remaining.substring(boldEnd + 7);
  }

  return new StyledText(chunks);
}

// App state
const state: State = {
  rowsOffset: 0,
  colsOffset: 0,
  cursorRow: 0,
  cursorCol: 0,
  numFreezeCols: 0,
  markedRows: new Set(),
  found: [],
  sorter: null,
  wrapMode: "chars",
  columnOverrides: {},
  data: { headers: [], rows: [] },
};

async function main() {
  const file = process.argv[2] || "data.csv";

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
  });

  state.data = await loadCSV(file);

  const table = new BoxRenderable(renderer, {
    id: "table",
    top: 0,
    left: 0,
    width: "100%",
    height: renderer.terminalHeight - 2,
    border: true,
    borderStyle: "single",
    borderColor: "#888888",
  });

  const tableText = new TextRenderable(renderer, {
    id: "table-text",
    top: 1,
    left: 1,
    content: "",
    zIndex: 1,
    wrapMode: "none",
  });
  table.add(tableText);

  const status = new BoxRenderable(renderer, {
    id: "status",
    bottom: 0,
    left: 0,
    width: "100%",
    height: 2,
    border: true,
    borderStyle: "single",
    borderColor: "#888888",
  });

  const statusText = new TextRenderable(renderer, {
    id: "status-text",
    content: "",
    zIndex: 1,
  });
  status.add(statusText);

  const cursorOverlay = new BoxRenderable(renderer, {
    id: "cursor-overlay",
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    backgroundColor: "#ffffff",
    opacity: 0.3,
    zIndex: 10,
    visible: false,
    position: "absolute",
  });
  table.add(cursorOverlay);

  renderer.root.add(table);
  renderer.root.add(status);

  function renderTable() {
    const { headers, rows } = state.data;
    if (!headers || !rows || headers.length === 0) return;

    const screenW = renderer.terminalWidth, screenH = renderer.terminalHeight;
    const tableW = screenW - 2, tableH = screenH - 6;

    // 1. Clamp cursor
    state.cursorRow = Math.max(0, Math.min(rows.length - 1, state.cursorRow));
    state.cursorCol = Math.max(0, Math.min(headers.length - 1, state.cursorCol));

    // 2. Simple Scroll into view (Vertical)
    if (state.cursorRow < state.rowsOffset) {
      state.rowsOffset = state.cursorRow;
    }

    // 3. Horizontal scrolling & Widths (One-pass)
    if (state.cursorCol < state.colsOffset) {
      state.colsOffset = state.cursorCol;
    }

    let dispHeaders = headers.slice(state.colsOffset);
    let colWidths = computeColumnWidths(dispHeaders, rows.slice(state.rowsOffset, state.rowsOffset + 10).map(r => r.slice(state.colsOffset)), tableW);

    // Scroll right if cursor is past visible columns
    let relC = state.cursorCol - state.colsOffset;
    let tw = 0;
    for (let i = 0; i < relC; i++) tw += colWidths[i] || 0;
    
    while (relC >= colWidths.length || tw + (colWidths[relC] || 0) > tableW) {
      state.colsOffset++;
      relC = state.cursorCol - state.colsOffset;
      dispHeaders = headers.slice(state.colsOffset);
      colWidths = computeColumnWidths(dispHeaders, rows.slice(state.rowsOffset, state.rowsOffset + 10).map(r => r.slice(state.colsOffset)), tableW);
      tw = 0;
      for (let i = 0; i < relC; i++) tw += colWidths[i] || 0;
      if (state.colsOffset >= headers.length - 1) break;
    }

    // 4. Vertical scrolling (One-pass)
    const rowHeights = computeRowHeights(rows.slice(state.rowsOffset, state.rowsOffset + tableH + 1).map(r => r.slice(state.colsOffset, state.colsOffset + colWidths.length)), colWidths, state.wrapMode);
    
    let curH = 0, visCount = 0;
    for (const h of rowHeights) {
      if (curH + h > tableH && visCount > 0) break;
      curH += h;
      visCount++;
    }

    // If cursorRow is past visible rows, scroll down
    if (state.cursorRow >= state.rowsOffset + visCount) {
      state.rowsOffset += (state.cursorRow - (state.rowsOffset + visCount) + 1);
      // Re-run once to fix rowHeights and visCount
      return renderTable();
    }

    const visRows = rows.slice(state.rowsOffset, state.rowsOffset + visCount).map(r => r.slice(state.colsOffset));
    const visHeights = rowHeights.slice(0, visCount);

    // 5. Update UI
    tableText.content = parseBlessedTags(
      buildHeaderLine(dispHeaders, colWidths) + buildSeparatorLine(colWidths) +
      visRows.map((r, i) => Array.from({ length: visHeights[i] || 1 }, (_, h) => buildRowLine(r, colWidths, state.wrapMode, h)).join('')).join('')
    );

    const relR = state.cursorRow - state.rowsOffset;
    cursorOverlay.visible = relR >= 0 && relR < visCount && relC >= 0 && relC < colWidths.length;
    if (cursorOverlay.visible) {
      cursorOverlay.top = 3 + visHeights.slice(0, relR).reduce((a, b) => a + b, 0);
      cursorOverlay.left = 1 + colWidths.slice(0, relC).reduce((a, b) => a + b, 0);
      cursorOverlay.width = colWidths[relC] || 0;
      cursorOverlay.height = visHeights[relR] || 0;
    }

    statusText.content = `Row: ${state.cursorRow + 1}/${rows.length} | Col: ${state.cursorCol + 1}/${headers.length} | Wrap: ${state.wrapMode} | W:${screenW} H:${screenH}`;
  }

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.ctrl && key.name === "c") process.exit(0);
    if (key.name === "q") process.exit(0);

    const { headers, rows } = state.data;
    const numRows = rows?.length || 0;
    const numCols = headers?.length || 0;

    switch (key.name) {
      case "up":
      case "k":
        state.cursorRow = Math.max(0, state.cursorRow - 1);
        if (state.cursorRow < state.rowsOffset) {
          state.rowsOffset = state.cursorRow;
        }
        break;
      case "down":
      case "j":
        state.cursorRow = Math.min(numRows - 1, state.cursorRow + 1);
        // We'll handle scrolling down in renderTable or here if we knew visible rows
        // For simplicity, let's just make sure it stays in view
        break;
      case "left":
      case "h":
        state.cursorCol = Math.max(0, state.cursorCol - 1);
        if (state.cursorCol < state.colsOffset) {
          state.colsOffset = state.cursorCol;
        }
        break;
      case "right":
      case "l":
        state.cursorCol = Math.min(numCols - 1, state.cursorCol + 1);
        break;
      case "pageup":
        state.cursorRow = Math.max(0, state.cursorRow - (renderer.terminalHeight - 4));
        state.rowsOffset = Math.max(0, state.rowsOffset - (renderer.terminalHeight - 4));
        break;
      case "pagedown":
        state.cursorRow = Math.min(numRows - 1, state.cursorRow + (renderer.terminalHeight - 4));
        state.rowsOffset = Math.min(numRows - 1, state.rowsOffset + (renderer.terminalHeight - 4));
        break;
    }
    renderTable();
  });

  renderer.on("resize", () => {
    table.height = renderer.terminalHeight - 2;
    renderTable();
  });

  renderTable();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
