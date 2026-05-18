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

export function StatusLine({
  file,
  cursorRow,
  totalRowCount,
  cursorCol,
  numCols,
  searchQuery = "",
  searchUseRegex = false,
  searchWholeWord = false,
  searchCaseSensitive = false,
  searchMatchRowCount = null,
  searchError = null,
  isMaterialized = false,
  sorting = false,
  selectionMode = "row",
  materializationInfo,
}: {
  file: string;
  cursorRow: number;
  totalRowCount: number;
  cursorCol: number;
  numCols: number;
  searchQuery?: string;
  searchUseRegex?: boolean;
  searchWholeWord?: boolean;
  searchCaseSensitive?: boolean;
  searchMatchRowCount?: number | null;
  searchError?: string | null;
  isMaterialized?: boolean;
  sorting?: boolean;
  selectionMode?: string;
  materializationInfo?: { isMaterialized: boolean; skipped: boolean; fileSize: number; totalRows: number };
}) {
  const ramIndicator = sorting
    ? "{yellow} ● Sorting... {/yellow}"
    : isMaterialized
      ? "{green} ● RAM {/green}"
      : materializationInfo?.skipped
        ? `{grey} ○ streaming ${formatBytes(materializationInfo.fileSize)} / ${formatNumber(materializationInfo.totalRows)} rows{/grey}`
        : "{yellow} ○ initializing ... {/yellow}";

  // csvlens format: medium.csv [Row 1/10000, Col 1/20]
  const filterLabel =
    searchQuery.length > 0
      ? ` | Filter: /${searchQuery}/` +
        (searchUseRegex ? " (.*)" : "") +
        (searchWholeWord ? " (W)" : "") +
        (searchCaseSensitive ? " (Aa)" : "") +
        (searchMatchRowCount !== null ? ` [${searchMatchRowCount} rows]` : "")
      : "";
  const errorLabel = searchError ? ` | Error: ${searchError}` : "";
  const modeLabel = `{bold}[${selectionMode.toUpperCase()}]{/bold}`;
  const content = `${modeLabel} ${file} [Row ${cursorRow + 1}/${totalRowCount}, Col ${cursorCol + 1}/${numCols}]${filterLabel}${errorLabel}`;

  return (
    <box flexDirection="row" width="100%" height={1}>
      <text content={parseInlineMarkup(content)} left={0} style={{ flexGrow: 1 }} />
      <text content={parseInlineMarkup(ramIndicator)} />
    </box>
  );
}
