/** @jsxImportSource @opentui/react */
import { parseInlineMarkup } from "src/app/markup";
export function RenameBar({
  query,
  onInput,
  onSubmit,
  columnName,
  saving,
}: {
  query: string;
  onInput: (value: string) => void;
  onSubmit: (value: string) => void;
  columnName: string;
  saving?: boolean;
}) {
  const spinner = saving ? "{yellow}Saving...{/yellow}" : "";

  return (
    <box
      flexDirection="row"
      width="100%"
      height={1}
      backgroundColor="#1a1a1a"
    >
      <text content={parseInlineMarkup(`{grey}Rename column {/grey}{brightCyan}${columnName}{/brightCyan}{grey} to:{/grey} `)} />
      <input
        placeholder="new name"
        focused={true}
        value={query}
        onInput={onInput}
        onSubmit={onSubmit}
        style={{
          flexGrow: 1,
          focusedBackgroundColor: "#000000",
        }}
      />
      <text content={parseInlineMarkup(spinner)} />
      <text content={parseInlineMarkup("{grey} (Enter to save, Esc to cancel){/grey}")} />
    </box>
  );
}
