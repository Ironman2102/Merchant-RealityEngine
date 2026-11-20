/**
 * Case store on SQLite. The audit trail lives in its own table and is hash-chained:
 *   hash_n = SHA-256(hash_{n−1} ‖ canonical JSON of entry n)
 * so editing, deleting or reordering any past entry breaks verifyAudit(). ponytail: the chain head is in the same
 * database; anchor it externally (e.g. a daily signed digest) when regulators need it.
 */
import { createHash } from 'node:crypto';
import type { ActionRecord, InvestigationResult, ResponseLevel, UserState } from '../../frontend/src/types/investigation';
import type { Label } from '../../frontend/src/types/merchant';
import type { ResponsePlan } from '../../frontend/src/engines/responseEngine';
import type { ReliabilityUpdate } from '../../frontend/src/engines/learningEngine';
import { getDb } from './db';
import type { Actor } from './auth';

export interface Pending {
  response?: { level: ResponseLevel; by: { id: number; username: string }; at: string };
  label?: { label: Label; by: { id: number; username: string }; at: string };
}
export interface CaseRecord {
  id: string;
  createdAt: string;
  createdBy?: number | null;
  engineVersion?: string;
  /** SHA-256 of the uploaded file. The raw upload is never stored (it contains payer identifiers). */
  datasetSha256: string;
  result: InvestigationResult;
  user: UserState;
  response: ResponsePlan | null;
  learning: { updates: ReliabilityUpdate[]; profile: string[] } | null;
  pending: Pending;
}
export interface AuditRow extends ActionRecord { actorId: number | null; prevHash: string; hash: string }

/** Case ids are minted by the server only. Anything else is rejected before it reaches storage. */
export const CASE_ID = /^INV-[0-9a-f]{8}$/;
export const isCaseId = (id: unknown): id is string => typeof id === 'string' && CASE_ID.test(id);

const GENESIS = '0'.repeat(64);
const canonical = (e: { seq: number; at: string; actor: string; actorId: number | null; action: string; detail: string }) =>
  JSON.stringify([e.seq, e.at, e.actor, e.actorId, e.action, e.detail]);
const chain = (prev: string, e: Parameters<typeof canonical>[0]) => createHash('sha256').update(prev).update(canonical(e)).digest('hex');

export function putCase(rec: CaseRecord): void {
  if (!isCaseId(rec.id)) throw Object.assign(new Error('Invalid case id.'), { status: 400 });
  const { audit: _a, ...user } = rec.user;
  const json = JSON.stringify({ ...rec, user: { ...user, audit: [] } });
  getDb().prepare(`INSERT INTO cases (id, created_at, created_by, engine_version, rules_version, dataset_sha256, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET record_json = excluded.record_json`).run(rec.id, rec.createdAt, rec.createdBy ?? null, rec.engineVersion ?? null, rec.result.fusion.rulesVersion, rec.datasetSha256, json);
}

export function readAudit(caseId: string): AuditRow[] {
  return (getDb().prepare('SELECT seq, at, actor, actor_id AS actorId, action, detail, prev_hash AS prevHash, hash FROM audit WHERE case_id = ? ORDER BY seq').all(caseId) as unknown as AuditRow[]);
}

/** Append entries to the case's audit chain (inside one transaction) and return the full trail. */
export function appendAudit(caseId: string, entries: { action: string; detail: string }[], actor: Actor | { id: null; username: string }): AuditRow[] {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const last = db.prepare('SELECT seq, hash FROM audit WHERE case_id = ? ORDER BY seq DESC LIMIT 1').get(caseId) as { seq: number; hash: string } | undefined;
    let seq = last?.seq ?? 0, prev = last?.hash ?? GENESIS;
    const ins = db.prepare('INSERT INTO audit (case_id, seq, at, actor, actor_id, action, detail, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const e of entries) {
      const row = { seq: ++seq, at: new Date().toISOString(), actor: actor.username, actorId: actor.id, action: e.action.slice(0, 300), detail: e.detail.slice(0, 2000) };
      const hash = chain(prev, row);
      ins.run(caseId, row.seq, row.at, row.actor, row.actorId, row.action, row.detail, prev, hash);
      prev = hash;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return readAudit(caseId);
}

/** Recompute the chain. Returns the first broken sequence number, or null if intact. */
export function verifyAudit(caseId: string): { ok: boolean; brokenAt: number | null; entries: number } {
  const rows = readAudit(caseId);
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prevHash !== prev || chain(prev, r) !== r.hash) return { ok: false, brokenAt: r.seq, entries: rows.length };
    prev = r.hash;
  }
  return { ok: true, brokenAt: null, entries: rows.length };
}

const hydrate = (json: string): CaseRecord => {
  const rec = JSON.parse(json) as CaseRecord;
  rec.pending ??= {};
  rec.user.audit = readAudit(rec.id).map(({ seq, at, actor, action, detail }) => ({ seq, at, actor, action, detail }));
  return rec;
};

export function getCase(id: string): CaseRecord | undefined {
  if (!isCaseId(id)) return;
  const row = getDb().prepare('SELECT record_json FROM cases WHERE id = ?').get(id) as { record_json: string } | undefined;
  return row ? hydrate(row.record_json) : undefined;
}

export function listCases(): CaseRecord[] {
  return (getDb().prepare('SELECT record_json FROM cases ORDER BY created_at DESC LIMIT 500').all() as { record_json: string }[]).map(r => hydrate(r.record_json));
}

export const emptyUser = (): UserState => ({
  notes: '', clarification: '', chosenLevel: null, legalVerified: false, escrowConfirmed: false, executed: false, label: null, audit: [],
});
