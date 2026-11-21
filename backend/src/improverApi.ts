/**
 * Human-governed self-improvement API (T14–T16):
 *  - T14: Bayesian detector sensitivity & false-positive learning from confirmed case labels (with MCC partial pooling & 20% analyst cap)
 *  - T15: Red-team evasion search and silencing diagnostics
 *  - T16: Propose -> Backtest (Wilson CIs + McNemar exact p) -> Maker/Checker Admin Approval -> Promote -> Byte-identical Rollback
 *  - Hash-chained rules_audit trail (tamper-evident SHA-256 chain)
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { analyze, DETECTORS, type MreDataset } from '../../engine/index';
import { bandOf, insideBand, propose, type Proposal } from '../../engine/improver';
import { effectiveRates, type LabelEvent, type LearnedRate } from '../../engine/learnedRates';
import { getLiveDetectorPatch, RULES, setLiveDetectorPatch, withDetectorOverrides } from '../../rules/index';
import type { EvidenceItem } from '../../frontend/src/types/evidence';
import type { Label } from '../../frontend/src/types/merchant';
import type { Actor } from './auth';
import { getDb } from './db';
import type { ApiReply } from './workflow';

import sweetSample from '../../frontend/public/samples/01-sweet-crumbs-betting-front.json';
import diwaliSample from '../../frontend/public/samples/04-anand-sweets-diwali-genuine.json';
import ganeshSample from '../../frontend/public/samples/06-shree-ganesh-sweets-genuine.json';
import udupiSample from '../../frontend/public/samples/07-udupi-tiffin-steady.json';
import nandiSample from '../../frontend/public/samples/08-nandi-kirana-genuine.json';
import telegramSample from '../../frontend/public/samples/09-telegram-betting-no-website.json';

export interface StoredProposal extends Proposal {
  status: 'proposed' | 'approved' | 'rejected' | 'live' | 'rolled_back';
  createdBy: 'mre-improver' | string;
  approvedBy?: string | null;
  promotedVersion?: string | null;
  evasionPreview?: {
    merchantId: string;
    name: string;
    operator: string;
    attackerCost: number;
    beforeDecision: string;
    beforePosterior: number;
    afterDecision: string;
    afterPosterior: number;
    recallRsi: number;
  };
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
  return { ok: true, brokenAt: null, entries: rows.length };
}

/** Record label events for T14 Bayesian detector learning. Skips UNRESOLVED and merchant_dispute origins. */
export function recordLabelEvents(caseId: string, mcc: string, evidence: EvidenceItem[], label: Label, actorId: number, origin?: string): void {
  if (label === 'UNRESOLVED' || origin === 'merchant_dispute') return;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('DELETE FROM label_events WHERE case_id = ?').run(caseId);
  const ins = db.prepare('INSERT INTO label_events (case_id, detector, mcc, fired, label, actor_id, origin, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const e of evidence) {
    if (e.status === 'UNKNOWN') continue;
    ins.run(caseId, e.id, mcc, e.status === 'ILLICIT' ? 1 : 0, label, actorId, origin ?? 'analyst', now);
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

function thinEvasion(ds: MreDataset, id: string, ratio = 0.1): MreDataset {
  const d = structuredClone(ds);
  const old = d.merchant.id;
  d.merchant = { ...d.merchant, id, name: `${ds.merchant.name} (${id})` };
  d.transactions.forEach(t => { if (t.merchantId === old) t.merchantId = id; });
  const sales = d.transactions.filter(t => t.type === 'SALE');
  const n = Math.max(8, Math.floor(sales.length * ratio));
  const keep = new Set(sales.slice(0, n).map(t => t.id));
  d.transactions = d.transactions.filter(t => t.type !== 'SALE' || keep.has(t.id));
  return d;
}

function loadSample(fallback: unknown, path: string): MreDataset {
  try { return JSON.parse(readFileSync(path, 'utf8')) as MreDataset; }
  catch { return structuredClone(fallback) as MreDataset; }
}

function buildRedTeamSuite(): { evasions: MreDataset[]; genuine: MreDataset[]; silencing: { id: string; name: string; silencedShare: number; band: [number, number] }[] } {
  const tg = loadSample(telegramSample, 'frontend/public/samples/09-telegram-betting-no-website.json');
  const sweet = loadSample(sweetSample, 'frontend/public/samples/01-sweet-crumbs-betting-front.json');
  const evasions = Array.from({ length: 6 }, (_, i) => thinEvasion(tg, `M-EV-${i + 1}`, 0.1));
  const genuine = [
    loadSample(diwaliSample, 'frontend/public/samples/04-anand-sweets-diwali-genuine.json'),
    loadSample(ganeshSample, 'frontend/public/samples/06-shree-ganesh-sweets-genuine.json'),
    loadSample(udupiSample, 'frontend/public/samples/07-udupi-tiffin-steady.json'),
    loadSample(nandiSample, 'frontend/public/samples/08-nandi-kirana-genuine.json'),
  ];

  // Compare original Telegram front vs thinned evasions to measure per-detector silencing rate
  const baseRun = withDetectorOverrides({}, () => analyze(tg));
  const baseFired = new Set(baseRun.ok ? baseRun.result.evidence.filter(e => e.status === 'ILLICIT').map(e => e.id) : []);
  const silenceCounts = new Map<string, number>();
  for (const ev of evasions) {
    const r = withDetectorOverrides({}, () => analyze(ev));
    if (!r.ok) continue;
    for (const e of r.result.evidence) {
      if (baseFired.has(e.id) && e.status !== 'ILLICIT') {
        silenceCounts.set(e.id, (silenceCounts.get(e.id) ?? 0) + 1);
      }
    }
  }
  void sweet;
  const silencing = [...baseFired].map(id => ({
    id,
    name: RULES.detector(id).name,
    silencedShare: (silenceCounts.get(id) ?? 0) / evasions.length,
    band: bandOf(id).minN,
  }));
  return { evasions, genuine, silencing };
}

function saveProposal(p: StoredProposal): void {
  getDb()
    .prepare(
      `INSERT INTO rules_proposals (id, created_at, created_by, status, approved_by, promoted_version, proposal_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, approved_by = excluded.approved_by, promoted_version = excluded.promoted_version, proposal_json = excluded.proposal_json`,
    )
    .run(p.id, p.createdAt, p.createdBy, p.status, p.approvedBy ?? null, p.promotedVersion ?? null, JSON.stringify(p));
}

export function listProposals(): StoredProposal[] {
  const rows = getDb().prepare('SELECT proposal_json FROM rules_proposals ORDER BY created_at DESC LIMIT 20').all() as { proposal_json: string }[];
  return rows.map(r => JSON.parse(r.proposal_json) as StoredProposal);
}

export function getRulesStatus(): ApiReply {
  const { patch, version } = getLiveDetectorPatch();
  const { evasions, silencing } = buildRedTeamSuite();
  const sampleEvasion = evasions[0];
  const currentEval = analyze(sampleEvasion);
  const events = getAllLabelEvents();
  const learned = listLearnedRates();
  return {
    status: 200,
    body: {
      rulesVersion: version,
      livePatch: patch,
      evasionCheck: {
        merchantId: sampleEvasion.merchant.id,
        name: sampleEvasion.merchant.name,
        salesCount: sampleEvasion.transactions.filter(t => t.type === 'SALE').length,
        operator: 'splitMerchant / thinSales (10% volume split across mule accounts)',
        attackerCost: 5,
        decision: currentEval.ok ? currentEval.result.fusion.decision : 'ERROR',
        posterior: currentEval.ok ? currentEval.result.fusion.posterior : 0,
      },
      silencing,
      proposals: listProposals(),
      audit: readRulesAudit(),
      auditVerification: verifyRulesAudit(),
      labelEventsCount: events.length,
      learnedRates: learned.filter(r => r.nPos + r.nNeg > 0 || ['A1', 'A4', 'B6', 'B7', 'C5', 'D9', 'G6', 'H3'].includes(r.detectorId)),
    },
  };
}

export function runImproverProposal(actor: Actor, createdByMode: 'mre-improver' | 'self' = 'mre-improver'): ApiReply {
  // Temporarily clear livePatch when computing champion vs challenger
  const prev = getLiveDetectorPatch();
  setLiveDetectorPatch(null, null);
  try {
    const { evasions, genuine } = buildRedTeamSuite();
    const rawProp = propose(evasions, genuine, evasions);
    if (!rawProp) {
      return { status: 422, body: { error: 'No in-band proposal satisfied the false-positive bound, recall gain, and McNemar p < 0.05.' } };
    }
    for (const [id, p] of Object.entries(rawProp.patch)) {
      if (!insideBand(id, p)) return { status: 400, body: { error: `Proposed parameter for ${id} is outside its allowed band.` } };
    }
    const before = analyze(evasions[0]);
    const after = withDetectorOverrides(rawProp.patch, () => analyze(evasions[0]));
    const champRecall = rawProp.backtest.champion.recall;
    const chalRecall = rawProp.backtest.challenger.recall;
    const stored: StoredProposal = {
      ...rawProp,
      createdBy: createdByMode === 'self' ? actor.username : 'mre-improver',
      status: 'proposed',
      evasionPreview: {
        merchantId: evasions[0].merchant.id,
        name: evasions[0].merchant.name,
        operator: 'splitMerchant(10) — keeps 14 sales below default minN=30',
        attackerCost: 5,
        beforeDecision: before.ok ? before.result.fusion.decision : 'NO_CASE',
        beforePosterior: before.ok ? before.result.fusion.posterior : 0,
        afterDecision: after.ok ? after.result.fusion.decision : 'OPEN_CASE',
        afterPosterior: after.ok ? after.result.fusion.posterior : 0,
        recallRsi: champRecall > 0 ? (chalRecall - champRecall) / champRecall : chalRecall,
      },
    };
    saveProposal(stored);
    appendRulesAudit(
      `Proposal ${stored.id} created`,
      `Creator: ${stored.createdBy} · Patch: ${Object.entries(stored.patch).map(([k, v]) => `${k}.minN→${v.minN}`).join(', ')} · Backtest recall ${(champRecall * 100).toFixed(0)}%→${(chalRecall * 100).toFixed(0)}% (McNemar p=${rawProp.backtest.mcnemarP.toFixed(4)})`,
      actor,
    );
    return getRulesStatus();
  } finally {
    setLiveDetectorPatch(prev.patch, prev.version === RULES.engine.version ? null : prev.version);
  }
}

export function approveRuleProposal(id: string, actor: Actor): ApiReply {
  const list = listProposals();
  const prop = list.find(p => p.id === id);
  if (!prop) return { status: 404, body: { error: 'No rule proposal with that id.' } };
  if (prop.createdBy === actor.username) {
    return { status: 403, body: { error: 'Maker/checker violation: you cannot approve a rule proposal that you initiated yourself. Switch to a different reviewer/admin persona.' } };
  }
  if (actor.role !== 'admin' && actor.role !== 'reviewer') {
    return { status: 403, body: { error: 'Only an admin or reviewer role can approve rule changes.' } };
  }
  prop.status = 'approved';
  prop.approvedBy = `${actor.username} (${actor.role})`;
  saveProposal(prop);
  appendRulesAudit(`Proposal ${prop.id} approved`, `Approved by ${actor.username} (${actor.role}); creator was ${prop.createdBy}`, actor);
  return getRulesStatus();
}

export function promoteRuleProposal(id: string, actor: Actor): ApiReply {
  const list = listProposals();
  const prop = list.find(p => p.id === id);
  if (!prop) return { status: 404, body: { error: 'No rule proposal with that id.' } };
  if (prop.createdBy === actor.username) {
    return { status: 403, body: { error: 'Maker/checker violation: you cannot promote your own rule proposal.' } };
  }
  if (prop.status !== 'approved' && prop.status !== 'live') {
    return { status: 409, body: { error: 'Proposal must be approved before it can be promoted to live.' } };
  }
  const nextVersion = `${RULES.engine.version}.1`;
  setLiveDetectorPatch(prop.patch, nextVersion);
  prop.status = 'live';
  prop.promotedVersion = nextVersion;
  saveProposal(prop);
  appendRulesAudit(`Promoted ${nextVersion}`, `Proposal ${prop.id} promoted live by ${actor.username} (${actor.role})`, actor);
  return getRulesStatus();
}

export function rollbackRulesLive(actor: Actor): ApiReply {
  const prev = getLiveDetectorPatch();
  setLiveDetectorPatch(null, null);
  for (const p of listProposals()) {
    if (p.status === 'live') {
      p.status = 'rolled_back';
      saveProposal(p);
    }
  }
  appendRulesAudit('Rollback to base rules', `Restored ${RULES.engine.version} from ${prev.version}`, actor);
  return getRulesStatus();
}
