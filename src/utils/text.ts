import type { WrapMode } from "src/types";

export const LEFT_PADDING = 1;

// Escape curly braces so they're not interpreted as markup tags
function escapeMarkup(text: string): string {
  return text.replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}
// Colorize an object/array string with markup tags for display.
// Format: {key: "val", num: 1, b: true, n: null, a: [1, 2]}
// Keys are unquoted identifiers before `:`.
function colorizeJson(text: string): string {
  if (text.length === 0) return text;
  const first = text[0];
  if (first !== "{" && first !== "[") return escapeMarkup(text);

  let out = "";
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === "{" || ch === "}" || ch === "[" || ch === "]") {
      out += `{jsonBracket}${escapeMarkup(ch)}{/jsonBracket}`;
      i++;
    } else if (ch === '"') {
      // String value
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\") j++;
        j++;
      }
      const str = text.substring(i, j + 1);
      out += `{jsonString}${escapeMarkup(str)}{/jsonString}`;
      i = j + 1;
    } else if (ch === ":" || ch === " " || ch === ",") {
      out += ch;
      i++;
    } else if (text.substring(i, i + 4) === "null") {
      out += `{jsonNull}null{/jsonNull}`;
      i += 4;
    } else if (text.substring(i, i + 4) === "true") {
      out += `{jsonBool}true{/jsonBool}`;
      i += 4;
    } else if (text.substring(i, i + 5) === "false") {
      out += `{jsonBool}false{/jsonBool}`;
      i += 5;
    } else if ((ch >= "0" && ch <= "9") || ch === "-") {
      let j = i + 1;
      while (j < text.length && ((text[j] >= "0" && text[j] <= "9") || text[j] === "." || text[j] === "e" || text[j] === "E" || text[j] === "+" || text[j] === "-")) j++;
      out += `{jsonNumber}${text.substring(i, j)}{/jsonNumber}`;
      i = j;
    } else if (/[a-zA-Z_]/.test(ch)) {
      // Unquoted key or bare word — read identifier chars
      let j = i + 1;
      while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) j++;
      const word = text.substring(i, j);
      // Check if followed by `:` → it's a key
      if (j < text.length && text[j] === ":") {
        out += `{jsonKey}${escapeMarkup(word)}{/jsonKey}`;
      } else {
        out += `{lightgray}${escapeMarkup(word)}{/lightgray}`;
      }
      i = j;
    } else {
      out += escapeMarkup(ch);
      i++;
    }
  }
  return out;
}

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
  compact: boolean = false,
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

    let text = compact ? h.replace(/\s+/g, " ") : h;
    if (text.length > usableWidth) {
      text = text.substring(0, usableWidth - 1) + "…";
    }
    const leftPad = " ".repeat(LEFT_PADDING);
    const rightPad = " ".repeat(Math.max(0, width - text.length - LEFT_PADDING));
    const escaped = escapeMarkup(text);
    if (isSelected) {
      line += leftPad + `{orange}{bold}{underline}${escaped}{/underline}{/bold}{/orange}` + rightPad;
    } else {
      line += leftPad + `{orange}{bold}${escaped}{/bold}{/orange}` + rightPad;
    }
  });
  return line + "\n";
}

export function buildTypeLine(
  types: string[],
  widths: number[],
  gutterWidth: number = 0,
) {
  let line = "";
  if (gutterWidth > 0) {
    line += " ".repeat(gutterWidth + 2);
  }
  types.forEach((t, i) => {
    const width = widths[i] || 0;
    const usableWidth = Math.max(0, width - NUM_SPACES_BETWEEN_COLUMNS);
    let text = t;
    if (t.length > usableWidth) {
      text = text.substring(0, usableWidth - 1) + "…";
    }
    const leftPad = " ".repeat(LEFT_PADDING);
    const rightPad = " ".repeat(Math.max(0, width - text.length - LEFT_PADDING));
    const escaped = escapeMarkup(text);
    line += leftPad + `{darkgray}${escaped}{/darkgray}` + rightPad;
  });
  return line + "\n";
}

export function buildStatsLine(
  stats: string[],
  widths: number[],
  gutterWidth: number = 0,
) {
  let line = "";
  if (gutterWidth > 0) {
    line += " ".repeat(gutterWidth + 2);
  }
  stats.forEach((s, i) => {
    const width = widths[i] || 0;
    const usableWidth = Math.max(0, width - NUM_SPACES_BETWEEN_COLUMNS);
    // Split into distinct part and null part
    const nullIdx = s.indexOf(" ∅");
    const distinctPart = nullIdx >= 0 ? s.substring(0, nullIdx) : s;
    const nullPart = nullIdx >= 0 ? s.substring(nullIdx + 1) : "";

    if (usableWidth <= 0) {
      line += " ".repeat(width);
      return;
    }

    let leftText = distinctPart;
    let rightText = nullPart;

    // Truncate if needed
    if (leftText.length + (rightText.length ? 1 + rightText.length : 0) > usableWidth) {
      if (rightText && usableWidth > rightText.length + 2) {
        leftText = leftText.substring(0, usableWidth - rightText.length - 2) + "…";
      } else {
        leftText = leftText.substring(0, usableWidth - 1) + "…";
        rightText = "";
      }
    }

    const gap = Math.max(rightText ? 1 : 0, usableWidth - leftText.length - rightText.length);
    const leftPad = " ".repeat(LEFT_PADDING);
    const cellContent = `{mutedCyan}${escapeMarkup(leftText)}{/mutedCyan}` +
      " ".repeat(gap) +
      (rightText ? `{mutedYellow}${escapeMarkup(rightText)}{/mutedYellow}` : "");
    const totalLen = leftText.length + gap + rightText.length;
    const rightPad = " ".repeat(Math.max(0, width - totalLen - LEFT_PADDING));
    line += leftPad + cellContent + rightPad;
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
    const isJson = text.length > 0 && (text[0] === "{" || text[0] === "[");
    const isNumeric = text.length > 0 && /^-?\d+(\.\d+)?$/.test(text);
    if (isMatch) {
      line += leftPad + `{yellow}{underline}${escapeMarkup(text)}{/underline}{/yellow}` + rightPad;
    } else if (isJson) {
      line += leftPad + colorizeJson(text) + rightPad;
    } else if (isNumeric) {
      line += leftPad + `{jsonNumberConsole}${escapeMarkup(text)}{/jsonNumberConsole}` + rightPad;
    } else {
      line += leftPad + `{lightgray}${escapeMarkup(text)}{/lightgray}` + rightPad;
    }
  });
  return line + "\n";
}
