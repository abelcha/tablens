/** @jsxImportSource @opentui/react */
import React, { useState, useEffect, useMemo, useRef } from "react";
import {
    createCliRenderer,
    ConsolePosition,
    type KeyEvent,
    StyledText,
    bold,
    RGBA,
} from "@opentui/core";
import { createRoot, useRenderer, useKeyboard } from "@opentui/react";
import { DuckDBDataSource } from "./data/source";
import { computeColumnWidths, computeRowHeights } from "./layout/calculator";
import { buildHeaderLine, buildSeparatorLine, buildRowLine } from "./utils/text";
import type { State, SelectionMode, WrapMode } from "./types";

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


// Helper to convert blessed-style tags to OpenTUI StyledText
function parseBlessedTags(text: string): StyledText {
    const chunks: any[] = [];
    const stack: { attr: number; color?: string }[] = [];
    let remaining = text;

    const colorMap: Record<string, string> = {
        yellow: "#EBC06D",
        orange: "#EBC06D",
        cyan: "#00ffff",
        green: "#00ff00",
        white: "#ffffff",
        gray: "#888888",
        dim: "#666666",
        red: "#ff0000"
    };

    while (remaining.length > 0) {
        const nextTag = remaining.match(/\{(\/?)([^}]+)\}/);
        if (!nextTag) {
            chunks.push({
                __isChunk: true,
                text: remaining,
                attributes: stack[stack.length - 1]?.attr || 0,
                fg: stack[stack.length - 1]?.color ? RGBA.fromHex(stack[stack.length - 1]!.color!) : undefined
            });
            break;
        }

        const [tagFull, isClosing, tagName] = nextTag;
        const tagIndex = nextTag.index!;

        if (tagIndex > 0) {
            chunks.push({
                __isChunk: true,
                text: remaining.substring(0, tagIndex),
                attributes: stack[stack.length - 1]?.attr || 0,
                fg: stack[stack.length - 1]?.color ? RGBA.fromHex(stack[stack.length - 1]!.color!) : undefined
            });
        }

        if (isClosing) {
            stack.pop();
        } else {
            let attr = stack[stack.length - 1]?.attr || 0;
            let color = stack[stack.length - 1]?.color;

            if (tagName === "bold") attr |= 1 << 0;
            if (colorMap[tagName]) color = colorMap[tagName];

            stack.push({ attr, color });
        }

        remaining = remaining.substring(tagIndex + tagFull.length);
    }

    return new StyledText(chunks);
}

function StatusLine({
    file,
    cursorRow,
    totalRowCount,
    cursorCol,
    numCols,
    counter,
}: {
    file: string;
    cursorRow: number;
    totalRowCount: number;
    cursorCol: number;
    numCols: number;
    counter: number;
}) {
    const content = `{white}${file}{/white} {gray}[Row ${cursorRow + 1}/${totalRowCount}, Col ${cursorCol + 1}/${numCols}]{/gray} {yellow}C: ${counter}{/yellow}`;
    return <text content={parseBlessedTags(content)} />;
}

function TablensApp({ file, source }: { file: string; source: DuckDBDataSource }) {
    const renderer = useRenderer();
    const [state, setState] = useState<State>({
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
        visibleRows: [],
    });
    const [counter, setCounter] = useState(0);

    const [rowsPerSec, setRowsPerSec] = useState(0);
    const rowsRenderedAccumulator = useRef(0);
    const lastRenderedOffset = useRef(-1);

    // Stats interval
    useEffect(() => {
        const interval = setInterval(() => {
            setRowsPerSec(rowsRenderedAccumulator.current);
            rowsRenderedAccumulator.current = 0;
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // Initial data load
    useEffect(() => {
        async function init() {
            try {
                await source.connect(file);
                setState(s => ({
                    ...s,
                    headers: source.getHeaders(),
                    totalRowCount: source.getTotalRows(),
                }));
            } catch (err) {
                console.error("Failed to connect to file:", err);
            }
        }
        init();
    }, [file, source]);

    const { headers, totalRowCount, rowsOffset, colsOffset, cursorRow, cursorCol, selectionMode, wrapMode, visibleRows } = state;

    // Calculate rendering logic (clamping, fetching, layout)
    useEffect(() => {
        if (headers.length === 0 || totalRowCount === 0) return;

        async function updateTable() {
            const tableH = renderer.terminalHeight - 3;
            const fetchLimit = tableH * 2;

            let nextRowsOffset = rowsOffset;
            let nextVisibleRows = visibleRows;

            // Vertical Scroll logic
            if (selectionMode !== 'column' && cursorRow < nextRowsOffset) {
                nextRowsOffset = cursorRow;
            }

            // Fetch if needed
            if (nextRowsOffset !== lastRenderedOffset.current || nextVisibleRows.length === 0) {
                try {
                    nextVisibleRows = await source.getRows(nextRowsOffset, fetchLimit);
                    lastRenderedOffset.current = nextRowsOffset;
                } catch (e) {
                    console.error("Error fetching rows:", e);
                    return;
                }
            }

            // Layout calculations
            const tableW = renderer.terminalWidth - 2;
            let nextColsOffset = colsOffset;
            if (selectionMode !== 'row' && cursorCol < nextColsOffset) {
                nextColsOffset = cursorCol;
            }

            let dispHeaders = headers.slice(nextColsOffset);
            let colWidths = computeColumnWidths(dispHeaders, nextVisibleRows.map(r => r.slice(nextColsOffset)), tableW);

            // Horizontal scroll clamping
            if (selectionMode !== 'row') {
                let relC = cursorCol - nextColsOffset;
                let tw = 0;
                for (let i = 0; i < relC; i++) tw += colWidths[i] || 0;

                while ((relC >= colWidths.length || tw + (colWidths[relC] || 0) > tableW) && nextColsOffset < headers.length - 1) {
                    nextColsOffset++;
                    relC = cursorCol - nextColsOffset;
                    dispHeaders = headers.slice(nextColsOffset);
                    colWidths = computeColumnWidths(dispHeaders, nextVisibleRows.map(r => r.slice(nextColsOffset)), tableW);
                    tw = 0;
                    for (let i = 0; i < relC; i++) tw += colWidths[i] || 0;
                }
            }

            const rowHeights = computeRowHeights(nextVisibleRows.map(r => r.slice(nextColsOffset, nextColsOffset + colWidths.length)), colWidths, wrapMode);

            let curH = 0, visCount = 0;
            for (const h of rowHeights) {
                if (curH + h > tableH && visCount > 0) break;
                curH += h;
                visCount++;
            }

            const relativeCursor = cursorRow - nextRowsOffset;
            if (relativeCursor >= visCount && selectionMode !== 'column') {
                const diff = relativeCursor - visCount + 1;
                nextRowsOffset += diff;
            }

            // Update state if changed
            if (nextRowsOffset !== rowsOffset || nextColsOffset !== colsOffset || nextVisibleRows !== visibleRows) {
                setState(s => ({
                    ...s,
                    rowsOffset: nextRowsOffset,
                    colsOffset: nextColsOffset,
                    visibleRows: nextVisibleRows
                }));
            }

            rowsRenderedAccumulator.current += visCount;
        }

        updateTable();
    }, [headers, totalRowCount, rowsOffset, colsOffset, cursorRow, cursorCol, selectionMode, wrapMode, source, renderer.terminalHeight, renderer.terminalWidth]);

    // Derived values for rendering
    const tableValues = useMemo(() => {
        if (headers.length === 0 || totalRowCount === 0 || visibleRows.length === 0) return null;

        const tableW = renderer.terminalWidth - 2;
        const tableH = renderer.terminalHeight - 3;

        const dispHeaders = headers.slice(colsOffset);
        const colWidths = computeColumnWidths(dispHeaders, visibleRows.map(r => r.slice(colsOffset)), tableW);
        const rowHeights = computeRowHeights(visibleRows.map(r => r.slice(colsOffset, colsOffset + colWidths.length)), colWidths, wrapMode);

        let curH = 0, visCount = 0;
        for (const h of rowHeights) {
            if (curH + h > tableH && visCount > 0) break;
            curH += h;
            visCount++;
        }

        const visRows = visibleRows.slice(0, visCount).map(r => r.slice(colsOffset));
        const visHeights = rowHeights.slice(0, visCount);

        const gutterWidth = String(totalRowCount).length + 2;

        const content = parseBlessedTags(
            buildHeaderLine(dispHeaders, colWidths, gutterWidth) +
            buildSeparatorLine(colWidths, gutterWidth) +
            visRows.map((r, i) => {
                const rowNum = rowsOffset + i + 1;
                return Array.from({ length: visHeights[i] || 1 }, (_, h) =>
                    buildRowLine(r, colWidths, wrapMode, h, rowNum, gutterWidth)
                ).join('');
            }).join('')
        );

        const relR = cursorRow - rowsOffset;
        const relC = cursorCol - colsOffset;

        let cursorStyle: any = { visible: false };
        switch (selectionMode) {
            case 'row': {
                const visible = relR >= 0 && relR < visCount;
                cursorStyle = {
                    visible,
                    top: 3 + visHeights.slice(0, relR).reduce((a, b) => a + b, 0),
                    left: 0,
                    width: "100%",
                    height: visHeights[relR] || 0
                };
                break;
            }
            case 'column': {
                const visible = relC >= 0 && relC < colWidths.length;
                cursorStyle = {
                    visible,
                    top: 1,
                    left: 1 + colWidths.slice(0, relC).reduce((a, b) => a + b, 0),
                    width: colWidths[relC] || 0,
                    height: tableH + 2
                };
                break;
            }
            case 'cell':
            default: {
                const visible = relR >= 0 && relR < visCount && relC >= 0 && relC < colWidths.length;
                cursorStyle = {
                    visible,
                    top: 3 + visHeights.slice(0, relR).reduce((a, b) => a + b, 0),
                    left: 1 + colWidths.slice(0, relC).reduce((a, b) => a + b, 0),
                    width: colWidths[relC] || 0,
                    height: visHeights[relR] || 0
                };
                break;
            }
        }

        return { content, cursorStyle };
    }, [headers, totalRowCount, visibleRows, colsOffset, rowsOffset, cursorRow, cursorCol, selectionMode, wrapMode, renderer.terminalWidth, renderer.terminalHeight]);

    useKeyboard((key: KeyEvent) => {
        if (key.ctrl && key.name === "c") process.exit(0);
        if (key.name === "q") process.exit(0);

        if (key.ctrl && key.name === "`") {
            renderer.console.toggle();
            return;
        }

        if (key.name === "`") {
            renderer.console.toggle();
            return;
        }

        if (renderer.console.visible) {
            return;
        }

        setState(prev => {
            const { totalRowCount, headers, selectionMode, cursorRow, cursorCol, rowsOffset, colsOffset } = prev;
            const numCols = headers.length;
            let next = { ...prev };

            switch (key.name) {
                case "up":
                case "k":
                    if (selectionMode === 'column') {
                        next.rowsOffset = Math.max(0, rowsOffset - 1);
                    } else {
                        next.cursorRow = Math.max(0, cursorRow - 1);
                        if (next.cursorRow < next.rowsOffset) {
                            next.rowsOffset = next.cursorRow;
                        }
                    }
                    break;
                case "down":
                case "j":
                    if (selectionMode === 'column') {
                        next.rowsOffset = Math.min(totalRowCount - 1, rowsOffset + 1);
                    } else {
                        next.cursorRow = Math.min(totalRowCount - 1, cursorRow + 1);
                    }
                    break;
                case "left":
                case "h":
                    if (selectionMode === 'row') {
                        next.colsOffset = Math.max(0, colsOffset - 1);
                    } else {
                        next.cursorCol = Math.max(0, cursorCol - 1);
                        if (next.cursorCol < next.colsOffset) {
                            next.colsOffset = next.cursorCol;
                        }
                    }
                    break;
                case "right":
                case "l":
                    if (selectionMode === 'row') {
                        next.colsOffset = Math.min(numCols - 1, colsOffset + 1);
                    } else {
                        next.cursorCol = Math.min(numCols - 1, cursorCol + 1);
                    }
                    break;
                case "pageup":
                    next.cursorRow = Math.max(0, cursorRow - (renderer.terminalHeight - 4));
                    next.rowsOffset = Math.max(0, rowsOffset - (renderer.terminalHeight - 4));
                    break;
                case "pagedown":
                    next.cursorRow = Math.min(totalRowCount - 1, cursorRow + (renderer.terminalHeight - 4));
                    if (next.cursorRow >= rowsOffset + (renderer.terminalHeight - 4)) {
                        next.rowsOffset = next.cursorRow - (renderer.terminalHeight - 4) + 1;
                        if (next.rowsOffset < 0) next.rowsOffset = 0;
                    }
                    break;
                case "tab":
                    if (selectionMode === 'row') next.selectionMode = 'column';
                    else if (selectionMode === 'column') next.selectionMode = 'cell';
                    else next.selectionMode = 'row';
                    break;
                case "c":
                    setCounter(c => c + 1);
                    break;
            }
            return next;
        });
    });

    return (
        <>
            <box
                id="table"
                top={0}
                left={0}
                width="100%"
                height={renderer.terminalHeight - 1 - (renderer.console.visible ? renderer.console.bounds.height : 0)}
            >
                <text
                    id="table-text"
                    content={tableValues?.content || "Loading..."}
                    top={1}
                    left={1}
                    zIndex={1}
                    wrapMode="none"
                />
                <box
                    id="cursor-overlay"
                    {...tableValues?.cursorStyle}
                    backgroundColor="#ffffff"
                    opacity={0.3}
                    zIndex={10}
                    position="absolute"
                />
            </box>
            <box
                id="status"
                bottom={renderer.console.visible ? renderer.console.bounds.height : 0}
                left={0}
                width="100%"
                height={1}
            >
                <StatusLine
                    file={file}
                    cursorRow={cursorRow}
                    totalRowCount={totalRowCount}
                    cursorCol={cursorCol}
                    numCols={headers.length}
                    counter={counter}
                />
            </box>
        </>
    );
}

async function main() {
    const file = process.argv[2] || "data.csv";
    const source = new DuckDBDataSource();

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

    console.log("This appears in the overlay")
    console.error("Errors are color-coded red")
    console.warn("Warnings appear in yellow")

    createRoot(renderer).render(<TablensApp file={file} source={source} />);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
