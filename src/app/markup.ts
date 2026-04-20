import { StyledText, RGBA } from "@opentui/core";

// Helper to convert tag-based markup to OpenTUI StyledText
export function parseInlineMarkup(text: string): StyledText {
  const chunks: any[] = [];
  const stack: { attr: number; color?: string }[] = [];
  // Use placeholders for escaped braces so they don't interfere with tag parsing
  const OPEN_PLACEHOLDER = "\x00OPEN\x00";
  const CLOSE_PLACEHOLDER = "\x00CLOSE\x00";
  let remaining = text.replace(/\\\{/g, OPEN_PLACEHOLDER).replace(/\\\}/g, CLOSE_PLACEHOLDER);

  const themeColors: Record<string, string> = {
    yellow: "#EBC06D",
    orange: "#EBC06D",
    cyan: "#00AAAA",
    magenta: "#AA00AA",
    green: "#00AA00",
    white: "#ffffff",
    gray: "#888888",
    grey: "#888888",
    dim: "#666666",
    red: "#ff0000",
    blue: "#839496", // RGB(131, 148, 150) - csvlens row number color
    lightgray: "#c0c0c0", // RGB(192, 192, 192) - csvlens data text color
    // Explicitly vibrant versions for indicators
    brightCyan: "#00ffff",
    brightYellow: "#ffff00",
    brightMagenta: "#ff00ff",
    brightGreen: "#00ff00",
    mutedCyan: "#008888",
    mutedYellow: "#888800",
    mutedMagenta: "#880088",
    darkgray: "#666666",
    // JSON colorization colors (node.js-like)
    jsonKey: "#88C0D0",    // light blue for keys
    jsonString: "#A3BE8C", // green for string values
    jsonNumber: "#B48EAD", // purple for numbers
    jsonNumberConsole: "#EBC06D", // node console.log yellow for numbers
    jsonBool: "#D08770",   // orange for booleans
    jsonNull: "#888888",   // gray for null
    jsonBracket: "#ECEFF4", // white for brackets/braces
  };

  while (remaining.length > 0) {
    const nextTag = remaining.match(/\{(\/?)([^}]+)\}/);
    if (!nextTag) {
      chunks.push({
        __isChunk: true,
        text: remaining,
        attributes: stack[stack.length - 1]?.attr || 0,
        fg: stack[stack.length - 1]?.color
          ? RGBA.fromHex(stack[stack.length - 1]!.color!)
          : undefined,
      });
      break;
    }

    const [tagFull, isClosing, tagName] = nextTag;
    const tagIndex = nextTag.index!;

    if (tagIndex > 0) {
      chunks.push({
        __isChunk: true,
        text: remaining.substring(0, tagIndex),
        attributes: stack[stack.length - 1]?.attr || 0,
        fg: stack[stack.length - 1]?.color
          ? RGBA.fromHex(stack[stack.length - 1]!.color!)
          : undefined,
      });
    }

    if (isClosing) {
      stack.pop();
    } else {
      let attr = stack[stack.length - 1]?.attr || 0;
      let color = stack[stack.length - 1]?.color;

      if (tagName === "bold") attr |= 1 << 0;
      if (tagName === "underline") attr |= 1 << 3;
      if (themeColors[tagName]) color = themeColors[tagName];

      stack.push({ attr, color });
    }

    remaining = remaining.substring(tagIndex + tagFull.length);
  }

  // Convert placeholders back to actual braces in all chunk texts
  for (const chunk of chunks) {
    if (chunk.text) {
      chunk.text = chunk.text
        .replace(new RegExp(OPEN_PLACEHOLDER, "g"), "{")
        .replace(new RegExp(CLOSE_PLACEHOLDER, "g"), "}");
    }
  }

  return new StyledText(chunks);
}
