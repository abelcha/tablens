import { wrapText } from "src/utils/text";

/** Plain display lines for an inspector value: wrapped prose for strings, pretty JSON otherwise. */
export function valueLines(value: unknown, width: number): string[] {
  if (typeof value === "string") return value.split("\n").flatMap((l) => wrapText(l, width, true));
  return JSON.stringify(value, null, 2).split("\n");
}

const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\]])|([^"{}[\]\d\w-]+|.)/g;

/** Colorize one line of pretty-printed JSON with inline markup tags. */
export function colorizeJsonLine(line: string): string {
  return line.replace(TOKEN, (_, str, colon, kw, num, bracket, other) => {
    const esc = (s: string) => s.replace(/\{/g, "\\{").replace(/\}/g, "\\}");
    if (str !== undefined) return colon ? `{jsonKey}${esc(str)}{/jsonKey}${colon}` : `{jsonString}${esc(str)}{/jsonString}`;
    if (kw !== undefined) return `{${kw === "null" ? "jsonNull" : "jsonBool"}}${kw}{/${kw === "null" ? "jsonNull" : "jsonBool"}}`;
    if (num !== undefined) return `{jsonNumber}${num}{/jsonNumber}`;
    if (bracket !== undefined) return `{jsonBracket}${esc(bracket)}{/jsonBracket}`;
    return esc(other);
  });
}
