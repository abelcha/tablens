import { State } from "../types";
import { DuckDBDataSource } from "../data/source";
import { computeColumnWidths, computeRowHeights } from "../layout/calculator";

export interface ViewportPatch {
    rowsOffset: number;
    colsOffset: number;
    visibleRows: string[][];
}

export async function computeViewportPatch(args: {
    state: State;
    termW: number;
    termH: number;
    source: DuckDBDataSource;
    lastRenderedOffset: number;
}): Promise<ViewportPatch> {
    const { state, termW, termH, source, lastRenderedOffset } = args;
    const { headers, selectionMode, cursorRow, cursorCol, wrapMode, columnOverrides } = state;
    let { rowsOffset, colsOffset, visibleRows } = state;

    // Fetch more rows to support larger sample window for column width calculation
    // This prevents columns from disappearing/reappearing with sparse data
    const fetchLimit = Math.max(termH * 2, 200);

    // 1. Vertical scrolling (if needed by cursor)
    if (selectionMode !== 'column' && cursorRow < rowsOffset) {
        rowsOffset = cursorRow;
    }

    // 2. Fetch if offset changed or rows empty
    if (rowsOffset !== lastRenderedOffset || visibleRows.length === 0) {
        try {
            visibleRows = await source.getRows(rowsOffset, fetchLimit);
        } catch (e) {
            console.error("Error fetching rows:", e);
        }
    }

    // 3. Horizontal scrolling (if needed by cursor)
    if (selectionMode !== 'row' && cursorCol < colsOffset) {
        colsOffset = cursorCol;
    }

    let dispHeaders = headers.slice(colsOffset);
    const getAdjustedOverrides = (offset: number) => {
        const adjusted: Record<number, number> = {};
        for (const [idx, width] of Object.entries(columnOverrides)) {
            const i = parseInt(idx);
            if (i >= offset) adjusted[i - offset] = width;
        }
        return adjusted;
    };

    let colWidths = computeColumnWidths(dispHeaders, visibleRows.map(r => r.slice(colsOffset)), termW, getAdjustedOverrides(colsOffset));

    if (selectionMode !== 'row') {
        let relC = cursorCol - colsOffset;
        let tw = 0;
        for (let i = 0; i < relC; i++) tw += colWidths[i] || 0;

        while ((relC >= colWidths.length || tw + (colWidths[relC] || 0) > termW) && colsOffset < headers.length - 1) {
            colsOffset++;
            relC = cursorCol - colsOffset;
            dispHeaders = headers.slice(colsOffset);
            colWidths = computeColumnWidths(dispHeaders, visibleRows.map(r => r.slice(colsOffset)), termW, getAdjustedOverrides(colsOffset));
            tw = 0;
            for (let i = 0; i < relC; i++) tw += colWidths[i] || 0;
        }
    }

    // 4. Vertical "auto-scroll" if cursor past bottom
    const rowHeights = computeRowHeights(visibleRows.map(r => r.slice(colsOffset, colsOffset + colWidths.length)), colWidths, wrapMode);
    let curH = 0, visCount = 0;
    // termH already excludes status bar, subtract: blank line + header + separator + bottom separator + 1 buffer
    const availableRowHeight = termH - 5;
    for (const h of rowHeights) {
        if (curH + h > availableRowHeight && visCount > 0) break;
        curH += h;
        visCount++;
    }

    const relativeCursor = cursorRow - rowsOffset;
    // Scroll when cursor goes past last visible row
    if (relativeCursor >= visCount && selectionMode !== 'column') {
        const diff = relativeCursor - visCount + 1;
        rowsOffset += diff;
        // Re-fetch rows after auto-scroll
        try {
            visibleRows = await source.getRows(rowsOffset, fetchLimit);
        } catch (e) {
            console.error("Error fetching rows:", e);
        }
    }

    return { rowsOffset, colsOffset, visibleRows };
}
