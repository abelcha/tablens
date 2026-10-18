/** @jsxImportSource @opentui/react */
import { forwardRef } from "react";
import type { StyledText } from "@opentui/core";

export const Inspector = forwardRef(function Inspector(
  { title, body, width, height, zoom }: { title: string; body: StyledText; width: number; height: number; zoom: boolean },
  ref: any,
) {
  const fitTitle = title.length > width - 6 ? title.slice(0, width - 7) + "…" : title;
  const hint = zoom ? "j/k scroll · y copy · o jless · V pane · Esc close" : "V zoom · o jless · v close";
  return (
    <box
      {...(zoom ? { position: "absolute", top: 0, left: 0, zIndex: 20 } : {})}
      width={width}
      height={height}
      borderStyle="single"
      borderColor={zoom ? "#EBC06D" : "#444444"}
      backgroundColor="#1a1a1a"
      title={` ${fitTitle} `}
      bottomTitle={` ${hint} `}
      bottomTitleAlignment="right"
      paddingLeft={1}
    >
      <scrollbox ref={ref} width="100%" height={height - 2}>
        <text content={body} wrapMode="none" />
      </scrollbox>
    </box>
  );
});
