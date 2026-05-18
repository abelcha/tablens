/** @jsxImportSource @opentui/react */
import { parseInlineMarkup } from "src/app/markup";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))}${sizes[i]}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

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
  materializationInfo,
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
  materializationInfo?: { isMaterialized: boolean; skipped: boolean; fileSize: number; totalRows: number };
}) {
  const ramIndicator = sorting
    ? "{yellow} ● Sorting... {/yellow}"
    : isMaterialized
      ? "{green} ● RAM {/green}"
      : materializationInfo?.skipped
        ? `{grey} ○ streaming ${formatBytes(materializationInfo.fileSize)} / ${formatNumber(materializationInfo.totalRows)} rows{/grey}`
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
