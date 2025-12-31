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
  state: State;
  colWidths: number[];
  gutterWidth: number;
  dispHeaders: string[];
  colsOffset: number;
}): HeaderOverlay {
  const { state, colWidths, gutterWidth, dispHeaders, colsOffset } = args;
  const { selectionMode, cursorCol } = state;

  if (selectionMode !== "column" || cursorCol === undefined) {
    return { visible: false };
  }

  const relC = cursorCol - colsOffset;
  if (relC < 0 || relC >= colWidths.length || relC >= dispHeaders.length) {
    return { visible: false };
  }

  const headerText = dispHeaders[relC] || "";
  if (!headerText) {
    return { visible: false };
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
