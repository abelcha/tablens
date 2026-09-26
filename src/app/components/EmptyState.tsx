/** @jsxImportSource @opentui/react */
import React from "react";
import { parseInlineMarkup } from "src/app/markup";
import { useRenderer } from "@opentui/react";

export function EmptyState({
  type,
  query,
  message,
  width,
  height,
}: {
  type: "loading" | "no-results" | "empty-file" | "error" | "no-columns";
  query?: string;
  message?: string;
  width?: number;
  height?: number;
}) {
  if (type === "loading") return <LoadingSkeleton width={width} height={height} />;

  let title = "";
  let sub = "";
  let footer = " Press ESC to clear search or Q to quit ";
  let icon = "◌";
  let iconColor = "#444444";

  if (type === "error") {
    title = "Failed to load";
    sub = message
      ? `{red}${message}{/red}`
      : "{red}An unknown error occurred{/red}";
    footer = " Press Q to quit · : to run a query ";
    icon = "✕";
    iconColor = "#FF4444";
  } else if (type === "no-results") {
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
  } else if (type === "no-columns") {
    title = "No visible columns";
    sub = "Open {white}{bold}I{/bold}{/white} to restore or show columns";
    footer = " Press I to manage columns · q to quit ";
    icon = "▤";
    iconColor = "#58A6FF";
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
      <text content={parseInlineMarkup(footer)} fg="#444444" marginTop={2} />
    </box>
  );
}

/** Keep loading visually anchored to the same table geometry as loaded data. */
export function LoadingSkeleton({ width: paneWidth, height: paneHeight }: { width?: number; height?: number }) {
  const renderer = useRenderer();
  const height = Math.max(8, paneHeight ?? renderer.terminalHeight - 2);
  const columns = ["12%", "15%", "14%", "22%", "37%"];
  const rowCount = Math.max(1, height - 5);

  return (
    <box
      width={paneWidth ?? "100%"}
      height="100%"
      flexDirection="column"
      border={true}
      borderStyle="single"
      borderColor="#454545"
    >
      <SkeletonRow columns={columns} header />
      <box width="100%" height={1} backgroundColor="#3a3a3a" />
      <box width="100%" flexGrow={1} flexDirection="column">
        {Array.from({ length: rowCount }, (_, row) => (
          <SkeletonRow key={row} columns={columns} row={row} />
        ))}
      </box>
      <box width="100%" height={1} backgroundColor="#3a3a3a" />
      <box width="100%" height={1} backgroundColor="#252525" />
    </box>
  );
}

function SkeletonRow({
  columns,
  header = false,
  row = 0,
}: {
  columns: string[];
  header?: boolean;
  row?: number;
}) {
  return (
    <box width="100%" height={1} flexDirection="row" backgroundColor={header ? "#292929" : undefined}>
      <box width="5%" height={1}>
      </box>
      {columns.map((width, index) => (
        <box key={index} width={width as any} height={1} />
      ))}
    </box>
  );
}
