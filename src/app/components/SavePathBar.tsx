/** @jsxImportSource @opentui/react */
import { parseInlineMarkup } from "src/app/markup";

export function SavePathBar({
  query,
  onInput,
  onSubmit,
  saving,
}: {
  query: string;
  onInput: (value: string) => void;
  onSubmit: (value: string) => void;
  saving?: boolean;
}) {
  const status = saving ? "{yellow}Saving...{/yellow}" : "";
  return (
    <box
      flexDirection="row"
      width="100%"
      height={1}
      backgroundColor="#1a1a1a"
    >
      <text content={parseInlineMarkup("{grey}Save to:{/grey} ")} />
      <input
        placeholder="/path/to/output.parquet"
        focused={true}
        value={query}
        onInput={onInput}
        onSubmit={onSubmit}
        style={{
          flexGrow: 1,
          focusedBackgroundColor: "#000000",
        }}
      />
      <text content={parseInlineMarkup(status)} />
      <text content={parseInlineMarkup("{grey} (Enter to save, Esc to cancel){/grey}")} />
    </box>
  );
}
