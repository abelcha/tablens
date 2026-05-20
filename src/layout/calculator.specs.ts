import { describe, it, expect } from "bun:test";
import {
  computeColumnWidths,
  computeRowHeights,
  redistributeWidthsAfterClipping,
  MAX_COLUMN_WIDTH_FRACTION,
} from "../../src/layout/calculator";
import { NUM_SPACES_BETWEEN_COLUMNS } from "../../src/utils/text";

describe("Layout Calculator", () => {
  describe("computeColumnWidths", () => {
    it("should compute widths based on content + padding", () => {
      const headers = ["A"]; // len 1
      const rows = [["123"]]; // len 3
      // Max content len = 3 ("123")
      // Width = 3 + 4 = 7

      const widths = computeColumnWidths(headers, rows, 100);
      expect(widths).toEqual([7]);
    });

    it("should handle multi-line content correctly", () => {
      const headers = ["A"];
      const rows = [["1\n22"]]; // "22" is len 2
      // Max content len = 2
      // Width = 2 + 4 = 6

      const widths = computeColumnWidths(headers, rows, 100);
      expect(widths).toEqual([6]);
    });

    it("should use max sample length in fitCells mode", () => {
      const headers = ["A"];
      const short = "ab";
      const long = "x".repeat(20);
      const rows = Array.from({ length: 20 }, () => [short]).concat([[long]]);
      const defaultWidth = computeColumnWidths(headers, rows, 500);
      const fitWidth = computeColumnWidths(headers, rows, 500, {}, "fitCells");
      expect(fitWidth[0]!).toBeGreaterThan(defaultWidth[0]!);
      expect(fitWidth[0]!).toBe(20 + NUM_SPACES_BETWEEN_COLUMNS);
    });

    it("should include column header length in fitCellsAndHeaders mode", () => {
      const headers = ["VeryLongColumnHeader"];
      const rows = [["a"], ["b"]];
      const cellsOnly = computeColumnWidths(headers, rows, 500, {}, "fitCells");
      const withHeaders = computeColumnWidths(headers, rows, 500, {}, "fitCellsAndHeaders");
      expect(withHeaders[0]!).toBeGreaterThan(cellsOnly[0]!);
      expect(withHeaders[0]!).toBe(headers[0]!.length + NUM_SPACES_BETWEEN_COLUMNS);
    });

    it("should clip columns and redistribute available space", () => {
      const tableWidth = 60;
      const maxCol = Math.floor(tableWidth * 0.3); // 18

      const longStr = "a".repeat(50); // 50 chars. With padding: 54.
      const headers = ["A", "B"];
      const rows = [[longStr, longStr]];

      // Both want 54.
      // Both clipped to 18 initially. Total 36.
      // Remaining 60 - 36 - 1 (safety?) = ~23.
      // Redistribute ~11 each.
      // Final should be ~29-30. NOT 54.

      const widths = computeColumnWidths(headers, rows, tableWidth);

      expect(widths[0]!).toBeLessThan(54);
      expect(widths[1]!).toBeLessThan(54);
      expect(widths[0]!).toBeGreaterThan(18); // It should have grown
      expect(widths[0]! + widths[1]!).toBeLessThanOrEqual(tableWidth);
    });
  });

  describe("redistributeWidthsAfterClipping", () => {
    it("should redistribute extra space to clipped columns", () => {
      // Setup: 2 columns.
      // Col 1: small (width 10)
      // Col 2: huge (clipped to 30, wanted 100)
      // Table width: 100.
      // Total used: 10 + 30 = 40.
      // Remaining: 100 - 40 = 60.

      // Implementation automatically does this inside computeColumnWidths if we mock the internal state,
      // but let's test specific redistribution behavior via public API if possible or just rely on computeColumnWidths result.

      // Let's force it via computeColumnWidths with specific inputs
      const tableWidth = 100;
      const maxCol = 30;

      const headers = ["Small", "Big"];
      const rows = [["s", "b".repeat(90)]]; // wanted ~94, clipped to 30

      // Initial: [small_width, 30]
      // small_width = len("Small")=5, "s"=1. max=5. +4=9.
      // total = 9 + 30 = 39.
      // remaining = 100 - 39 - 1 = 60.
      // Clipped cols = [1].
      // Adjustment for col 1 = 60 / 1 = 60.
      // New width = min(94, 30 + 60) = 90.

      const widths = computeColumnWidths(headers, rows, tableWidth);

      expect(widths[0]).toBe(9);
      // It should have expanded significantly
      expect(widths[1]).toBeGreaterThan(30);
      // 30 (clipped) + 60 (available) = 90.
      // Original needed = 90 + 4 = 94.
      // It takes 90.
      expect(widths[1]).toBe(90);
    });
  });

  describe("computeRowHeights", () => {
    it("should return 1 for disabled wrap", () => {
      const rows = [["a\nb", "c"]];
      const widths = [10, 10];
      const heights = computeRowHeights(rows, widths, "disabled");
      expect(heights).toEqual([1]);
    });

    it("should calculate height based on wrapping", () => {
      const rows = [["a b"]];
      // width 10. usable 6. "a b" fits in 1 line? yes.
      // make it wrap: "a b c d e"
      const longRow = [["123456 789"]];
      const width = 6 + 4; // 10. usable 6.

      // "123456" len 6. " 789".
      // Word wrap:
      // "123456"
      // "789"
      // Height 2.

      const heights = computeRowHeights(longRow, [width], "words");
      expect(heights).toEqual([2]);
    });
  });
});
