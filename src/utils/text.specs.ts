import { describe, it, expect } from "bun:test";
import {
  wrapText,
  buildHeaderLine,
  buildSeparatorLine,
  buildRowLine,
  NUM_SPACES_BETWEEN_COLUMNS,
} from "../../src/utils/text";

describe("Text Utils", () => {
  describe("wrapText", () => {
    it("should return dot for negative or zero width", () => {
      expect(wrapText("hello", 0, true)).toEqual(["…"]);
      expect(wrapText("hello", -5, true)).toEqual(["…"]);
    });

    it("should return empty string for empty input", () => {
      expect(wrapText("", 10, true)).toEqual([""]);
      expect(wrapText(null as any, 10, true)).toEqual([""]);
    });

    it("should wrap words correctly", () => {
      const text = "hello world from bun";
      // width 5: "hello", "world", "from", "bun"
      expect(wrapText(text, 5, true)).toEqual(["hello", "world", "from", "bun"]);
    });

    it("should hard wrap long words if wordWrap is true", () => {
      const text = "helloworld";
      expect(wrapText(text, 5, true)).toEqual(["hello", "world"]);
    });

    it("should char wrap if wordWrap is false", () => {
      const text = "hello world";
      // width 5: "hello", " worl", "d" (spaces included in char wrap usually? let's check impl)
      // The impl: text.substring(i, min(len, i+width))
      // "hello world" -> 0..5="hello", 5..10=" worl", 10..11="d"
      expect(wrapText(text, 5, false)).toEqual(["hello", " worl", "d"]);
    });
  });

  describe("buildHeaderLine", () => {
    it("should build padded headers with bold tags", () => {
      const headers = ["ID", "Name"];
      const widths = [10, 10]; // 10 includes padding
      // usable = 10 - 4 = 6

      const line = buildHeaderLine(headers, widths);
      // "ID" length 2. pad = 10 - 2 = 8 spaces.
      // "Name" length 4. pad = 10 - 4 = 6 spaces.

      const expected = "{bold}ID{/bold}        {bold}Name{/bold}      \n";
      expect(line).toBe(expected);
    });

    it("should truncate long headers", () => {
      const headers = ["LongHeaderName"];
      // width 10. usable = 6.
      // "LongHeaderName" > 6. becomes "LongH…" (length 6 assuming … is 1 char, wait impl does substring 0, usable-1 + …)
      // "LongHe" -> "LongH" + "…" = "LongH…"
      const widths = [10];

      const line = buildHeaderLine(headers, widths);
      const expected = "{bold}LongH…{/bold}    \n"; // "LongH…" is 6 chars. pad 4.
      expect(line).toBe(expected);
    });
  });

  describe("buildSeparatorLine", () => {
    it("should build separator line", () => {
      const widths = [5, 5];
      const line = buildSeparatorLine(widths);
      expect(line).toBe("──────────\n");
    });
  });

  describe("buildRowLine", () => {
    it("should match wrapMode behavior", () => {
      const row = ["Hello World"];
      const widths = [10]; // usable 6

      // disabled: "Hello " ? no, "Hello World" truncated to 6 -> "Hello…"
      // impl: if disabled, text = cell. if len > usable, truncate.
      const lineDisabled = buildRowLine(row, widths, "disabled");
      expect(lineDisabled).toBe("Hello…    \n");

      // words: "Hello", "World"
      // lineIdx 0: "Hello"
      const lineWords0 = buildRowLine(row, widths, "words", 0);
      expect(lineWords0).toBe("Hello     \n");

      const lineWords1 = buildRowLine(row, widths, "words", 1);
      expect(lineWords1).toBe("World     \n");
    });
  });
});
