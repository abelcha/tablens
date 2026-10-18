import type { QueryResult, SqlExecutor } from "src/engine/types";

export class ShimSqlExecutor implements SqlExecutor {
  private worker = new Worker(new URL("./shimWorker.ts", import.meta.url));
  private nextId = 0;
  private pending = new Map<number, { resolve: (r: QueryResult) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      this.pending.delete(data.id);
      if (data.error) p?.reject(new Error(data.error));
      else p?.resolve({ columns: data.columns, rows: data.rows });
    };
  }

  run(sql: string) {
    const id = ++this.nextId;
    return new Promise<QueryResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, sql });
    });
  }

  close() {
    this.worker.terminate();
  }
}
