import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  phase INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS research_cache (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS geocode_cache (
  query TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

declare global {
  var __tripDb: Database.Database | undefined;
}

export function openDb(file?: string): Database.Database {
  const target =
    file ?? path.join(process.env.DATA_DIR ?? path.join(process.cwd(), "data"), "app.db");
  if (target !== ":memory:") fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new Database(target);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

/** Process-wide connection; survives Next dev hot reloads. */
export function db(): Database.Database {
  globalThis.__tripDb ??= openDb();
  return globalThis.__tripDb;
}

/** Test hook: swap in a fresh (usually in-memory) database. */
export function setDbForTests(d: Database.Database) {
  globalThis.__tripDb = d;
}
