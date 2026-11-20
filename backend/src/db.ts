/**
 * SQLite via Node's built-in node:sqlite (no dependency). One file: backend/data/mre.db (0600).
 * MRE_CASE_STORE=memory uses an in-memory database (tests). Upgrade path: Postgres when there is more than one
 * writer process or the file passes ~1 GB.
 */
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let db: DatabaseSync | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, role TEXT NOT NULL CHECK (role IN ('analyst','reviewer','legal','admin')),
  pw_salt TEXT NOT NULL, pw_hash TEXT NOT NULL, created_at TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, created_by INTEGER REFERENCES users(id), engine_version TEXT, rules_version TEXT,
  dataset_sha256 TEXT NOT NULL, record_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  case_id TEXT NOT NULL REFERENCES cases(id), seq INTEGER NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, actor_id INTEGER,
  action TEXT NOT NULL, detail TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (case_id, seq));
CREATE TABLE IF NOT EXISTS llm_cache (key TEXT PRIMARY KEY, created_at TEXT NOT NULL, model TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS service_keys (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT UNIQUE NOT NULL, scopes TEXT NOT NULL,
  created_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY, body_sha256 TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, case_id TEXT NOT NULL, url TEXT NOT NULL,
  ok INTEGER NOT NULL, attempts INTEGER NOT NULL, at TEXT NOT NULL);
`;

export function getDb(): DatabaseSync {
  if (db) return db;
  if (process.env.MRE_CASE_STORE === 'memory') db = new DatabaseSync(':memory:');
  else {
    const file = process.env.MRE_DB_FILE ?? (process.env.VERCEL ? '/tmp/mre.db' : join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'mre.db'));
    mkdirSync(dirname(file), { recursive: true });
    const fresh = !existsSync(file);
    db = new DatabaseSync(file);
    if (fresh) chmodSync(file, 0o600);
  }
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

/** For tests: drop the in-memory database. */
export function resetDb(): void { db?.close(); db = null; }
