/** @jsxImportSource @opentui/react */
import { parseInlineMarkup } from "src/app/markup";

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
  sorting = false,
  selectionMode = "row",
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
  sorting?: boolean;
  selectionMode?: string;
}) {
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
      <text content={parseInlineMarkup(sorting ? "{yellow} ● Building view... {/yellow}" : "{grey} ● Indexed {/grey}")} />
    </box>
  );
}
