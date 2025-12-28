/** @jsxImportSource @opentui/react */
import React, { useState, useEffect, useMemo, useRef, useReducer } from "react";
import {
    createCliRenderer,
    ConsolePosition,
    type KeyEvent,
} from "@opentui/core";
import { createRoot, useRenderer, useKeyboard } from "@opentui/react";
import { DuckDBDataSource } from "./data/source";
import { initialState, reducer } from "./app/state";
import { keyToActions } from "./app/keyboard";
import { computeViewportPatch } from "./app/viewport";
import { computeTableContentModel, computeCursorOverlay, computeHeaderOverlay } from "./app/render";
import { StatusLine } from "./app/components/StatusLine";
import { parseInlineMarkup } from "./app/markup";

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


function TablensApp({ file, source }: { file: string; source: DuckDBDataSource }) {
    const renderer = useRenderer();
    const [state, dispatch] = useReducer(reducer, initialState());
    const [terminalBgColor, setTerminalBgColor] = useState<string>("#1e1e1e");

    // Detect terminal background color
    useEffect(() => {
        renderer.getPalette().then((colors) => {
            if (colors.defaultBackground) {
                setTerminalBgColor(colors.defaultBackground);
            }
        }).catch(() => {
            // Fallback if detection fails
        });
    }, [renderer]);

    const lastRenderedOffset = useRef(-1);
    const lastRequestId = useRef(0);

    // Initial data load
    useEffect(() => {
        async function init() {
            try {
                await source.connect(file);
                dispatch({ type: "SET_HEADERS", headers: source.getHeaders() });
                dispatch({ type: "SET_TOTAL_ROW_COUNT", count: source.getTotalRows() });
            } catch (err) {
                console.error("Failed to connect to file:", err);
            }
        }
        init();
    }, [file, source]);

    const { headers, totalRowCount, rowsOffset, colsOffset, cursorRow, cursorCol, selectionMode, wrapMode, visibleRows, columnOverrides } = state;

    // Viewport and data fetch effect
    useEffect(() => {
        if (headers.length === 0 || totalRowCount === 0) return;

        const tableH = renderer.terminalHeight - 1 - (renderer.console.visible ? renderer.console.bounds.height : 0);
        const tableW = renderer.terminalWidth;
        const requestId = ++lastRequestId.current;

        computeViewportPatch({
            state,
            termW: tableW,
            termH: tableH,
            source,
            lastRenderedOffset: lastRenderedOffset.current
        }).then(patch => {
            if (patch.rowsOffset !== state.rowsOffset || patch.colsOffset !== state.colsOffset || patch.visibleRows !== state.visibleRows) {
                lastRenderedOffset.current = patch.rowsOffset;
                dispatch({ type: "APPLY_VIEWPORT_PATCH", patch, requestId });
            }
        });
    }, [renderer.terminalHeight, renderer.terminalWidth, renderer.console.visible, headers, totalRowCount, cursorRow, cursorCol, selectionMode, wrapMode, columnOverrides]);

    // Derived values for rendering
    const tableContent = useMemo(() => {
        if (headers.length === 0 || totalRowCount === 0 || visibleRows.length === 0) return null;

        const tableW = renderer.terminalWidth;
        const tableH = renderer.terminalHeight - 1 - (renderer.console.visible ? renderer.console.bounds.height : 0);

        return computeTableContentModel({
            headers,
            visibleRows,
            rowsOffset,
            colsOffset,
            wrapMode,
            columnOverrides,
            termW: tableW,
            termH: tableH,
            totalRowCount,
            selectionMode: state.selectionMode,
            cursorCol: state.cursorCol,
        });
    }, [headers, totalRowCount, visibleRows, colsOffset, rowsOffset, wrapMode, columnOverrides, state.selectionMode, state.cursorCol, renderer.terminalWidth, renderer.terminalHeight, renderer.console.visible]);

    const cursorStyle = useMemo(() => {
        if (!tableContent) return { visible: false };

        const tableH = renderer.terminalHeight - 1 - (renderer.console.visible ? renderer.console.bounds.height : 0);

        return computeCursorOverlay({
            state,
            colWidths: tableContent.colWidths,
            rowHeights: tableContent.rowHeights,
            gutterWidth: tableContent.gutterWidth,
            termH: tableH,
            visCount: tableContent.visCount,
        });
    }, [state, tableContent, renderer.terminalHeight, renderer.console.visible]);

    const headerOverlay = useMemo(() => {
        if (!tableContent) return { visible: false };

        return computeHeaderOverlay({
            state,
            colWidths: tableContent.colWidths,
            gutterWidth: tableContent.gutterWidth,
            dispHeaders: headers.slice(state.colsOffset),
            colsOffset: state.colsOffset,
        });
    }, [state, tableContent, headers]);

    useKeyboard((key: KeyEvent) => {
        if (key.ctrl && key.name === "c") {
            renderer.destroy();
            process.exit(0);
        }
        if (key.name === "q") {
            renderer.destroy();
            process.exit(0);
        }

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

        const pageSize = renderer.terminalHeight - 4;
        const actions = keyToActions(key, { pageSize });
        actions.forEach(action => {
            // If resizing a column, pass the current computed width
            if (action.type === "RESIZE_COLUMN" && tableContent && state.selectionMode === 'column') {
                const colIdx = state.cursorCol - state.colsOffset;
                if (colIdx >= 0 && colIdx < tableContent.colWidths.length) {
                    dispatch({ ...action, currentWidth: tableContent.colWidths[colIdx] });
                    return;
                }
            }
            dispatch(action);
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
                    content={tableContent?.content || "Loading..."}
                    top={0}
                    left={0}
                    zIndex={1}
                    wrapMode="none"
                />
                <box
                    id="cursor-overlay"
                    {...cursorStyle}
                    backgroundColor="#ffffff"
                    opacity={0.2}
                    zIndex={10}
                    position="absolute"
                />
                {headerOverlay.visible && (
                    <box
                        id="header-overlay"
                        top={headerOverlay.top}
                        left={headerOverlay.left}
                        width={headerOverlay.width}
                        height={headerOverlay.height}
                        zIndex={15}
                        position="absolute"
                        backgroundColor={terminalBgColor}
                    >
                        <text
                            content={parseInlineMarkup(` {orange}{bold}{underline}${headerOverlay.headerText}{/underline}{/bold}{/orange} `)}
                            left={0}
                        />
                    </box>
                )}
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
                    counter={state.counter}
                    gutterWidth={String(totalRowCount).length + 2}
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
