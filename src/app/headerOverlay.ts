import type { State } from "src/types";
import { LEFT_PADDING } from "src/utils/text";

export interface HeaderOverlay {
  visible: boolean;
  top?: number;
  left?: number;
  width?: number;
  height?: number;
  headerText?: string;
  padding?: number;
}

export function computeHeaderOverlay(args: {
  selectionMode: State["selectionMode"];
  selectedColIndex?: number;
  sortColumnIndex?: number;
  sortDirection?: "asc" | "desc";
  colWidths: number[];
  gutterWidth: number;
  dispHeaders: string[];
  colsOffset: number;
}): HeaderOverlay {
  const {
    selectionMode,
    selectedColIndex,
    sortColumnIndex,
    sortDirection,
    colWidths,
    gutterWidth,
    dispHeaders,
    colsOffset,
  } = args;

  if (selectionMode !== "column" || selectedColIndex === undefined) {
    return { visible: false };
  }

  const relC = selectedColIndex - colsOffset;
  if (relC < 0 || relC >= colWidths.length || relC >= dispHeaders.length) {
    return { visible: false };
  }

  let headerText = dispHeaders[relC] || "";
  if (!headerText) {
    return { visible: false };
  }

  if (sortColumnIndex !== undefined && sortColumnIndex === selectedColIndex && sortDirection) {
    headerText += sortDirection === "asc" ? " ▲" : " ▼";
  }

  const overlayPadding = 1;
  const dataOffset = gutterWidth + 2;
  const left =
    dataOffset +
    colWidths.slice(0, relC).reduce((a, b) => a + b, 0) +
    LEFT_PADDING -
    overlayPadding;
  const width = headerText.length + overlayPadding * 2;
  const top = 1; // On the blank line above headers

  return {
    visible: true,
    top,
    left,
    width,
    height: 1,
    headerText,
    padding: overlayPadding,
  };
}
