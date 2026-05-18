import { parseInlineMarkup } from "../markup";

export function ColumnFilterModal({
  columnName,
  data,
  cursor,
  selectedValues,
  searchActive,
  searchQuery,
  filteredCount,
  windowStart,
}: {
  columnName: string;
  data: Array<{value: string; count: number; percent: number}>;
  cursor: number;
  selectedValues: string[];
  searchActive: boolean;
  searchQuery: string;
  filteredCount: number;
  windowStart: number;
}) {
  const maxWidth = 88;
  const isEmpty = filteredCount === 0;
  const hasMoreAbove = windowStart > 0;
  const hasMoreBelow = windowStart + data.length < filteredCount;
  const hasMoreLabel = [
    hasMoreAbove ? `↑${windowStart}` : "",
    hasMoreBelow ? `↓${filteredCount - (windowStart + data.length)}` : "",
  ].filter(Boolean).join(" ");
  const footer = searchActive || searchQuery.length > 0
    ? ` / ${searchQuery}${searchActive ? "_" : ""} (Enter done, Esc close, r to reset)`
    : " ↑/k/↓/j navigate • Space toggle • / search • Enter apply • r to reset • Esc close";
  const searchLine = searchActive || searchQuery.length > 0
    ? ` Search: ${searchQuery}${searchActive ? "_" : ""}`
    : "";
  const title = isEmpty
    ? ` Column Values - ${columnName} (no matches) `
    : ` Column Values - ${columnName} (${filteredCount} match${filteredCount === 1 ? "" : "es"}${hasMoreLabel ? `, ${hasMoreLabel}` : ""}) `;

  const fit = (text: string) => {
    if (text.length > maxWidth - 2) return text.slice(0, maxWidth - 5) + "...";
    return text;
  };
  const row = (text: string) => `│${fit(text).padEnd(maxWidth - 2, " ")}│\n`;
  const footerRow = (text: string) => row(text);

  let content = `┌${"─".repeat(maxWidth - 2)}┐\n`;
  content += `│${title.padEnd(maxWidth - 2, " ")}│\n`;
  content += `├${"─".repeat(maxWidth - 2)}┤\n`;
  if (searchLine) {
    content += row(searchLine);
  }
  if (isEmpty) {
    content += row(" No values match the current search.");
    content += row(" Try clearing / or a broader search.");
  } else {
    data.forEach((item, i) => {
      const isSelected = i === cursor;
      const isToggled = selectedValues.includes(item.value);
      const pct = item.percent || 0;
      const percentStr = pct < 0.1 ? "<0.1" : pct.toFixed(1);
      const percentBar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(Math.max(0, 18 - Math.floor(pct / 5)));
      const val = item.value.length > 38 ? item.value.slice(0, 35) + "..." : item.value;
      const line = `${val.padEnd(38)} ${item.count.toString().padStart(7)}  ${percentStr.padStart(5)}% ${percentBar}`;
      const padded = fit(line).padEnd(maxWidth - 6, " ");
      const prefix = isSelected
        ? "{yellow}{underline}"
        : isToggled
          ? "{brightCyan}{bold}"
          : "";
      const suffix = isSelected
        ? "{/underline}{/yellow}"
        : isToggled
          ? "{/bold}{/brightCyan}"
          : "";
      const marker = isSelected ? "▶" : isToggled ? "☑" : "☐";
      content += `│${prefix}${marker} ${padded}${suffix}│\n`;
    });
  }

  content += `├${"─".repeat(maxWidth - 2)}┤\n`;
  content += footerRow(footer);
  if (!isEmpty && hasMoreLabel) {
    content += footerRow(` ${hasMoreLabel} more values`);
  }

  content += `└${"─".repeat(maxWidth - 2)}┘`;

  return (
    <box
      position="absolute"
      top={6}
      left={5}
      width={maxWidth}
      height={isEmpty ? 12 : Math.min(30, data.length + 10 + (hasMoreLabel ? 1 : 0) + (searchLine ? 1 : 0))}
      style={{
        borderStyle: "single" as any,
      }}
      backgroundColor="#1a1a1a"
      borderColor="#00ffaa"
    >
      <text
        content={parseInlineMarkup(content)}
        marginLeft={1}
        marginTop={0}
      />
    </box>
  );
}
