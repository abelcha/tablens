/** @jsxImportSource @opentui/react */
import React from "react";

export function StatusLine({
  file,
  cursorRow,
  totalRowCount,
  cursorCol,
  numCols,
  counter,
  gutterWidth,
}: {
  file: string;
  cursorRow: number;
  totalRowCount: number;
  cursorCol: number;
  numCols: number;
  counter: number;
  gutterWidth: number;
}) {
  // csvlens format: medium.csv [Row 1/10000, Col 1/20]
  const content = `${file} [Row ${cursorRow + 1}/${totalRowCount}, Col ${cursorCol + 1}/${numCols}]`;
  return <text content={content} left={0} />;
}
