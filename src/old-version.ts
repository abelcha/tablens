import {
  createCliRenderer,
  ConsolePosition,
  BoxRenderable,
  TextRenderable,
  type KeyEvent,
  StyledText,
  bold,
} from "@opentui/core";
import { DuckDBDataSource } from "./data/source";
import { computeColumnWidths, computeRowHeights } from "./layout/calculator";
import { buildHeaderLine, buildSeparatorLine, buildRowLine } from "./utils/text";
import type { State, SelectionMode } from "./types";

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
  selectionMode: "row",
  markedRows: new Set(),
  found: [],
  sorter: null,
  wrapMode: "disabled",
  columnOverrides: {},
  headers: [],
  totalRowCount: 0,
  visibleRows: [], // This will hold the currently fetched rows
};

async function main() {
  const file = process.argv[2] || "data.csv";

  const source = new DuckDBDataSource();
  try {
    await source.connect({ filePath: file });
    state.headers = source.getHeaders();
    state.totalRowCount = source.getTotalRows();
  } catch (err) {
    console.error("Failed to connect to file:", err);
    process.exit(1);
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 40,
    useConsole: true,
    consoleOptions: {
      position: ConsolePosition.BOTTOM,
      sizePercent: 30,

      colorInfo: "#00FFFF",
      colorWarn: "#FFFF00",
      colorError: "#FF0000",
      startInDebugMode: false,
    },
  });

  console.log("This appears in the overlay");
  console.error("Errors are color-coded red");
  console.warn("Warnings appear in yellow");

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

  async function updateLayout() {
    const consoleVisible = renderer.console.visible;
    const consoleHeight = consoleVisible ? renderer.console.bounds.height : 0;
    table.height = renderer.terminalHeight - 1 - consoleHeight;
    status.bottom = consoleHeight;
    await renderTable();
  }

  renderer.console.on("layout", updateLayout);

  // We need to keep track of what range is currently loaded in state.visibleRows
  // For simplicity, let's say state.visibleRows corresponds to [state.rowsOffset, state.rowsOffset + bufferSize]
  // Ideally, we want to fetch *exactly* what's needed for the viewport, plus maybe a small buffer.

  let isFetching = false;
  let lastRenderedOffset = -1;
  let lastRenderedHeight = -1;

  // Render stats (1s interval accumulator)
  let rowsRenderedAccumulator = 0;
  let rowsPerSec = 0;

  setInterval(() => {
    rowsPerSec = rowsRenderedAccumulator;
    rowsRenderedAccumulator = 0;

    // Update status bar even if idle
    const screenW = renderer.terminalWidth;
    statusText.content = `{cyan}[${state.selectionMode.toUpperCase()}]{/cyan} {white}Row: ${state.cursorRow + 1}/${state.totalRowCount}{/white} | {white}Col: ${state.cursorCol + 1}/${state.headers.length}{/white} | {dim}Wrap: ${state.wrapMode}{/dim} | {green}${rowsPerSec} rows/sec{/green} | {gray}W:${screenW} H:${renderer.terminalHeight}{/gray}`;
  }, 1000);

  async function renderTable() {
    const { headers, totalRowCount } = state; // Header is static
    const screenW = renderer.terminalWidth;
    const tableW = screenW - 2;
    // table.height is 100% of available space above console/status
    // table content height is box height minus header/separator
    const tableH =
      (typeof table.height === "number" ? table.height : renderer.terminalHeight - 1) - 2;

    if (!headers || headers.length === 0) return;
    if (totalRowCount === 0) {
      tableText.content = "No data to display.";
      statusText.content = `Row: 0/0 | Col: 0/${headers.length} | Wrap: ${state.wrapMode} | W:${screenW} H:${renderer.terminalHeight}`;
      cursorOverlay.visible = false;
      return;
    }

    // 1. Clamp cursor
    state.cursorRow = Math.max(0, Math.min(totalRowCount - 1, state.cursorRow));
    state.cursorCol = Math.max(0, Math.min(headers.length - 1, state.cursorCol));

    // 2. Vertical Scroll logic
    if (state.selectionMode !== "column" && state.cursorRow < state.rowsOffset) {
      state.rowsOffset = state.cursorRow;
    }
    // We can't easily know if cursorRow > visible bottom without heights.
    // But we know approximate rows based on screen height (at least 1 line per row).
    // Let's assume tableH rows max for checking bounds vaguely, but real calculation happens after fetch.
    // Actually, we need to fetch a chunk starting at rowsOffset.

    // FETCH LOGIC
    // We fetch tableH + X rows to ensure we fill the screen.
    // Since wrapMode might make rows tall, fetching tableH rows might be enough or too much.
    // Let's fetch tableH * 2 to be safe for now (lazy but effective).
    const fetchLimit = tableH * 2;

    // Only fetch if we moved
    if (state.rowsOffset !== lastRenderedOffset || state.visibleRows.length === 0) {
      // Note: isFetching check is to prevent overlapping calls if we want to debounce,
      // but for now we await implicitly or just let it race (DuckDB is single threaded mostly in node-api connection?)
      // Let's simple await.

      try {
        state.visibleRows = await source.getRows(state.rowsOffset, fetchLimit);
        lastRenderedOffset = state.rowsOffset;
      } catch (e: any) {
        statusText.content = `Error fetching rows: ${e.message || e}`;
        return;
      }
    }

    const rows = state.visibleRows;
    if (!rows || (rows.length === 0 && totalRowCount > 0)) {
      // This can happen if totalRowCount > 0 but the fetched chunk is empty (e.g., at the very end)
      // Or if the fetch failed silently.
      statusText.content = `Error: No rows fetched for offset ${state.rowsOffset}. Total: ${totalRowCount}`;
      return;
    }

    // 3. Horizontal scrolling & Widths (One-pass on visible rows)
    if (state.selectionMode !== "row" && state.cursorCol < state.colsOffset) {
      state.colsOffset = state.cursorCol;
    }

    let dispHeaders = headers.slice(state.colsOffset);
    // Compute widths based on VISIBLE rows only
    let colWidths = computeColumnWidths(
      dispHeaders,
      rows.map((r) => r.slice(state.colsOffset)),
      tableW,
    );

    // Scroll right if cursor is past visible columns
    // Check if we need to scroll right (only if NOT in row mode)
    let loops = 0;
    let relC = state.cursorCol - state.colsOffset;

    if (state.selectionMode !== "row") {
      let tw = 0;
      for (let i = 0; i < relC; i++) tw += colWidths[i] || 0;

      while ((relC >= colWidths.length || tw + (colWidths[relC] || 0) > tableW) && loops < 1000) {
        state.colsOffset++;
        relC = state.cursorCol - state.colsOffset;
        dispHeaders = headers.slice(state.colsOffset);
        colWidths = computeColumnWidths(
          dispHeaders,
          rows.map((r) => r.slice(state.colsOffset)),
          tableW,
        );
        tw = 0;
        for (let i = 0; i < relC; i++) tw += colWidths[i] || 0;
        if (state.colsOffset >= headers.length - 1) break;
        loops++;
      }
    }

    // 4. Vertical Row Heights
    // We computed heights for the fetched chunk
    const rowHeights = computeRowHeights(
      rows.map((r) => r.slice(state.colsOffset, state.colsOffset + colWidths.length)),
      colWidths,
      state.wrapMode,
    );

    let curH = 0,
      visCount = 0;
    for (const h of rowHeights) {
      if (curH + h > tableH && visCount > 0) break;
      curH += h;
      visCount++;
    }

    // Smart Scroll Down:
    // If cursor is beyond the VISIBLE (rendered) rows within the fetched chunk.
    // state.rowsOffset is the start of the chunk.
    // cursorRow is absolute.
    const relativeCursor = state.cursorRow - state.rowsOffset;

    if (relativeCursor >= visCount) {
      // We need to scroll down.
      // Increment offset and RE-FETCH.
      const diff = relativeCursor - visCount + 1;
      state.rowsOffset += diff;
      // Recursive call to re-fetch and re-render
      // But preventing infinite recursion if something is wrong
      if (state.rowsOffset < totalRowCount && loops < 1000) {
        // Add loop guard for recursion
        loops++;
        return renderTable();
      }
    }

    const visRows = rows.slice(0, visCount).map((r) => r.slice(state.colsOffset));
    const visHeights = rowHeights.slice(0, visCount);

    // 5. Update UI
    tableText.content = parseBlessedTags(
      buildHeaderLine(dispHeaders, colWidths) +
      buildSeparatorLine(colWidths) +
      visRows
        .map((r, i) =>
          Array.from({ length: visHeights[i] || 1 }, (_, h) =>
            buildRowLine(r, colWidths, state.wrapMode, h),
          ).join(""),
        )
        .join(""),
    );

    const relR = state.cursorRow - state.rowsOffset;

    // Selection Mode Logic
    // Row Mode: Highlight entire row (if visible)
    // Column Mode: Highlight entire column (if visible)
    // Cell Mode: Highlight single cell (if visible)

    // Default shared props (backgroundColor, opacity) are set in constructor

    const cursorStyle = getCursorStyle(
      state.selectionMode,
      relR,
      relC,
      visCount,
      visHeights,
      colWidths,
      tableH,
    );

    Object.assign(cursorOverlay, cursorStyle);

    // Update stats: Accumulate for setInterval check
    rowsRenderedAccumulator += visCount;

    // Immediate update for responsiveness, though setInterval will catch up
    statusText.content = `{cyan}[${state.selectionMode.toUpperCase()}]{/cyan} {white}Row: ${state.cursorRow + 1}/${totalRowCount}{/white} | {white}Col: ${state.cursorCol + 1}/${headers.length}{/white} | {dim}Wrap: ${state.wrapMode}{/dim} | {green}${rowsPerSec} rows/sec{/green} | {gray}W:${screenW} H:${renderer.terminalHeight}{/gray}`;
  }

  function getCursorStyle(
    mode: SelectionMode,
    relR: number,
    relC: number,
    visCount: number,
    visHeights: number[],
    colWidths: number[],
    tableH: number,
  ): {
    visible: boolean;
    top?: number;
    left?: number | string;
    width?: number | string;
    height?: number;
  } {
    switch (mode) {
      case "row": {
        const visible = relR >= 0 && relR < visCount;
        return {
          visible,
          top: 3 + visHeights.slice(0, relR).reduce((a, b) => a + b, 0),
          left: 0,
          width: "100%",
          height: visHeights[relR] || 0,
        };
      }
      case "column": {
        const visible = relC >= 0 && relC < colWidths.length;
        return {
          visible,
          top: 1,
          left: 1 + colWidths.slice(0, relC).reduce((a, b) => a + b, 0),
          width: colWidths[relC] || 0,
          height: tableH + 2,
        };
      }
      case "cell":
      default: {
        const visible = relR >= 0 && relR < visCount && relC >= 0 && relC < colWidths.length;
        return {
          visible,
          top: 3 + visHeights.slice(0, relR).reduce((a, b) => a + b, 0),
          left: 1 + colWidths.slice(0, relC).reduce((a, b) => a + b, 0),
          width: colWidths[relC] || 0,
          height: visHeights[relR] || 0,
        };
      }
    }
  }
  // }

  renderer.keyInput.on("keypress", async (key: KeyEvent) => {
    if (key.ctrl && key.name === "c") {
      renderer.destroy();
      process.exit(0);
    }
    if (key.name === "q") {
      renderer.destroy();
      process.exit(0);
    }

    if (key.ctrl && key.name === "`") {
      (renderer.console as any).visible = !(renderer.console as any).visible;
      return;
    }

    if (key.name === "`") {
      renderer.console.toggle();
      return;
    }

    if ((renderer.console as any).focused) {
      return;
    }

    const { totalRowCount, headers } = state;
    const numCols = headers.length;

    switch (key.name) {
      case "up":
      case "k":
        if (state.selectionMode === "column") {
          // In column mode, up/down moves the SCROLL, not the cursor (cursor stays on same column visually, but functionally we just scroll)
          // Actually, if we want to "scroll the view" but keep "bar on same column", we just change rowsOffset?
          // But cursorRow tracks the *selection*. In column mode, rows aren't selected. The column is.
          // So cursorRow is irrelevant?
          // Guide says: "Vertical Nav (↓/↑): Scrolls the view up/down. The selection "bar" stays on the same column."
          state.rowsOffset = Math.max(0, state.rowsOffset - 1);
        } else {
          // Row or Cell mode
          state.cursorRow = Math.max(0, state.cursorRow - 1);
          if (state.cursorRow < state.rowsOffset) {
            state.rowsOffset = state.cursorRow;
          }
        }
        break;
      case "down":
      case "j":
        if (state.selectionMode === "column") {
          // Scroll view down
          state.rowsOffset = Math.min(totalRowCount - 1, state.rowsOffset + 1);
        } else {
          state.cursorRow = Math.min(totalRowCount - 1, state.cursorRow + 1);
        }
        break;
      case "left":
      case "h":
        if (state.selectionMode === "row") {
          // "Scrolls the view left/right. The selection "bar" stays on the same row."
          state.colsOffset = Math.max(0, state.colsOffset - 1);
        } else {
          // Column or Cell mode
          state.cursorCol = Math.max(0, state.cursorCol - 1);
          if (state.cursorCol < state.colsOffset) {
            state.colsOffset = state.cursorCol;
          }
        }
        break;
      case "right":
      case "l":
        if (state.selectionMode === "row") {
          // Scroll view right
          state.colsOffset = Math.min(numCols - 1, state.colsOffset + 1);
        } else {
          state.cursorCol = Math.min(numCols - 1, state.cursorCol + 1);
        }
        break;
      case "pageup":
        state.cursorRow = Math.max(0, state.cursorRow - (renderer.terminalHeight - 4));
        state.rowsOffset = Math.max(0, state.rowsOffset - (renderer.terminalHeight - 4));
        break;
      case "pagedown":
        state.cursorRow = Math.min(
          totalRowCount - 1,
          state.cursorRow + (renderer.terminalHeight - 4),
        );
        if (state.cursorRow >= state.rowsOffset + (renderer.terminalHeight - 4)) {
          state.rowsOffset = state.cursorRow - (renderer.terminalHeight - 4) + 1;
          if (state.rowsOffset < 0) state.rowsOffset = 0;
        }
        break;
      case "tab":
        if (state.selectionMode === "row") state.selectionMode = "column";
        else if (state.selectionMode === "column") state.selectionMode = "cell";
        else state.selectionMode = "row";
        break;
    }
    await renderTable();
  });

  renderer.on("resize", () => {
    updateLayout();
  });

  await renderTable();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
