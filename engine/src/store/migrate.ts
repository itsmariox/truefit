// Format versions and migrations (phase 2b, PRD 15). The database carries a version number (PRAGMA user_version). Opening runs every pending migration, each in its
// own transaction together with the new version number, so a migration either completes fully or leaves the data exactly as it was. Data from a NEWER app is refused.
import type { Db } from "./db.ts";

export type Migration = { version: number; name: string; up: (db: Db) => void };

export class StoreTooNewError extends Error { found: number; known: number; constructor(found: number, known: number) { super(`this data was written by a newer version of the app (format ${found}, this app understands up to ${known}): update the app`); this.found = found; this.known = known; } }
export class MigrationError extends Error { from: number; to: number; constructor(from: number, to: number, cause: unknown) { super(`could not convert your data from format ${from} to ${to}: ${(cause as Error).message}`); this.from = from; this.to = to; this.cause = cause; } }

// A list must be 1, 2, 3, ... with no gap or repeat; a mistake here is a programming error and is caught at once.
export function checkMigrations(list: Migration[]): void {
  list.forEach((m, i) => { if (m.version !== i + 1) throw new Error(`migration list is broken: position ${i + 1} has version ${m.version}`); });
}
export const latestVersion = (list: Migration[]) => list.length;

export type MigrateOptions = {
  // Called once BEFORE anything changes, only when there is something to migrate and the database already holds data (version > 0). If it throws, nothing is migrated.
  beforeMigrate?: (from: number, to: number) => void;
};
export type MigrateResult = { from: number; to: number; ran: string[] };

export function migrate(db: Db, list: Migration[], o: MigrateOptions = {}): MigrateResult {
  checkMigrations(list);
  const from = db.version(), known = latestVersion(list);
  if (from > known) throw new StoreTooNewError(from, known);
  if (from === known) return { from, to: known, ran: [] };
  if (from > 0) o.beforeMigrate?.(from, known);
  const ran: string[] = [];
  for (const m of list.slice(from)) {
    try {
      db.transaction(() => { m.up(db); db.setVersion(m.version); });
    } catch (e) {
      throw new MigrationError(m.version - 1, known, e);
    }
    ran.push(m.name);
  }
  return { from, to: known, ran };
}
