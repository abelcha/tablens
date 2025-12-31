import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { DuckDBDataSource } from "./source";
import { writeFileSync, unlinkSync } from "fs";

const TEST_CSV = "test_lazy.csv";

describe("DuckDBDataSource", () => {
  beforeAll(() => {
    // Create a dummy CSV with 10 rows
    // ID, Name
    // 1, A
    // ...
    let content = "ID,Name\n";
    for (let i = 0; i < 10; i++) {
      content += `${i},Name${i}\n`;
    }
    writeFileSync(TEST_CSV, content);
  });

  afterAll(() => {
    unlinkSync(TEST_CSV);
  });

  it("should connect and get metadata", async () => {
    const source = new DuckDBDataSource();
    await source.connect({ filePath: TEST_CSV });

    expect(source.getHeaders()).toEqual(["ID", "Name"]);
    expect(source.getTotalRows()).toBe(10);

    await source.close();
  });

  it("should lazy load rows with limit offset", async () => {
    const source = new DuckDBDataSource();
    await source.connect({ filePath: TEST_CSV });

    // Fetch rows 5-7 (3 rows)
    const rows = await source.getRows(5, 3);

    // Rows index 5 => ID 5.
    // Expected: [["5", "Name5"], ["6", "Name6"], ["7", "Name7"]]
    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual(["5", "Name5"]);
    expect(rows[2]).toEqual(["7", "Name7"]);

    await source.close();
  });

  it("should handle out of bounds gracefully", async () => {
    const source = new DuckDBDataSource();
    await source.connect({ filePath: TEST_CSV });

    // Offset 9, limit 5. Should return 1 row (ID 9).
    const rows = await source.getRows(9, 5);
    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual(["9", "Name9"]);

    await source.close();
  });
});
