/**
 * SQLite via Node's built-in node:sqlite (no dependency). One file: backend/data/mre.db (0600).
 * MRE_CASE_STORE=memory uses an in-memory database (tests). Upgrade path: Postgres when there is more than one
 * writer process or the file passes ~1 GB.
 */
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seal } from './seal';

let db: DatabaseSync | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, role TEXT NOT NULL CHECK (role IN ('analyst','reviewer','legal','admin')),
  pw_salt TEXT NOT NULL, pw_hash TEXT NOT NULL, created_at TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS revoked_tokens (token_hash TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_heads (case_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, hash TEXT NOT NULL, mac TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rules_state (id INTEGER PRIMARY KEY CHECK (id = 1), version TEXT NOT NULL, patch_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS passports (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), merchant_id TEXT NOT NULL, passport_json TEXT NOT NULL);
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
CREATE TABLE IF NOT EXISTS label_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL, detector TEXT NOT NULL, mcc TEXT NOT NULL,
  fired INTEGER NOT NULL, label TEXT NOT NULL, actor_id INTEGER, origin TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rules_proposals (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, created_by TEXT NOT NULL, status TEXT NOT NULL,
  approved_by TEXT, promoted_version TEXT, proposal_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rules_audit (
  seq INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, actor_id INTEGER,
  action TEXT NOT NULL, detail TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
`;

/** Runs once, on a database from before heads were sealed. Such a chain is trusted as it stands on that day. */
function sealExistingChains(d: DatabaseSync): void {
  const ins = d.prepare('INSERT INTO audit_heads (case_id, seq, hash, mac) VALUES (?, ?, ?, ?)');
  const heads = [
    ...d.prepare('SELECT case_id, seq, hash FROM audit a WHERE seq = (SELECT MAX(seq) FROM audit b WHERE b.case_id = a.case_id)').all(),
    ...d.prepare("SELECT '__rules__' AS case_id, seq, hash FROM rules_audit WHERE seq = (SELECT MAX(seq) FROM rules_audit)").all(),
  ] as { case_id: string; seq: number; hash: string }[];
  for (const h of heads) ins.run(h.case_id, h.seq, h.hash, seal(h.case_id, h.seq, h.hash));
}

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
  const sealed = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'audit_heads'").get();
  db.exec(SCHEMA);
  if (!sealed) sealExistingChains(db);
  // Accounts left by the removed persona feature are retired.
  db.exec(`UPDATE users SET disabled = 1 WHERE username IN ('demo-analyst', 'demo-reviewer', 'demo-legal', 'demo-admin')`);
  return db;
}

/** For tests: drop the in-memory database. */
export function resetDb(): void { db?.close(); db = null; }
