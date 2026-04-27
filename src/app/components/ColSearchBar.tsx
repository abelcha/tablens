/** @jsxImportSource @opentui/react */
import React from "react";
import { parseInlineMarkup } from "src/app/markup";

export function ColSearchBar({
  query,
  active,
  matchCount,
  totalCols,
  onInput,
  onSubmit,
}: {
  query: string;
  active: boolean;
  matchCount: number;
  totalCols: number;
  onInput: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  const countText = query.length > 0 ? ` {grey}(${matchCount}/${totalCols} cols){/grey}` : "";
  return (
    <box flexDirection="row" width="100%" height={1} backgroundColor={active ? "#1a1a1a" : "transparent"}>
      <text content={active ? " \\ " : parseInlineMarkup(" {grey} \\ {/grey}")} />
      <input
        placeholder="Filter columns"
        focused={active}
        value={query}
        onInput={onInput}
        onSubmit={onSubmit}
        style={{ flexGrow: 1, focusedBackgroundColor: "#000000" }}
      />
      <text content={parseInlineMarkup(countText)} />
    </box>
  );
}
