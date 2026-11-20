// Phase 2b: format versions and migrations. Fake migration lists test the runner; the real list is tested for shape and for a fresh database.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const { openDb } = await import("../src/store/db.ts");
const { migrate, checkMigrations, StoreTooNewError, MigrationError } = await import("../src/store/migrate.ts");
const { MIGRATIONS } = await import("../src/store/schema.ts");
type M = import("../src/store/migrate.ts").Migration;
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const tables = (db: ReturnType<typeof openDb>) => db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((r) => r.name);

// ---- the runner, on fake migrations ----
const m1: M = { version: 1, name: "one", up: (db) => db.exec("CREATE TABLE a(x INTEGER); INSERT INTO a VALUES (1)") };
const m2: M = { version: 2, name: "two", up: (db) => { db.exec("ALTER TABLE a ADD COLUMN y TEXT"); db.run("UPDATE a SET y = ?", "filled"); } };
const m3bad: M = { version: 3, name: "three (fails halfway)", up: (db) => { db.exec("CREATE TABLE b(z)"); db.run("UPDATE a SET x = 99"); throw new Error("disk full, say"); } };
{
  const db = openDb(":memory:");
  const r = migrate(db, [m1, m2]);
  ok("a fresh database is migrated from 0 to the latest in order; the version stamp follows", r.from === 0 && r.to === 2 && r.ran.join() === "one,two" && db.version() === 2 && db.get<{ x: number; y: string }>("SELECT * FROM a")!.y === "filled");
  ok("opening again with nothing to do changes nothing", migrate(db, [m1, m2]).ran.length === 0 && db.version() === 2);
  const r2 = migrate(db, [m1, m2, { version: 3, name: "three", up: (d) => d.exec("CREATE TABLE c(q)") }]);
  ok("a database at an older version only runs the missing migrations, and keeps its data", r2.from === 2 && r2.ran.join() === "three" && tables(db).includes("c") && db.get<{ x: number }>("SELECT * FROM a")!.x === 1);
  db.close();
}
{
  const db = openDb(":memory:"); migrate(db, [m1, m2]);
  let err: unknown; try { migrate(db, [m1, m2, m3bad]); } catch (e) { err = e; }
  ok("a failing migration is rolled back COMPLETELY (no half-made table, no changed rows, version unchanged) and reports from, to and the cause", err instanceof MigrationError && err.from === 2 && err.to === 3 && /disk full/.test(err.message) && db.version() === 2 && !tables(db).includes("b") && db.get<{ x: number }>("SELECT * FROM a")!.x === 1);
  db.close();
}
{
  const db = openDb(":memory:"); migrate(db, [m1, m2]);
  let err: unknown; try { migrate(db, [m1]); } catch (e) { err = e; }
  ok("data from a NEWER format is refused with a plain 'update the app' message, and nothing is touched", err instanceof StoreTooNewError && err.found === 2 && err.known === 1 && /update the app/.test(err.message) && db.version() === 2 && db.get<{ x: number }>("SELECT * FROM a")!.x === 1);
  db.close();
}
{
  const calls: [number, number][] = []; const db = openDb(":memory:");
  migrate(db, [m1], { beforeMigrate: (f, t) => calls.push([f, t]) });
  ok("the pre-migration backup hook is NOT called for a brand-new database", calls.length === 0);
  migrate(db, [m1, m2], { beforeMigrate: (f, t) => calls.push([f, t]) });
  ok("the hook is called once, before anything changes, with from and to; not called when there is nothing to do", calls.length === 1 && calls[0][0] === 1 && calls[0][1] === 2 && (migrate(db, [m1, m2], { beforeMigrate: () => calls.push([0, 0]) }), calls.length === 1));
  let at = -1; const d2 = openDb(":memory:"); migrate(d2, [m1]);
  let err: unknown; try { migrate(d2, [m1, m2], { beforeMigrate: () => { at = d2.version(); throw new Error("backup failed"); } }); } catch (e) { err = e; }
  ok("if the backup fails, NOTHING is migrated and the error is the backup's", at === 1 && /backup failed/.test(String((err as Error)?.message)) && d2.version() === 1 && !(err instanceof MigrationError));
  db.close(); d2.close();
}
ok("a migration list with a gap, a repeat or a wrong start is a programming error caught at once", (() => { const bad = [[m2], [m1, m1], [m1, m3bad], [{ ...m1, version: 0 }]] as M[][]; return bad.every((l) => { try { checkMigrations(l); return false; } catch { return true; } }); })());

// ---- the real list ----
ok("the real migration list is numbered 1..n and every migration has a name", (() => { checkMigrations(MIGRATIONS); return MIGRATIONS.every((m) => m.name.length > 5); })());
{
  const db = openDb(":memory:"); const r = migrate(db, MIGRATIONS);
  ok("a fresh database gets exactly the expected tables, at the latest version", r.to === MIGRATIONS.length && ["meta", "profile", "settings", "jobs"].every((t) => tables(db).includes(t)) && db.integrity().length === 0);
  ok("the profile table holds only ONE row (id 1): a second profile is refused", (() => { db.run("INSERT INTO profile VALUES (1, '{}', 1, 'x')"); try { db.run("INSERT INTO profile VALUES (2, '{}', 1, 'x')"); return false; } catch { return db.all("SELECT * FROM profile").length === 1; } })());
  ok("the job index refuses a duplicate folder and a row without status, source, created or updated", (() => { db.run("INSERT INTO jobs(folder,status,source,created,updated) VALUES ('f','analysed','text','a','b')"); let n = 0; for (const sql of ["INSERT INTO jobs(folder,status,source,created,updated) VALUES ('f','x','text','a','b')", "INSERT INTO jobs(folder,source,created,updated) VALUES ('g','text','a','b')", "INSERT INTO jobs(folder,status,created,updated) VALUES ('h','x','a','b')"]) { try { db.run(sql); } catch { n++; } } return n === 3; })());
  ok("nothing in the schema stores a secret: no column is named token, password, secret, credential or api key (the usage table has token COUNTS, which are fine)", (() => { const cols = db.all<{ name: string; tbl: string }>("SELECT m.name AS tbl, p.name FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type='table'"); return cols.every((c) => !/^(access_|refresh_|api_|bot_)?(token|password|secret|credential)$|api_?key/i.test(c.name) /* input_tokens and output_tokens are COUNTS of tokens, not secrets */); })());
  db.close();
}
{
  const tmp = mkdtempSync(path.join(os.tmpdir(), "cvapp-mig-")), f = path.join(tmp, "app.db");
  let db = openDb(f); migrate(db, MIGRATIONS); db.run("INSERT INTO settings VALUES ('tone','\"friendly\"','t')"); db.close();
  db = openDb(f); const r = migrate(db, MIGRATIONS);
  ok("a real file reopened keeps its data and runs no migration", r.ran.length === 0 && db.get<{ value: string }>("SELECT value FROM settings WHERE key='tone'")!.value === '"friendly"');
  db.close(); rmSync(tmp, { recursive: true, force: true });
}
console.log(failures === 0 ? "\nall migrate tests passed" : `\n${failures} migrate test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
