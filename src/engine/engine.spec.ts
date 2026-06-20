import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { Engine } from "./Engine";

const TEST_CSV = "engine_test.csv";
const TEST_EXPORT = "engine_test_export.csv";
const TEST_MARKED_EXPORT = "engine_test_marked_export.csv";

describe("Engine", () => {
  beforeAll(() => {
    const rows = [
      "ID,Name,City,Status",
      "1,Alice,Paris,active",
      "2,Bob,Lyon,inactive",
      "3,Carol,Paris,active",
      "4,Dan,Marseille,inactive",
      "5,Eve,Paris,active",
    ];
    writeFileSync(TEST_CSV, `${rows.join("\n")}\n`);
  });

  afterAll(() => {
    for (const file of [TEST_CSV, TEST_EXPORT, TEST_MARKED_EXPORT]) {
      try {
        unlinkSync(file);
      } catch {
        // ignore
      }
    }
  });

  it("opens CSV input through a normalized parquet path", async () => {
    const engine = new Engine();
    const schema = await engine.open({ kind: "file", path: TEST_CSV });

    expect(schema.columns).toEqual(["ID", "Name", "City", "Status"]);
    expect(schema.totalRows).toBe(5);
    expect(schema.activeParquetPath.endsWith(".parquet")).toBe(true);

    const page = await engine.getPage({
      view: { sort: [], filter: {}, search: null },
      offset: 0,
      limit: 2,
      includeMatches: true,
    });

    expect(page.rowIds).toEqual([0, 1]);
    expect(page.rows[0]).toEqual(["1", "Alice", "Paris", "active"]);
    expect(page.rows[1]).toEqual(["2", "Bob", "Lyon", "inactive"]);
    expect(page.matches).toEqual([
      [false, false, false, false],
      [false, false, false, false],
    ]);

    await engine.close();
  });

  it("builds deterministic indexed views for sort, filter, and search", async () => {
    const engine = new Engine();
    await engine.open({ kind: "file", path: TEST_CSV });

    const sorted = await engine.buildView({
      sort: [{ column: "Name", direction: "desc" }],
      filter: {},
      search: null,
    });
    expect(sorted.totalRows).toBe(5);

    let page = await engine.getPage({
      view: {
        sort: [{ column: "Name", direction: "desc" }],
        filter: {},
        search: null,
      },
      offset: 0,
      limit: 1,
      includeMatches: false,
    });
    expect(page.rows[0]?.[1]).toBe("Eve");

    page = await engine.getPage({
      view: {
        sort: [],
        filter: { City: "Paris", Status: "active" },
        search: { query: "ali", useRegex: false, wholeWord: false, caseSensitive: false },
      },
      offset: 0,
      limit: 10,
      includeMatches: true,
    });

    expect(page.totalRows).toBe(1);
    expect(page.rows[0]).toEqual(["1", "Alice", "Paris", "active"]);
    expect(page.matches?.[0]).toEqual([false, true, false, false]);

    await engine.close();
  });

  it("exports the current view", async () => {
    const engine = new Engine();
    await engine.open({ kind: "file", path: TEST_CSV });
    await engine.exportView({
      view: {
        sort: [{ column: "ID", direction: "desc" }],
        filter: { Status: "active" },
        search: null,
      },
      outPath: TEST_EXPORT,
      format: "csv",
    });

    const exported = await engine.open({ kind: "file", path: TEST_EXPORT });
    expect(exported.totalRows).toBe(3);
    await engine.close();
  });

  it("exports only selected rows when row ids are provided", async () => {
    const engine = new Engine();
    await engine.open({ kind: "file", path: TEST_CSV });
    await engine.saveToFile(TEST_MARKED_EXPORT, [1, 4]);

    const exported = await engine.open({ kind: "file", path: TEST_MARKED_EXPORT });
    expect(exported.totalRows).toBe(2);
    const page = await engine.getPage({
      view: { sort: [], filter: {}, search: null },
      offset: 0,
      limit: 10,
      includeMatches: false,
    });
    expect(page.rows.map((row) => row[0])).toEqual(["2", "5"]);
    await engine.close();
  });
});
