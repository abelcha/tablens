import type { WrapMode } from "../types";
import { bold } from "@opentui/core";

export const NUM_SPACES_BETWEEN_COLUMNS = 4;

export function wrapText(text: string, width: number, wordWrap: boolean): string[] {
  if (width <= 0) return ['…'];
  if (!text) return [''];

  const lines: string[] = [];
  if (wordWrap) {
    const words = text.split(/(\s+)/);
    let currentLine = '';
    for (const word of words) {
      if (!word) continue;

      // If adding this word exceeds width
      if (currentLine.length + word.length > width) {
        // Push current line if it has content
        if (currentLine.trim().length > 0) {
          lines.push(currentLine.trimEnd());
          currentLine = '';
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
  return lines.length > 0 ? lines : [''];
}

export function buildHeaderLine(headers: string[], widths: number[], gutterWidth: number = 0) {
  let line = '';
  if (gutterWidth > 0) {
    line += ' '.repeat(gutterWidth);
  }
  headers.forEach((h, i) => {
    const width = widths[i] || 0;
    const usableWidth = Math.max(0, width - NUM_SPACES_BETWEEN_COLUMNS);
    let text = h;
    if (text.length > usableWidth) text = text.substring(0, usableWidth - 1) + '…';
    const pad = ' '.repeat(Math.max(0, width - text.length));
    line += `{yellow}${text}{/yellow}` + pad;
  });
  return line + '\n';
}

export function buildSeparatorLine(widths: number[], gutterWidth: number = 0) {
  const gutter = gutterWidth > 0 ? '─'.repeat(gutterWidth) : '';
  return gutter + widths.map(w => '─'.repeat(w)).join('') + '\n';
}

export function buildRowLine(row: string[], widths: number[], wrapMode: WrapMode, lineIdx = 0, rowNumber?: number, gutterWidth: number = 0) {
  let line = '';

  if (gutterWidth > 0) {
    if (lineIdx === 0 && rowNumber !== undefined) {
      const numStr = String(rowNumber);
      const pad = ' '.repeat(Math.max(0, gutterWidth - numStr.length));
      line += `{gray}${numStr}{/gray}${pad}`;
    } else {
      line += ' '.repeat(gutterWidth);
    }
  }

  widths.forEach((width, colIdx) => {
    const cell = row[colIdx] || '';
    let text = '';
    const usableWidth = Math.max(0, width - NUM_SPACES_BETWEEN_COLUMNS);

    if (wrapMode === 'disabled') {
      text = lineIdx === 0 ? cell : '';
    } else {
      const wrapped = wrapText(cell, usableWidth, wrapMode === 'words');
      text = wrapped[lineIdx] || '';
    }

    if (text.length > usableWidth) text = text.substring(0, usableWidth - 1) + '…';

    const pad = ' '.repeat(Math.max(0, width - text.length));
    line += text + pad;
  });
  return line + '\n';
}
