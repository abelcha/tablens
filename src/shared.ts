import fs from 'fs';

export interface StateData {
  headers: string[];
  rows: string[][];
}

export type WrapMode = 'chars' | 'words' | 'disabled';

export interface State {
  rowsOffset: number;
  colsOffset: number;
  cursorRow: number;
  cursorCol: number;
  numFreezeCols: number;
  markedRows: Set<number>;
  found: { row: number; col: number }[];
  sorter: any;
  wrapMode: WrapMode;
  columnOverrides: Record<number, number>;
  data: StateData;
}

export function loadCSV(filePath: string): Promise<StateData> {
  return new Promise((resolve, reject) => {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split(/\r\n|\r|\n/);
      if (lines.length === 0) {
        resolve({ headers: [], rows: [] });
        return;
      }
      
      const headers = lines[0].split(',').map(h => h.trim());
      const rows: string[][] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line) {
          rows.push(line.split(',').map(v => v.trim()));
        }
      }
      
      resolve({ headers, rows });
    } catch (err) {
      reject(err);
    }
  });
}

export const NUM_SPACES_BETWEEN_COLUMNS = 4;
export const MAX_COLUMN_WIDTH_FRACTION = 0.3;

export function computeColumnWidths(headers: string[], rows: string[][], tableWidth: number) {
  let columnWidths = headers.map(h => h.length);

  rows.forEach(row => {
    row.forEach((cell, i) => {
      if (i >= columnWidths.length) return;
      const lines = (cell || '').split('\n');
      lines.forEach(line => {
        const valueLen = line.length;
        if (columnWidths[i] < valueLen) {
          columnWidths[i] = valueLen;
        }
      });
    });
  });

  const maxSingleColumnWidth = Math.floor(tableWidth * MAX_COLUMN_WIDTH_FRACTION);
  const clippedColumns: [number, number][] = [];

  columnWidths = columnWidths.map((w, i) => {
    let newWidth = w + NUM_SPACES_BETWEEN_COLUMNS;
    if (newWidth > maxSingleColumnWidth) {
      clippedColumns.push([i, newWidth]);
      newWidth = maxSingleColumnWidth;
    }
    return newWidth;
  });

  redistributeWidthsAfterClipping(columnWidths, tableWidth, clippedColumns);

  return columnWidths;
}

export function redistributeWidthsAfterClipping(columnWidths: number[], areaWidth: number, clippedColumns: [number, number][]) {
  if (clippedColumns.length === 0) return;

  const totalWidth = columnWidths.reduce((a, b) => a + b, 0);
  if (totalWidth >= areaWidth) return;

  clippedColumns.sort((a, b) => a[1] - b[1]);

  let remainingWidth = Math.max(0, areaWidth - totalWidth - 1);
  let numColumnsToAdjust = clippedColumns.length;

  for (const [i, widthBeforeClipping] of clippedColumns) {
    const adjustment = Math.floor(remainingWidth / numColumnsToAdjust);
    const widthAfterAdjustment = Math.min(widthBeforeClipping, columnWidths[i] + adjustment);
    const addedWidth = widthAfterAdjustment - columnWidths[i];
    columnWidths[i] = widthAfterAdjustment;
    remainingWidth -= addedWidth;
    numColumnsToAdjust -= 1;
  }
}

export function computeRowHeights(rows: string[][], columnWidths: number[], wrapMode: WrapMode) {
  if (wrapMode === 'disabled') {
    return rows.map(() => 1);
  }

  return rows.map(row => {
    let height = 1;
    row.forEach((cell, i) => {
      const colWidth = columnWidths[i];
      if (colWidth === undefined) return;
      const width = colWidth - NUM_SPACES_BETWEEN_COLUMNS;
      const wrapped = wrapText(cell || '', width, wrapMode === 'words');
      height = Math.max(height, wrapped.length);
    });
    return height;
  });
}

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

export function buildHeaderLine(headers: string[], widths: number[]) {
  let line = '';
  headers.forEach((h, i) => {
    const width = widths[i];
    const usableWidth = width - NUM_SPACES_BETWEEN_COLUMNS;
    let text = h;
    if (text.length > usableWidth) text = text.substring(0, usableWidth - 1) + '…';
    const pad = ' '.repeat(Math.max(0, width - text.length));
    line += `{bold}${text}{/bold}` + pad;
  });
  return line + '\n';
}

export function buildSeparatorLine(widths: number[]) {
  return widths.map(w => '─'.repeat(w)).join('') + '\n';
}

export function buildRowLine(row: string[], widths: number[], wrapMode: WrapMode, lineIdx = 0) {
  let line = '';
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
