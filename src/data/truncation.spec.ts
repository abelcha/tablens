import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { DuckDBDataSource } from "./source";
import { writeFileSync, unlinkSync } from "fs";

const TEST_LONG_CSV = "test_long.csv";

describe("DuckDBDataSource Truncation", () => {
  beforeAll(() => {
    // Create a dummy CSV with 1 row but a huge column
    const huge = "A".repeat(1000);
    const content = `ID,Data\n1,${huge}\n`;
    writeFileSync(TEST_LONG_CSV, content);
  });

  afterAll(() => {
    unlinkSync(TEST_LONG_CSV);
  });

  it("should truncate long columns to 256 chars", async () => {
    const source = new DuckDBDataSource();
    await source.connect(TEST_LONG_CSV);

    const rows = await source.getRows(0, 1);
    const dataCol = rows[0][1];

    expect(dataCol.length).toBe(256);
    expect(dataCol).toBe("A".repeat(256));

    await source.close();
  });
});
