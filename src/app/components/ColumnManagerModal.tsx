/** @jsxImportSource @opentui/react */
import { parseInlineMarkup } from "src/app/markup";

export function ColumnManagerModal({
  headers,
  columns,
  hiddenColumns,
  cursor,
  windowStart,
  stats,
  loading,
  termWidth,
  termHeight,
}: {
  headers: string[];
  columns: number[];
  hiddenColumns: Set<number>;
  cursor: number;
  windowStart: number;
  stats: string[];
  loading: boolean;
  termWidth: number;
  termHeight: number;
}) {
  const width = Math.max(104, Math.min(146, termWidth - 2));
  const height = Math.max(24, Math.min(40, termHeight - 2));
  const left = Math.max(1, Math.floor((termWidth - width) / 2));
  const top = Math.max(1, Math.floor((termHeight - height) / 2));
  const innerWidth = width - 2;
  const hasHidden = hiddenColumns.size > 0;
  const title = ` Columns (${headers.length} total${hasHidden ? `, ${hiddenColumns.size} hidden` : ""}) `;
  const footer = loading
    ? " Loading SUMMARIZE stats..."
    : " ↑/↓ cursor • Shift+↑/↓ reorder • Space hide/show • r reset • Enter/Esc/q close";
  const hasMoreAbove = windowStart > 0;
  const hasMoreBelow = windowStart + columns.length < headers.length;
  const hasMoreLabel = [
    hasMoreAbove ? `↑${windowStart}` : "",
    hasMoreBelow ? `↓${headers.length - (windowStart + columns.length)}` : "",
  ].filter(Boolean).join(" ");

  const fit = (text: string) => {
    if (text.length <= innerWidth - 2) return text;
    return `${text.slice(0, Math.max(0, innerWidth - 5))}...`;
  };

  let content = `┌${"─".repeat(innerWidth)}┐\n`;
  content += `│${title.padEnd(innerWidth, " ")}│\n`;
  content += `├${"─".repeat(innerWidth)}┤\n`;

  if (loading && stats.length === 0) {
    content += `│${fit(" Loading SUMMARIZE data...").padEnd(innerWidth, " ")}│\n`;
  } else if (columns.length === 0) {
    content += `│${fit(" No columns available.").padEnd(innerWidth, " ")}│\n`;
  } else {
    columns.forEach((columnIndex, i) => {
      const orderIndex = windowStart + i;
      const isSelected = i === cursor;
      const isHidden = hiddenColumns.has(columnIndex);
      const name = headers[columnIndex] || `Column ${columnIndex + 1}`;
      const summary = stats[columnIndex] || "";
      const summaryText = summary.length > 0 ? ` ${summary}` : "";
      const marker = isHidden ? "×" : " ";
      const prefix = isSelected
        ? "{yellow}{underline}"
        : isHidden
          ? "{darkgray}"
          : "";
      const suffix = isSelected
        ? "{/underline}{/yellow}"
        : isHidden
          ? "{/darkgray}"
          : "";
      const line = `${String(orderIndex + 1).padStart(2, "0")} [${marker}] ${name}${summaryText}`;
      content += `│${prefix}${fit(line).padEnd(innerWidth, " ")}${suffix}│\n`;
    });
  }

  content += `├${"─".repeat(innerWidth)}┤\n`;
  content += `│${fit(footer).padEnd(innerWidth, " ")}│\n`;
  if (!loading && hasMoreLabel) {
    content += `│${fit(` ${hasMoreLabel} more columns`).padEnd(innerWidth, " ")}│\n`;
  }
  content += `└${"─".repeat(innerWidth)}┘`;

  return (
    <box
      position="absolute"
      top={top}
      left={left}
      width={width}
      height={height}
      backgroundColor="#111827"
      border={true}
      borderStyle="single"
      borderColor="#60a5fa"
      zIndex={250}
    >
      <text content={parseInlineMarkup(content)} left={0} top={0} />
    </box>
  );
}
