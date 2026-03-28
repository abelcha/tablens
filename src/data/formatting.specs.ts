import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { DuckDBDataSource } from "../../src/data/source";
import { writeFileSync, unlinkSync } from "fs";

const TEST_FMT_CSV = "test_fmt.csv";

describe("DuckDBDataSource SQL Formatting", () => {
  beforeAll(() => {
    // ID, Name
    // 1, Alice
    // 2, Bob
    const content = "ID,Name\n1,Alice\n2,Bob\n";
    writeFileSync(TEST_FMT_CSV, content);
  });

  afterAll(() => {
    try {
      unlinkSync(TEST_FMT_CSV);
    } catch { }
  });

  it("should pad columns if widths are provided", async () => {
    const source = new DuckDBDataSource();
    await source.connect(TEST_FMT_CSV);

    // Widths: ID=5, Name=10
    const widths = { ID: 5, Name: 10 };
    const rows = await source.getRows(0, 1, widths); // Fetch row 1

    // Expected: "1    ", "Alice     " (padded with spaces)
    // ID 1 is length 1. Padded to 5 means 4 spaces.
    // Name Alice is length 5. Padded to 10 means 5 spaces.

    expect(rows[0][0]).toBe("1    ");
    expect(rows[0][0].length).toBe(5);

    expect(rows[0][1]).toBe("Alice     ");
    expect(rows[0][1].length).toBe(10);

    await source.close();
  });

  it("should truncate columns if content exceeds width", async () => {
    const source = new DuckDBDataSource();
    await source.connect(TEST_FMT_CSV);

    // Widths: ID=5, Name=3 (Alice is 5 chars -> Ali)
    const widths = { ID: 5, Name: 3 };
    const rows = await source.getRows(0, 1, widths);

    expect(rows[0][1]).toBe("Ali");
    expect(rows[0][1].length).toBe(3);

    await source.close();
  });
});
