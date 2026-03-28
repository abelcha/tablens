/** @jsxImportSource @opentui/react */
import React from "react";
import { parseInlineMarkup } from "src/app/markup";

export function SearchBar({
  query,
  onInput,
  onSubmit,
  useRegex,
  wholeWord,
  caseSensitive,
  matchRowCount,
  active,
  cursorRow,
  totalRowCount,
  cursorCol,
  numCols,
  loading,
  isMaterialized = false,
  sorting = false,
}: {
  query: string;
  onInput: (value: string) => void;
  onSubmit: (value: string) => void;
  useRegex: boolean;
  wholeWord: boolean;
  caseSensitive: boolean;
  matchRowCount: number | null;
  active: boolean;
  cursorRow: number;
  totalRowCount: number;
  cursorCol: number;
  numCols: number;
  loading?: boolean;
  isMaterialized?: boolean;
  sorting?: boolean;
}) {
  const ramIndicator = sorting
    ? "{yellow} ● Sorting... {/yellow}"
    : isMaterialized
      ? "{green} ● RAM {/green}"
      : "{yellow} ○ initializing ... {/yellow}";
  const countText =
    query.length === 0
      ? ""
      : matchRowCount === null
        ? " (…)"
        : ` (${matchRowCount} row${matchRowCount === 1 ? "" : "s"})`;

  const colorBadge = (label: string, shortcut: string, on: boolean, activeColor: string) => {
    const badge = on
      ? `{${activeColor}}{bold}[${label}]{/bold}{/${activeColor}}`
      : `{grey} ${label} {/grey}`;
    const key = on ? `{${activeColor}}${shortcut}{/${activeColor}}` : `{grey}${shortcut}{/grey}`;
    return `${badge} ${key}`;
  };

  const flagsMarkup = `${colorBadge(".*", "(Alt+R)", useRegex, "brightCyan")} ${colorBadge("W", "(Alt+W)", wholeWord, "brightYellow")} ${colorBadge("Aa", "(Alt+C)", caseSensitive, "brightMagenta")}${countText}`;

  const rowTarget = query.length > 0 && matchRowCount !== null ? matchRowCount : totalRowCount;
  const statusInfo = `{grey}[Row ${cursorRow + 1}/${rowTarget}, Col ${cursorCol + 1}/${numCols}]{/grey}`;

  // Spinner on the right with fixed width to prevent layout shifts
  const spinner = loading ? "{yellow}◉{/yellow}" : " ";

  return (
    <box
      flexDirection="row"
      width="100%"
      height={1}
      backgroundColor={active ? "#1a1a1a" : "transparent"}
    >
      <text content={parseInlineMarkup(statusInfo)} />
      <text content={active ? " / " : parseInlineMarkup(" {grey} / {/grey}")} />
      <input
        placeholder="Search"
        focused={active}
        value={query}
        onInput={onInput}
        onSubmit={onSubmit}
        style={{
          flexGrow: 1,
          focusedBackgroundColor: "#000000",
        }}
      />
      <text content={parseInlineMarkup(flagsMarkup)} />
      <text content={parseInlineMarkup(spinner)} width={1} />
      <text content={parseInlineMarkup(ramIndicator)} />
    </box>
  );
}
