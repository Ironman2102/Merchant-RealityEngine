/**
 * Case store on SQLite. The audit trail lives in its own table and is hash-chained:
 *   hash_n = SHA-256(hash_{n−1} ‖ canonical JSON of entry n)
 * The head (length + last hash) is sealed with the server key, so editing, reordering, truncating or rebuilding the
 * chain without that key breaks verifyAudit(). ponytail: someone holding both database and key can still forge it;
 * anchor the head externally (e.g. a daily signed digest) when regulators need it.
 */
import { createHash } from 'node:crypto';
import { seal } from './seal';
import type { ActionRecord, InvestigationResult, ResponseLevel, UserState } from '../../frontend/src/types/investigation';
import type { MlOpinion } from './ml';
import type { Label } from '../../frontend/src/types/merchant';
import type { ResponsePlan } from '../../frontend/src/engines/responseEngine';
import type { ReliabilityUpdate } from '../../frontend/src/engines/learningEngine';
import { getDb } from './db';
import type { Actor } from './auth';

export interface Pending {
  /** `over` is the merchant's restrictions when it was proposed. If they change, the approval is stale. */
  response?: { level: string; by: { id: number; username: string }; at: string; over?: string; approvals?: { id: number; username: string }[] };
  label?: { label: Label; by: { id: number; username: string }; at: string };
}
export interface CaseRecord {
  id: string;
  createdAt: string;
  createdBy?: number | null;
  /** The service client (key name) that opened the case. Only that client can read it over /v1. */
  client?: string;
  engineVersion?: string;
  /** SHA-256 of the uploaded file. The raw upload is never stored (it contains payer identifiers). */
  datasetSha256: string;
  result: InvestigationResult;
  user: UserState;
  response: ResponsePlan | null;
  /** The last action that took effect. A proposal, a rejection, a blocked step or a re-score never replaces it. */
  inForce?: { id: string; plan: ResponsePlan; at?: string } | null;
  learning: { updates: ReliabilityUpdate[]; profile: string[] } | null;
  pending: Pending;
  /** Saved second opinion from the file that opened the case. Absent on older rows. */
  ml?: MlOpinion;
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
  const f = rec.inForce, held = f ? JSON.stringify({ id: f.id, level: f.plan.level, actions: f.plan.actions, at: f.at ?? '' }) : null;
  getDb().prepare(`INSERT INTO cases (id, created_at, created_by, engine_version, rules_version, dataset_sha256, record_json, merchant_key, in_force_json, decision, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET record_json = excluded.record_json, merchant_key = excluded.merchant_key, in_force_json = excluded.in_force_json, decision = excluded.decision, label = excluded.label`)
    .run(rec.id, rec.createdAt, rec.createdBy ?? null, rec.engineVersion ?? null, rec.result.fusion.rulesVersion, rec.datasetSha256, json,
      rec.result.scenario.primaryMerchantId, held, rec.result.fusion.decision, rec.user.label);
}

export interface MerchantCase {
  id: string; createdAt: string; decision: string; label: Label | null;
  inForce: { id: string; level: ResponseLevel; actions: string[]; at: string } | null;
}

/**
 * Every case of one merchant, oldest first, from columns that putCase maintains (a case record is too big to parse for
 * each view). Merchant ids are the payment aggregator's, so they mean one merchant across all its clients.
 */
export function merchantCases(merchantId: string): MerchantCase[] {
  const db = getDb();
  // Saved before the columns existed.
  for (const r of db.prepare('SELECT id FROM cases WHERE merchant_key IS NULL').all() as { id: string }[]) { const old = getCase(r.id); if (old) putCase(old); }
  return (db.prepare('SELECT id, created_at, decision, label, in_force_json FROM cases WHERE merchant_key = ? ORDER BY created_at, id').all(merchantId) as { id: string; created_at: string; decision: string; label: Label | null; in_force_json: string | null }[])
    .map(r => ({ id: r.id, createdAt: r.created_at, decision: r.decision, label: r.label, inForce: r.in_force_json ? JSON.parse(r.in_force_json) : null }));
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
    db.prepare('INSERT INTO audit_heads (case_id, seq, hash, mac) VALUES (?, ?, ?, ?) ON CONFLICT(case_id) DO UPDATE SET seq = excluded.seq, hash = excluded.hash, mac = excluded.mac')
      .run(caseId, seq, prev, seal(caseId, seq, prev));
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
  const head = getDb().prepare('SELECT seq, hash, mac FROM audit_heads WHERE case_id = ?').get(caseId) as { seq: number; hash: string; mac: string } | undefined;
  if (rows.length || head) {
    const last = rows.at(-1);
    if (!head || !last || head.seq !== last.seq || head.hash !== prev || head.mac !== seal(caseId, head.seq, head.hash))
      return { ok: false, brokenAt: (last?.seq ?? 0) + 1, entries: rows.length };
  }
  return { ok: true, brokenAt: null, entries: rows.length };
}

/** The record as a service client may see it: a passport from another case explains, without its document or people. */
export function forClient(rec: CaseRecord): InvestigationResult {
  const passports = rec.result.scenario.passports?.map(p => (!p.ref || p.ref.startsWith(`${rec.id}:`) ? p : {
    id: p.id, linkId: p.linkId, from: p.from, until: p.until, hours: p.hours, states: p.states, ticketBand: p.ticketBand,
    volumeUplift: p.volumeUplift, status: p.status, reason: 'Verified by the payment aggregator', document: 'Held by the payment aggregator',
  }));
  return { ...rec.result, scenario: { ...rec.result.scenario, passports } };
}

/** A proposal has ended without taking effect: the case goes back to showing the action still in force. */
export function restoreInForce(rec: CaseRecord): void {
  delete rec.pending.response;
  if (!rec.inForce) return;
  rec.user.chosenLevel = rec.inForce.plan.level;
  rec.user.executed = true;
  rec.response = rec.inForce.plan;
}

/** Older records kept only the last plan, and a blocked step overwrote it. The audit trail still has what was executed. */
function inferInForce(rec: CaseRecord): CaseRecord['inForce'] {
  const plan = rec.response;
  if (!plan) return null;
  if (!plan.blocked.length) return { id: plan.level, plan };
  const log = rec.user.audit;
  let last = log.length - 1;
  while (last >= 0 && !/^L[0-5]: /.test(log[last].action)) last--;
  if (last < 0) return null;
  const level = log[last].action.slice(0, 2) as ResponseLevel;
  let first = last;
  // One executed plan is a run of entries with the same level, one per action.
  while (first > 0 && log[first - 1].action.startsWith(`${level}: `) && log[first - 1].detail === log[last].detail) first--;
  return { id: level, plan: { ...plan, level, blocked: [], actions: log.slice(first, last + 1).map(a => a.action.slice(4)) } };
}

const hydrate = (json: string): CaseRecord => {
  const rec = JSON.parse(json) as CaseRecord;
  rec.pending ??= {};
  // Cases saved by engine 0.2 have no streams or follow-up. Their decision is kept as recorded, not re-scored.
  const r = rec.result;
  r.scope ??= { kind: 'account', id: 'account', label: 'Whole account', sales: r.events.filter(e => e.type === 'SALE').length, share: 1 };
  r.streams ??= [];
  r.suspectLinks ??= [];
  r.fusion.followUp ??= 'NONE';
  r.fusion.conductSignals ??= [];
  r.fusion.priorShift ??= 0;
  rec.user.audit = readAudit(rec.id).map(({ seq, at, actor, action, detail }) => ({ seq, at, actor, action, detail }));
  if (rec.inForce === undefined) rec.inForce = inferInForce(rec);
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
