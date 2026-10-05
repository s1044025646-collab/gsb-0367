import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

export const SCHEMA_VERSION = 1;

export interface RelationRow {
  id: number;
  experiment_id: number;
  seq: number;
  a: string;
  b: string;
  w: string;
  status: "accepted" | "redundant" | "rejected";
  detail: string; // JSON：差值、证据链等
  batch_id: string | null;
  created_at: string;
}

export class Store {
  db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS experiments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS symbols (
        experiment_id INTEGER NOT NULL REFERENCES experiments(id),
        name TEXT NOT NULL,
        ord INTEGER NOT NULL,
        PRIMARY KEY (experiment_id, name)
      );
      CREATE TABLE IF NOT EXISTS relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        experiment_id INTEGER NOT NULL REFERENCES experiments(id),
        seq INTEGER NOT NULL,
        a TEXT NOT NULL,
        b TEXT NOT NULL,
        w TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('accepted','redundant','rejected')),
        detail TEXT NOT NULL DEFAULT '{}',
        batch_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (experiment_id, seq)
      );
    `);
    this.db
      .prepare("INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', ?)")
      .run(String(SCHEMA_VERSION));
  }

  createExperiment(name: string): number {
    const r = this.db
      .prepare("INSERT INTO experiments(name, created_at) VALUES (?, ?)")
      .run(name, new Date().toISOString());
    return Number(r.lastInsertRowid);
  }

  addSymbol(expId: number, name: string, ord: number): void {
    this.db
      .prepare("INSERT OR IGNORE INTO symbols(experiment_id, name, ord) VALUES (?,?,?)")
      .run(expId, name, ord);
  }

  symbols(expId: number): { name: string; ord: number }[] {
    return this.db
      .prepare("SELECT name, ord FROM symbols WHERE experiment_id=? ORDER BY ord")
      .all(expId) as unknown as { name: string; ord: number }[];
  }

  nextSeq(expId: number): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq),0)+1 AS s FROM relations WHERE experiment_id=?")
      .get(expId) as unknown as { s: number };
    return row.s;
  }

  insertRelation(r: Omit<RelationRow, "id" | "created_at">): number {
    const res = this.db
      .prepare(
        `INSERT INTO relations(experiment_id, seq, a, b, w, status, detail, batch_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(r.experiment_id, r.seq, r.a, r.b, r.w, r.status, r.detail, r.batch_id, new Date().toISOString());
    return Number(res.lastInsertRowid);
  }

  relations(expId: number): RelationRow[] {
    return this.db
      .prepare("SELECT * FROM relations WHERE experiment_id=? ORDER BY seq")
      .all(expId) as unknown as RelationRow[];
  }

  experiments(): { id: number; name: string; created_at: string }[] {
    return this.db
      .prepare("SELECT * FROM experiments ORDER BY id")
      .all() as unknown as { id: number; name: string; created_at: string }[];
  }

  /** 事务包装：批量提交边界。回调抛错则整体回滚，不留半份状态。 */
  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  close(): void {
    this.db.close();
  }
}
