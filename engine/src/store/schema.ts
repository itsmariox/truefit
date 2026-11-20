// The real migrations. NEVER edit a migration that has shipped: add a new one, with a migration test (tests/migrate.test.ts). Version 1 is the first format.
import type { Migration } from "./migrate.ts";

export const MIGRATIONS: Migration[] = [
  {
    version: 1, name: "first format: profile, settings, job index",
    up(db) {
      db.exec(`
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        -- The profile is ONE document (the structured Profile the engine validates). It is saved whole, so it is never half-written.
        CREATE TABLE profile (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL, profile_format INTEGER NOT NULL, updated_at TEXT NOT NULL);
        -- Settings: one row per key, value is JSON. Secrets (API key, Telegram token) are NEVER stored here: they live in the macOS Keychain.
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
        -- The job index: one row per job folder. The folder is the truth; this table only makes History fast and can be rebuilt from the folders.
        CREATE TABLE jobs (
          folder TEXT PRIMARY KEY,
          status TEXT NOT NULL, source TEXT NOT NULL, url TEXT,
          company TEXT, role TEXT, verdict TEXT, fit INTEGER,
          created TEXT NOT NULL, updated TEXT NOT NULL
        );
        CREATE INDEX jobs_updated ON jobs(updated);
        CREATE INDEX jobs_status ON jobs(status);
      `);
    },
  },
  {
    // Phase 2d: History needs a stable job id (the folder is renamed once the company and role are known) and search over company and role.
    version: 2, name: "job id and History search",
    up(db) {
      db.exec(`
        ALTER TABLE jobs ADD COLUMN id TEXT;
        CREATE UNIQUE INDEX jobs_id ON jobs(id) WHERE id IS NOT NULL;
        CREATE VIRTUAL TABLE jobs_fts USING fts5(company, role, folder UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
        INSERT INTO jobs_fts(company, role, folder) SELECT COALESCE(company, ''), COALESCE(role, ''), folder FROM jobs;
      `);
    },
  },
  {
    // Phase 2 review: deleting rows from an FTS5 table leaves the deleted words in the index (they are lowercased tokens) until its segments are merged; neither
    // PRAGMA secure_delete nor VACUUM reaches them. FTS5's own secure-delete option overwrites them, and `optimize` rewrites what an older database already left behind.
    version: 3, name: "search index secure delete",
    up(db) {
      db.exec(`
        INSERT INTO jobs_fts(jobs_fts, rank) VALUES ('secure-delete', 1);
        INSERT INTO jobs_fts(jobs_fts) VALUES ('optimize');
      `);
    },
  },
  {
    // Phase 3e: a durable record of every Claude call (cost, tokens, outcome) for the usage total and the optional monthly spend cap. It lives in the database, NOT in the job
    // folders, so deleting jobs or importing an export does not reset the total. It holds no ad, CV or profile text and no secret.
    version: 4, name: "usage ledger",
    up(db) {
      db.exec(`
        CREATE TABLE usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at TEXT NOT NULL,                    -- when the call finished (ISO time)
          job TEXT,                            -- the job folder name, for information only
          role TEXT NOT NULL,                  -- analyst, writer, checker, coach:verdict ...
          model TEXT,
          mode TEXT,                           -- subscription or apiKey (what the call was billed to)
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
          ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
          error_code INTEGER,                  -- the exit code of a failed call
          ms INTEGER
        );
        CREATE INDEX usage_at ON usage(at);
      `);
    },
  },
  {
    // Which AI service made each call, so Settings can show Claude and OpenAI use separately. Every call recorded before this existed was a Claude call (the only service there was).
    version: 5, name: "usage ledger: which service",
    up(db) { db.exec("ALTER TABLE usage ADD COLUMN provider TEXT; UPDATE usage SET provider = 'claude' WHERE provider IS NULL;"); },
  },
];
