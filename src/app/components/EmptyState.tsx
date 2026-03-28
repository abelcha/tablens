/** @jsxImportSource @opentui/react */
import React from "react";
import { parseInlineMarkup } from "src/app/markup";

export function EmptyState({
  type,
  query,
}: {
  type: "loading" | "no-results" | "empty-file";
  query?: string;
}) {
  let title = "";
  let sub = "";
  let icon = "◌";
  let iconColor = "#444444";

  if (type === "no-results") {
    title = "No matches found";
    sub = query
      ? `No results for "{white}{bold}${query}{/bold}{/white}"`
      : "Search returned no results";
    icon = "∅";
    iconColor = "#FF8800";
  } else if (type === "empty-file") {
    title = "Empty file";
    sub = "This dataset contains {white}no rows{/white} of data";
    icon = "□";
    iconColor = "#FFFF00";
  }

  return (
    <box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      width="100%"
      height="100%"
    >
      <text content={parseInlineMarkup(` {bold}${icon}{/bold} `)} fg={iconColor} />
      {title && (
        <text content={parseInlineMarkup(` {bold}${title}{/bold} `)} fg="#ffffff" marginTop={1} />
      )}
      {sub && <text content={parseInlineMarkup(sub)} fg="#666666" marginTop={0} />}
      <text
        content={parseInlineMarkup(" Press ESC to clear search or Q to quit ")}
        fg="#444444"
        marginTop={2}
      />
    </box>
  );
}
