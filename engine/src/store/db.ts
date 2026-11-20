// The only file that knows which SQLite library is used (phase 2a). Everything else in the store talks to `Db`. Today it is Node's built-in `node:sqlite`,
// which was run inside Electron 45.3.3 (Node 24.22, SQLite 3.54, FTS5 present): no native package to rebuild. If it ever has to change, only this file changes.
import { closeSync, existsSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export type Row = Record<string, unknown>;
export type Param = string | number | bigint | null | Uint8Array;
export interface Db {
  exec(sql: string): void;
  run(sql: string, ...params: Param[]): { changes: number; lastId: number };
  all<T = Row>(sql: string, ...params: Param[]): T[];
  get<T = Row>(sql: string, ...params: Param[]): T | undefined;
  transaction<T>(fn: () => T): T;     // all or nothing; a throw rolls back; not re-entrant (a nested call throws)
  version(): number;                  // the format version stamp (PRAGMA user_version)
  setVersion(v: number): void;
  integrity(): string[];              // problems found, empty when the file is sound
  compact(): void;                    // checkpoint the write-ahead log and rewrite the file without free space (after bulk deletes)
  close(): void;
}

export function openDb(file: string): Db {
  // The database file is created private to the user (0600) BEFORE SQLite creates it; SQLite gives its -wal and -shm files the same permissions.
  if (file !== ":memory:" && !existsSync(file)) closeSync(openSync(file, "a", 0o600));
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000; PRAGMA secure_delete = ON;"); // secure_delete: deleted rows are overwritten with zeros, so deleted ads and company names do not linger in the file (PRD 11)
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  let inTx = false;
  const own = (r: Row | undefined): Row | undefined => (r ? { ...r } : r); // plain objects, not null-prototype ones
  return {
    exec: (sql) => void db.exec(sql),
    run: (sql, ...p) => { const r = db.prepare(sql).run(...p); return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) }; },
    all: <T,>(sql: string, ...p: Param[]) => db.prepare(sql).all(...p).map((r) => ({ ...r })) as T[],
    get: <T,>(sql: string, ...p: Param[]) => own(db.prepare(sql).get(...p)) as T | undefined,
    transaction<T>(fn: () => T): T {
      if (inTx) throw new Error("nested transaction");
      inTx = true; db.exec("BEGIN IMMEDIATE");
      try { const r = fn(); db.exec("COMMIT"); return r; }
      catch (e) { try { db.exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
      finally { inTx = false; }
    },
    version: () => Number((db.prepare("PRAGMA user_version").get() as Row).user_version),
    setVersion: (v) => { if (!Number.isInteger(v) || v < 0) throw new Error("bad version"); db.exec(`PRAGMA user_version = ${v}`); },
    integrity: () => { try { return db.prepare("PRAGMA integrity_check").all().map((r) => String((r as Row).integrity_check)).filter((x) => x !== "ok"); } catch (e) { return [(e as Error).message]; } },
    compact: () => { if (file !== ":memory:") db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); db.exec("VACUUM;"); if (file !== ":memory:") db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); },
    close: () => db.close(),
  };
}
