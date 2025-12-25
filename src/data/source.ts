import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';

export class DuckDBDataSource {
  private instance: DuckDBInstance | null = null;
  private conn: DuckDBConnection | null = null;
  private tableName: string = 'data_table';
  private headers: string[] = [];
  private totalRows: number = 0;

  constructor() {}

  async connect(filePath: string) {
    this.instance = await DuckDBInstance.create();
    this.conn = await this.instance.connect();
    
    // Create a view or table from the file
    // Using read_csv_auto or read_parquet via direct query
    // We'll create a view so we can query it multiple times easily
    await this.conn.run(`CREATE OR REPLACE VIEW ${this.tableName} AS SELECT * FROM '${filePath}'`);
    
    // Get headers
    const result = await this.conn.run(`SELECT * FROM ${this.tableName} LIMIT 0`);
    this.headers = result.columnNames();
    
    // Get total rows
    const countResult = await this.conn.run(`SELECT COUNT(*) as count FROM ${this.tableName}`);
    const countRows = await countResult.getRows();
    // DuckDB returns BigInt for count usually, cast to string or number
    const countVal = countRows[0] ? countRows[0][0] : 0;
    this.totalRows = Number(countVal);
  }

  getHeaders(): string[] {
    return this.headers;
  }

  getTotalRows(): number {
    return this.totalRows;
  }

  async getRows(offset: number, limit: number): Promise<string[][]> {
    if (!this.conn) throw new Error("Not connected");
    
    const result = await this.conn.run(`SELECT * FROM ${this.tableName} LIMIT ${limit} OFFSET ${offset}`);
    const rows = await result.getRows();
    
    const stringRows: string[][] = [];
    // columnNames from this result should match headers, but safer to use known headers order if possible,
    // or just iterate index-based since SELECT * preserves order from VIEW
    
    for (const row of rows) {
      const stringRow: string[] = [];
      for (let i = 0; i < this.headers.length; i++) {
        const val = row[i];
         if (val === null || val === undefined) {
          stringRow.push("");
        } else {
          stringRow.push(String(val));
        }
      }
      stringRows.push(stringRow);
    }
    return stringRows;
  }

  async close() {
    // node-api might not have explicit close for instance yet, but good to have the method placeholder
    this.conn = null;
    this.instance = null;
  }
}
