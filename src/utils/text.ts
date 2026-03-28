import type { WrapMode } from "src/types";

export const LEFT_PADDING = 1;
export const RIGHT_PADDING = 1;
export const NUM_SPACES_BETWEEN_COLUMNS = LEFT_PADDING + RIGHT_PADDING;

export function wrapText(text: string, width: number, wordWrap: boolean): string[] {
  if (width <= 0) return ["…"];
  if (!text) return [""];

  const lines: string[] = [];
  if (wordWrap) {
    const words = text.split(/(\s+)/);
    let currentLine = "";
    for (const word of words) {
      if (!word) continue;

      // If adding this word exceeds width
      if (currentLine.length + word.length > width) {
        // Push current line if it has content
        if (currentLine.trim().length > 0) {
          lines.push(currentLine.trimEnd());
          currentLine = "";
        }

        // Handle the word itself
        let w = word;
        // If it starts with spaces and we're at the beginning of a line, skip those spaces
        if (currentLine.length === 0) {
          w = word.trimStart();
        }

        if (w.length > width) {
          // Hard wrap the long word
          while (w.length > width) {
            lines.push(w.substring(0, width));
            w = w.substring(width);
          }
          currentLine = w;
        } else {
          currentLine = w;
        }
      } else {
        currentLine += word;
      }
    }
    if (currentLine.trim().length > 0) {
      lines.push(currentLine.trimEnd());
    }
  } else {
    for (let i = 0; i < text.length; i += width) {
      lines.push(text.substring(i, Math.min(text.length, i + width)));
    }
  }
  return lines.length > 0 ? lines : [""];
}

export function buildHeaderLine(
  headers: string[],
  widths: number[],
  gutterWidth: number = 0,
  selectedColIdx?: number,
  hideSelected: boolean = false,
) {
  let line = "";
  if (gutterWidth > 0) {
    line += " ".repeat(gutterWidth + 2); // Align with data columns (past "│ ")
  }
  headers.forEach((h, i) => {
    const width = widths[i] || 0;
    const usableWidth = Math.max(0, width - NUM_SPACES_BETWEEN_COLUMNS);
    const isSelected = selectedColIdx !== undefined && i === selectedColIdx;

    if (isSelected && hideSelected) {
      line += " ".repeat(width);
      return;
    }

    let text = h;
    if (h.length > usableWidth) {
      text = text.substring(0, usableWidth - 1) + "…";
    }
    const leftPad = " ".repeat(LEFT_PADDING);
    const rightPad = " ".repeat(Math.max(0, width - text.length - LEFT_PADDING));
    if (isSelected) {
      line += leftPad + `{orange}{bold}{underline}${text}{/underline}{/bold}{/orange}` + rightPad;
    } else {
      line += leftPad + `{orange}{bold}${text}{/bold}{/orange}` + rightPad;
    }
  });
  return line + "\n";
}

export function buildSeparatorLine(widths: number[], gutterWidth: number = 0, maxWidth?: number) {
  if (widths.length === 0) {
    const gutter = gutterWidth > 0 ? "─".repeat(gutterWidth) + "┬" : "";
    return `{blue}${gutter}{/blue}\n`;
  }
  const gutter = gutterWidth > 0 ? "─".repeat(gutterWidth) + "┬" : "";
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);
  // Constrain to maxWidth if provided to prevent exceeding terminal width
  const constrainedWidth =
    maxWidth !== undefined
      ? Math.max(0, Math.min(totalWidth, maxWidth - gutter.length))
      : totalWidth;
  const line = gutter + "─".repeat(Math.max(0, constrainedWidth));
  return `{blue}${line}{/blue}\n`;
}

export function buildBottomSeparatorLine(
  widths: number[],
  gutterWidth: number = 0,
  maxWidth?: number,
) {
  if (widths.length === 0) {
    const gutter = gutterWidth > 0 ? "─".repeat(gutterWidth) + "┴" : "";
    return `{blue}${gutter}{/blue}\n`;
  }
  const gutter = gutterWidth > 0 ? "─".repeat(gutterWidth) + "┴" : "";
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);
  // Constrain to maxWidth if provided to prevent exceeding terminal width
  const constrainedWidth =
    maxWidth !== undefined
      ? Math.max(0, Math.min(totalWidth, maxWidth - gutter.length))
      : totalWidth;
  const line = gutter + "─".repeat(Math.max(0, constrainedWidth));
  return `{blue}${line}{/blue}\n`;
}

export function buildRowLine(
  row: string[],
  widths: number[],
  wrapMode: WrapMode,
  lineIdx = 0,
  rowNumber?: number,
  gutterWidth: number = 0,
  matches?: boolean[],
) {
  let line = "";

  if (gutterWidth > 0) {
    if (lineIdx === 0 && rowNumber !== undefined) {
      const numStr = String(rowNumber);
      const pad = " ".repeat(Math.max(0, gutterWidth - numStr.length));
      line += `{blue}${numStr}{/blue}${pad}{blue}│{/blue} `;
    } else {
      line += " ".repeat(gutterWidth) + `{blue}│{/blue} `;
    }
  }

  widths.forEach((width, colIdx) => {
    const cell = row[colIdx] || "";
    let text = "";
    const usableWidth = Math.max(0, width - NUM_SPACES_BETWEEN_COLUMNS);

    if (wrapMode === "disabled") {
      text = lineIdx === 0 ? cell : "";
    } else {
      const wrapped = wrapText(cell, usableWidth, wrapMode === "words");
      text = wrapped[lineIdx] || "";
    }

    if (text.length > usableWidth) text = text.substring(0, usableWidth - 1) + "…";

    const leftPad = " ".repeat(LEFT_PADDING);
    const rightPad = " ".repeat(Math.max(0, width - text.length - LEFT_PADDING));
    const isMatch = Boolean(matches?.[colIdx]);
    if (isMatch) {
      line += leftPad + `{yellow}{underline}${text}{/underline}{/yellow}` + rightPad;
    } else {
      line += leftPad + `{lightgray}${text}{/lightgray}` + rightPad;
    }
  });
  return line + "\n";
}
