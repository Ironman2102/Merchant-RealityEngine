/**
 * Tamper evidence for the database.
 *  - Every security-relevant row has an HMAC under the server key, so an edit or an insert shows.
 *  - For tables where a deletion matters, a manifest of their seals is sealed too, so a deletion shows.
 *  - A write checks the old state first, so it can never re-seal what someone else changed.
 *  - Nothing seals an existing database by itself. An operator does that once, for an upgrade (`mre seal-db`).
 * Not covered: someone who holds the server key, an older copy of the whole database put back (keep `mre verify-db`'s
 * checkpoint outside the machine to notice that), revoked-token deletion or a signed-out session put back, delivery logs, and the workflow and rules files.
 * ponytail: a write re-hashes that table's seals, O(rows). Use a Merkle tree past some tens of thousands of cases.
 */
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getDb } from './db';
import { seal } from './seal';

interface Spec { key: string; group?: string; columns?: string; listed: boolean }
const TABLES = {
  cases: { key: 'id', group: 'merchant_key', listed: true, columns: 'id, created_at, created_by, engine_version, rules_version, dataset_sha256, record_sha, merchant_key, in_force_json, decision, label, follow_up' },
  audit_heads: { key: 'case_id', listed: true },
  passports: { key: 'id', group: 'merchant_id', listed: true },
  rules_state: { key: 'id', listed: true },
  rules_rollback: { key: 'id', listed: true },
  rules_proposals: { key: 'id', listed: true },
  label_events: { key: 'case_id', listed: true },
  users: { key: 'id', listed: true },
  service_keys: { key: 'id', listed: true },
  sessions: { key: 'token_hash', listed: false },
  idempotency: { key: 'key', listed: false },
} satisfies Record<string, Spec>;
export type Table = keyof typeof TABLES;
const NAMES = Object.keys(TABLES) as Table[];
const spec = (t: Table): Spec => TABLES[t];

export class IntegrityError extends Error {
  status = 409;
  constructor(what: string) { super(`Tamper check failed: ${what}. Nothing was changed. An operator should run "mre verify-db".`); }
}
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');

/* ---------- transactions and a per-change cache ---------- */
const depth = new WeakMap<DatabaseSync, number>();
const memo = new WeakMap<DatabaseSync, { stamp: string; seen: Map<string, unknown> }>();

/** All or nothing. Nests. Synchronous only. */
export function atomic<T>(fn: () => T): T {
  const db = getDb(), n = depth.get(db) ?? 0;
  db.exec(n ? `SAVEPOINT s${n}` : 'BEGIN IMMEDIATE');
  depth.set(db, n + 1);
  try {
    const out = fn();
    db.exec(n ? `RELEASE s${n}` : 'COMMIT');
    return out;
  } catch (e) {
    db.exec(n ? `ROLLBACK TO s${n}; RELEASE s${n}` : 'ROLLBACK');
    memo.delete(db);
    throw e;
  } finally { depth.set(db, n); }
}

/** A successful check holds until this or any other connection changes the database. */
function cached<T>(name: string, fn: () => T): T {
  const db = getDb();
  const own = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  const other = (db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
  let m = memo.get(db);
  if (m?.stamp !== `${own}:${other}`) { m = { stamp: `${own}:${other}`, seen: new Map() }; memo.set(db, m); }
  if (m.seen.has(name)) return m.seen.get(name) as T;
  const out = fn();
  m.seen.set(name, out);
  return out;
}

/* ---------- rows ---------- */
const sealedRow = (t: Table, key: string) => getDb().prepare('SELECT grp, mac FROM row_seals WHERE tbl = ? AND key = ?').get(t, key) as { grp: string; mac: string } | undefined;

function rowState(t: Table, key: string): { grp: string; mac: string } | null {
  const s = spec(t);
  const rows = getDb().prepare(`SELECT ${s.columns ?? '*'} FROM ${t} WHERE ${s.key} = ?${t === 'label_events' ? ' ORDER BY id' : ''}`).all(key) as Record<string, unknown>[];
  if (!rows.length) return null;
  const grp = s.group ? String(rows[0][s.group] ?? '') : '';
  // Empty columns are left out, so adding a column does not break every seal.
  const body = rows.map(r => Object.keys(r).sort().filter(k => r[k] !== null).map(k => [k, r[k]]));
  return { grp, mac: seal(`row:${t}:${key}`, rows.length, digest(JSON.stringify([grp, body]))) };
}

/** A trigger or view could change a row between the write and its seal. The schema has neither, so any is tampering. */
function assertPlainSchema(): void {
  if (getDb().prepare("SELECT 1 FROM sqlite_master WHERE type IN ('trigger', 'view') LIMIT 1").get()) throw new IntegrityError('the database schema has a trigger or view that the server did not create');
}

/**
 * For access decisions: the row is as it was written, and is the current one. The manifest matters here, because an old
 * row put back with its old seal (a revoked key, a former role) is valid by itself.
 */
export function rowTrusted(t: Table, key: string | number): boolean {
  try {
    assertPlainSchema();
    assertTable(t);
    return rowValid(t, key);
  } catch (e) {
    if (e instanceof IntegrityError) return false;
    throw e;
  }
}

/** True for a row that is as it was written, and for a key that has neither row nor seal. */
export function rowValid(t: Table, key: string | number): boolean {
  const now = rowState(t, String(key)), was = sealedRow(t, String(key));
  return now ? !!was && was.mac === now.mac && was.grp === now.grp : !was;
}
export function assertRow(t: Table, key: string | number): void {
  assertTable(t);
  if (!rowValid(t, key)) throw new IntegrityError(`a row in ${t} is not as it was written`);
}

/* ---------- tables ---------- */
const sealKeys = (t: Table, grp?: string) => (grp === undefined
  ? getDb().prepare('SELECT key FROM row_seals WHERE tbl = ?').all(t)
  : getDb().prepare('SELECT key FROM row_seals WHERE tbl = ? AND grp = ?').all(t, grp)) as { key: string }[];

function rowKeys(t: Table, grp?: string): string[] {
  const s = spec(t);
  const rows = (grp === undefined
    ? getDb().prepare(`SELECT DISTINCT ${s.key} AS k FROM ${t}`).all()
    : getDb().prepare(`SELECT DISTINCT ${s.key} AS k FROM ${t} WHERE ${s.group} = ?`).all(grp)) as { k: unknown }[];
  return rows.map(r => String(r.k)).sort();
}

const tableDigest = (t: Table) => digest(JSON.stringify(getDb().prepare('SELECT key, grp, mac FROM row_seals WHERE tbl = ? ORDER BY key').all(t)));
const manifests = () => getDb().prepare('SELECT tbl, mac FROM manifests ORDER BY tbl').all() as { tbl: string; mac: string }[];
const rootOf = (rows: { tbl: string; mac: string }[]) => seal('manifests', 0, digest(JSON.stringify(rows.filter(r => r.tbl !== '*').map(r => [r.tbl, r.mac]))));

/** Nothing inserted or deleted in this table, and the manifest is the one the server wrote. */
export function assertTable(t: Table): void {
  if (!spec(t).listed) return;
  cached(`table:${t}`, () => {
    const all = manifests();
    if (!all.length) throw new IntegrityError('this database has no seals (a database from an older version needs "mre seal-db" once)');
    if (all.find(r => r.tbl === '*')?.mac !== rootOf(all) || all.find(r => r.tbl === t)?.mac !== tableDigest(t)) throw new IntegrityError(`the manifest of ${t} does not match`);
    if (JSON.stringify(sealKeys(t).map(r => r.key).sort()) !== JSON.stringify(rowKeys(t))) throw new IntegrityError(`rows were added to or removed from ${t}`);
    return true;
  });
}

/** Verifies a whole table, or one group of it, before it is read for a decision. */
export function assertRows(t: Table, grp?: string): void {
  assertTable(t);
  cached(`rows:${t}:${grp ?? '*'}`, () => {
    const keys = rowKeys(t, grp);
    if (grp !== undefined && JSON.stringify(sealKeys(t, grp).map(r => r.key).sort()) !== JSON.stringify(keys)) throw new IntegrityError(`rows were moved in ${t}`);
    for (const k of keys) assertRow(t, k);
    return true;
  });
}

function putManifest(tables: Table[]): void {
  const put = getDb().prepare('INSERT INTO manifests (tbl, mac) VALUES (?, ?) ON CONFLICT(tbl) DO UPDATE SET mac = excluded.mac');
  for (const t of tables) put.run(t, tableDigest(t));
  put.run('*', rootOf(manifests()));
}

function reseal(t: Table, key: string): void {
  const now = rowState(t, key);
  if (now) getDb().prepare('INSERT INTO row_seals (tbl, key, grp, mac) VALUES (?, ?, ?, ?) ON CONFLICT(tbl, key) DO UPDATE SET grp = excluded.grp, mac = excluded.mac').run(t, key, now.grp, now.mac);
  else getDb().prepare('DELETE FROM row_seals WHERE tbl = ? AND key = ?').run(t, key);
  if (spec(t).listed) putManifest([t]);
}

/* ---------- writes ---------- */
/** The only way to change one key of a sealed table: check, change, seal. */
export function sealedWrite<T>(t: Table, key: string | number, change: () => T): T {
  return atomic(() => {
    assertPlainSchema();
    assertTable(t);
    assertRow(t, key);
    const out = change();
    reseal(t, String(key));
    return out;
  });
}

/** An insert whose key the database picks. */
export function sealedInsert(t: Table, insert: () => number): number {
  return atomic(() => {
    assertPlainSchema();
    assertTable(t);
    const id = insert();
    reseal(t, String(id));
    return id;
  });
}

/* ---------- lifecycle ---------- */
/** Only for a database that had no tables at all a moment ago. */
export function sealEmptyDatabase(): void {
  atomic(() => putManifest(NAMES.filter(t => spec(t).listed)));
}

/** An operator's one-time upgrade of a database from before seals. It vouches for the rows as they are found. */
export function sealExistingDatabase(): number {
  return atomic(() => {
    const db = getDb();
    if (manifests().length || db.prepare('SELECT 1 FROM row_seals LIMIT 1').get())
      throw new Error('This database already has seals. If they fail, rows were changed or the server key is different: restore a backup or the key. Sealing again would hide the change.');
    const setSha = db.prepare('UPDATE cases SET record_sha = ? WHERE id = ?');
    for (const c of db.prepare('SELECT id, record_json FROM cases').all() as { id: string; record_json: string }[]) setSha.run(digest(c.record_json), c.id);
    const head = db.prepare('INSERT OR IGNORE INTO audit_heads (case_id, seq, hash, mac) VALUES (?, ?, ?, ?)');
    const last = [
      ...db.prepare('SELECT case_id, seq, hash FROM audit a WHERE seq = (SELECT MAX(seq) FROM audit b WHERE b.case_id = a.case_id)').all(),
      ...db.prepare("SELECT '__rules__' AS case_id, seq, hash FROM rules_audit WHERE seq = (SELECT MAX(seq) FROM rules_audit)").all(),
    ] as { case_id: string; seq: number; hash: string }[];
    for (const h of last) head.run(h.case_id, h.seq, h.hash, seal(h.case_id, h.seq, h.hash));
    let n = 0;
    const ins = db.prepare('INSERT INTO row_seals (tbl, key, grp, mac) VALUES (?, ?, ?, ?)');
    for (const t of NAMES) for (const key of rowKeys(t)) { const s = rowState(t, key)!; ins.run(t, key, s.grp, s.mac); n++; }
    putManifest(NAMES.filter(t => spec(t).listed));
    return n;
  });
}

/** Start-up: is this database sealed, with the key this server holds? */
export function assertSealed(): void {
  assertPlainSchema();
  for (const t of NAMES) assertTable(t);
}

/** Every seal and case record. The checkpoint, kept elsewhere, later shows whether an older copy was put back. */
export function verifyDatabase(): { problems: string[]; checkpoint: string | null } {
  const problems: string[] = [];
  const attempt = (fn: () => void) => { try { fn(); } catch (e) { problems.push(e instanceof Error ? e.message : String(e)); } };
  attempt(assertPlainSchema);
  for (const t of NAMES) attempt(() => assertRows(t));
  for (const c of getDb().prepare('SELECT id, record_json, record_sha FROM cases').all() as { id: string; record_json: string; record_sha: string | null }[])
    if (digest(c.record_json) !== c.record_sha) problems.push(`The record of ${c.id} is not as it was written.`);
  return { problems, checkpoint: manifests().find(r => r.tbl === '*')?.mac ?? null };
}
