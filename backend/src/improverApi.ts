/**
 * Human-governed rule changes:
 *  - labels produce a calibration PROPOSAL; they never change a score by themselves;
 *  - a threshold search proposes only what passes an independent holdout, honest thin merchants included;
 *  - requester, then a different approver (reviewer/admin), then promote; rollback needs reviewer/admin;
 *  - every step is in a sealed hash chain, and the promoted rules survive a restart.
 */
import { createHash } from 'node:crypto';
import { analyze, DETECTORS } from '../../engine/index';
import { insideBand, propose, proposeCalibration, type Proposal } from '../../engine/improver';
import { effectiveRates, type LabelEvent, type LearnedRate } from '../../engine/learnedRates';
import { FRONTS, makeMerchant } from '../../engine/synthetic';
import { getLiveDetectorPatch, withDetectorOverrides, RULES, type RulePatch } from '../../rules/index';
import type { EvidenceItem } from '../../frontend/src/types/evidence';
import type { Label } from '../../frontend/src/types/merchant';
import { samePerson, type Actor } from './auth';
import { getDb } from './db';
import { saveLiveRules, syncLiveRules } from './rulesState';
import { seal } from './seal';
import type { ApiReply } from './workflow';

const RULES_CHAIN = '__rules__';

export interface StoredProposal extends Proposal {
  status: 'proposed' | 'approved' | 'rejected' | 'live' | 'rolled_back';
  requestedBy: { id: number; username: string };
  /** The rules this was tested against. It cannot be promoted over different ones. */
  baseVersion: string;
  /** The complete patch to make live: what was already live plus this change. */
  livePatch: RulePatch;
  approvedBy?: string | null;
  promotedVersion?: string | null;
}

export interface RulesAuditRow {
  seq: number;
  at: string;
  actor: string;
  actorId: number | null;
  action: string;
  detail: string;
  prevHash: string;
  hash: string;
}

const GENESIS = '0'.repeat(64);
const canonical = (e: { seq: number; at: string; actor: string; actorId: number | null; action: string; detail: string }) =>
  JSON.stringify([e.seq, e.at, e.actor, e.actorId, e.action, e.detail]);
const chain = (prev: string, e: Parameters<typeof canonical>[0]) =>
  createHash('sha256').update(prev).update(canonical(e)).digest('hex');

export function readRulesAudit(): RulesAuditRow[] {
  return getDb()
    .prepare('SELECT seq, at, actor, actor_id AS actorId, action, detail, prev_hash AS prevHash, hash FROM rules_audit ORDER BY seq')
    .all() as unknown as RulesAuditRow[];
}

export function appendRulesAudit(action: string, detail: string, actor: Actor | { id: number | null; username: string }): RulesAuditRow[] {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const last = db.prepare('SELECT seq, hash FROM rules_audit ORDER BY seq DESC LIMIT 1').get() as { seq: number; hash: string } | undefined;
    const seq = (last?.seq ?? 0) + 1;
    const prev = last?.hash ?? GENESIS;
    const row = { seq, at: new Date().toISOString(), actor: actor.username, actorId: actor.id, action: action.slice(0, 300), detail: detail.slice(0, 2000) };
    const hash = chain(prev, row);
    db.prepare('INSERT INTO rules_audit (seq, at, actor, actor_id, action, detail, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.seq, row.at, row.actor, row.actorId, row.action, row.detail, prev, hash);
    db.prepare('INSERT INTO audit_heads (case_id, seq, hash, mac) VALUES (?, ?, ?, ?) ON CONFLICT(case_id) DO UPDATE SET seq = excluded.seq, hash = excluded.hash, mac = excluded.mac')
      .run(RULES_CHAIN, seq, hash, seal(RULES_CHAIN, seq, hash));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return readRulesAudit();
}

export function verifyRulesAudit(): { ok: boolean; brokenAt: number | null; entries: number } {
  const rows = readRulesAudit();
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prevHash !== prev || chain(prev, r) !== r.hash) return { ok: false, brokenAt: r.seq, entries: rows.length };
    prev = r.hash;
  }
  const head = getDb().prepare('SELECT seq, hash, mac FROM audit_heads WHERE case_id = ?').get(RULES_CHAIN) as { seq: number; hash: string; mac: string } | undefined;
  if (rows.length || head) {
    const last = rows.at(-1);
    if (!head || !last || head.seq !== last.seq || head.hash !== prev || head.mac !== seal(RULES_CHAIN, head.seq, head.hash))
      return { ok: false, brokenAt: (last?.seq ?? 0) + 1, entries: rows.length };
  }
  return { ok: true, brokenAt: null, entries: rows.length };
}

/** Record label events for T14 Bayesian detector learning. Skips UNRESOLVED and merchant_dispute origins. */
export function recordLabelEvents(merchantId: string, mcc: string, evidence: EvidenceItem[], label: Label, actorId: number, origin?: string): void {
  if (label === 'UNRESOLVED' || origin === 'merchant_dispute') return;
  const db = getDb();
  const now = new Date().toISOString();
  // One merchant is one observation, however many times its file is uploaded: the latest label replaces the last.
  const key = `m:${merchantId}`;
  db.prepare('DELETE FROM label_events WHERE case_id = ?').run(key);
  const ins = db.prepare('INSERT INTO label_events (case_id, detector, mcc, fired, label, actor_id, origin, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const e of evidence) {
    if (e.status === 'UNKNOWN') continue;
    ins.run(key, e.id, mcc, e.status === 'ILLICIT' ? 1 : 0, label, actorId, origin ?? 'analyst', now);
  }
}

export function getAllLabelEvents(): LabelEvent[] {
  const rows = getDb()
    .prepare('SELECT detector, mcc, fired, label, actor_id AS actorId, origin FROM label_events ORDER BY id')
    .all() as { detector: string; mcc: string; fired: number; label: Label; actorId: number | null; origin: string | null }[];
  return rows.map(r => ({
    detectorId: r.detector,
    mcc: r.mcc,
    fired: r.fired === 1,
    label: r.label,
    actorId: r.actorId ?? undefined,
    origin: r.origin ?? undefined,
  }));
}

export function listLearnedRates(mcc?: string): LearnedRate[] {
  const events = getAllLabelEvents();
  return DETECTORS.map(d => effectiveRates(d.id, events, mcc));
}

function saveProposal(p: StoredProposal): void {
  getDb()
    .prepare(
      `INSERT INTO rules_proposals (id, created_at, created_by, status, approved_by, promoted_version, proposal_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, approved_by = excluded.approved_by, promoted_version = excluded.promoted_version, proposal_json = excluded.proposal_json`,
    )
    .run(p.id, p.createdAt, p.requestedBy.username, p.status, p.approvedBy ?? null, p.promotedVersion ?? null, JSON.stringify(p));
}

export function listProposals(): StoredProposal[] {
  const rows = getDb().prepare('SELECT proposal_json FROM rules_proposals ORDER BY created_at DESC LIMIT 20').all() as { proposal_json: string }[];
  // Proposals from before requesters were recorded cannot be approved safely, so they are not offered.
  return rows.map(r => JSON.parse(r.proposal_json) as StoredProposal).filter(p => p.requestedBy);
}

/** One thin front, shown on the console so a person can see what a rule change does. */
export const probeMerchant = () => makeMerchant(FRONTS.find(k => k.name === 'low-volume split')!, 1, { id: 'M-PROBE-THIN', seed: 5151, geo: true, volume: 0.5 });

export function getRulesStatus(): ApiReply {
  syncLiveRules();
  const { patch, version } = getLiveDetectorPatch(), probe = probeMerchant().dataset, now = analyze(probe);
  return {
    status: 200,
    body: {
      rulesVersion: version,
      livePatch: patch,
      evasionCheck: {
        merchantId: probe.merchant.id,
        salesCount: probe.transactions.filter(t => t.type === 'SALE').length,
        operator: 'A thin account, the size one mule account would be after splitting the volume',
        decision: now.ok ? now.result.fusion.decision : 'ERROR',
        followUp: now.ok ? now.result.fusion.followUp : 'NONE',
        posterior: now.ok ? now.result.fusion.posterior : 0,
      },
      proposals: listProposals(),
      audit: readRulesAudit(),
      auditVerification: verifyRulesAudit(),
      minLabels: RULES.engine.learning.minLabels,
      labelledMerchants: new Set((getDb().prepare('SELECT case_id FROM label_events').all() as { case_id: string }[]).map(r => r.case_id)).size,
      learnedRates: listLearnedRates().filter(r => r.nPos + r.nNeg > 0),
    },
  };
}

export function runImproverProposal(actor: Actor, kind: Proposal['kind'] = 'threshold'): ApiReply {
  if (!['analyst', 'reviewer', 'admin'].includes(actor.role)) return { status: 403, body: { error: 'Your role cannot request a rule change.' } };
  syncLiveRules();
  const live = getLiveDetectorPatch();
  const tried = kind === 'calibration' ? proposeCalibration(listLearnedRates()) : propose();
  if (!tried.proposal) {
    appendRulesAudit(`No ${kind} change proposed`, tried.reason, actor);
    return { status: 422, body: { error: tried.reason, backtest: tried.backtest ?? null } };
  }
  const merged: RulePatch = { ...(live.patch ?? {}) };
  for (const [id, p] of Object.entries(tried.proposal.patch)) {
    if (!insideBand(id, p)) return { status: 400, body: { error: `Proposed parameter for ${id} is outside its allowed band.` } };
    merged[id] = { ...merged[id], ...p };
  }
  // The person who asked is the maker, even though the machine did the search.
  const stored: StoredProposal = { ...tried.proposal, createdBy: actor.username, requestedBy: { id: actor.id, username: actor.username }, status: 'proposed', baseVersion: live.version, livePatch: merged };
  saveProposal(stored);
  const { champion, challenger } = stored.backtest;
  appendRulesAudit(`Proposal ${stored.id} created`, `${kind} · holdout fronts caught ${champion.tp}→${challenger.tp} of ${champion.nFront} · false alarms ${champion.fpCount}→${challenger.fpCount} of ${champion.nGenuine}`, actor);
  return getRulesStatus();
}

function checker(id: string, actor: Actor, verb: string): StoredProposal | ApiReply {
  const prop = listProposals().find(p => p.id === id);
  if (!prop) return { status: 404, body: { error: 'No rule proposal with that id.' } };
  if (samePerson(prop.requestedBy, actor)) return { status: 403, body: { error: `You cannot ${verb} a rule change you requested. A different person must.` } };
  if (actor.role !== 'admin' && actor.role !== 'reviewer') return { status: 403, body: { error: `Only an admin or reviewer can ${verb} rule changes.` } };
  return prop;
}

export function approveRuleProposal(id: string, actor: Actor): ApiReply {
  const prop = checker(id, actor, 'approve');
  if (!('patch' in prop)) return prop;
  if (prop.status !== 'proposed') return { status: 409, body: { error: `This proposal is already ${prop.status}.` } };
  prop.status = 'approved';
  prop.approvedBy = `${actor.username} (${actor.role})`;
  saveProposal(prop);
  appendRulesAudit(`Proposal ${prop.id} approved`, `Approved by ${actor.username} (${actor.role}); requested by ${prop.requestedBy.username}`, actor);
  return getRulesStatus();
}

export function promoteRuleProposal(id: string, actor: Actor): ApiReply {
  const prop = checker(id, actor, 'promote');
  if (!('patch' in prop)) return prop;
  if (prop.status !== 'approved') return { status: 409, body: { error: 'Proposal must be approved before it can be promoted to live.' } };
  syncLiveRules();
  if (getLiveDetectorPatch().version !== prop.baseVersion) return { status: 409, body: { error: 'The live rules changed after this was backtested. Run it again.' } };
  const version = `${RULES.engine.version}+${prop.id}`;
  saveLiveRules(prop.livePatch, version);
  prop.status = 'live';
  prop.promotedVersion = version;
  saveProposal(prop);
  appendRulesAudit(`Promoted ${version}`, `Proposal ${prop.id} promoted live by ${actor.username} (${actor.role})`, actor);
  return getRulesStatus();
}

export function rollbackRulesLive(actor: Actor): ApiReply {
  if (actor.role !== 'admin' && actor.role !== 'reviewer') return { status: 403, body: { error: 'Only an admin or reviewer can roll back rules.' } };
  syncLiveRules();
  const from = getLiveDetectorPatch().version;
  saveLiveRules(null, null);
  for (const p of listProposals()) {
    if (p.status === 'live') {
      p.status = 'rolled_back';
      saveProposal(p);
    }
  }
  appendRulesAudit('Rollback to base rules', `Restored ${RULES.engine.version} from ${from}`, actor);
  return getRulesStatus();
}

/** What a proposal would do to one merchant, without making it live. */
export const previewPatch = (patch: RulePatch, dataset: unknown) => withDetectorOverrides(patch, () => analyze(dataset));
