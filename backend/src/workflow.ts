import { randomBytes } from 'node:crypto';
import { LAYERS, MECHANISMS } from '../../frontend/src/data/evidence';
import { profileUpdates, reliabilityUpdates } from '../../frontend/src/engines/learningEngine';
import { planResponse } from '../../frontend/src/engines/responseEngine';
import type { ResponseLevel } from '../../frontend/src/types/investigation';
import type { Label } from '../../frontend/src/types/merchant';
import { appendAudit, emptyUser, getCase, isCaseId, listCases, putCase, readAudit, verifyAudit, type CaseRecord } from './store';
import { analyzeDataset, ENGINE_VERSION } from './algorithms/analyze';
import { sha256 } from './adapters/canonicalDataset';
import type { Actor, Role } from './auth';
import { emit } from './events';
import { getAllLabelEvents, recordLabelEvents } from './improverApi';
import { effectiveRates } from '../../engine/learnedRates';
import { engineLevelOf, loadWorkflow } from '../../engine/workflowConfig';
import { scoreWithHost, type MlOpinion } from './ml';

export interface ApiReply { status: number; body: Record<string, unknown> }

const LABELS: Label[] = ['CONFIRMED_ILLICIT', 'ADJUDICATED_BENIGN', 'UNRESOLVED'];

/** Roles and approval counts come from workflow/*.json. Nobody approves their own proposal (that rule is not in the file). */
const wf = () => loadWorkflow();
const responseOf = (id: string) => wf().responses.find(r => r.id === id);
const needsLegal = (l: string) => !!responseOf(l)?.needsLegal;
const needsApproval = (l: string) => { const r = responseOf(l); return !!r && !r.auto; };
const can = (a: Actor, roles: readonly string[]) => roles.includes(a.role);

function fail(status: number, error: string): ApiReply {
  return { status, body: { error } };
}

function view(rec: CaseRecord): ApiReply {
  const { result, user } = rec;
  const counts = result.l1.counts;
  const missing = result.l1.sources.filter(s => s.state === 'MISSING').map(s => s.name);
  const alarms = result.l2.cusum.filter(p => p.alarm).length;
  const peak = result.l2.peak;
  const n = (status: string) => result.evidence.filter(e => e.status === status).length;
  const top = [...result.fusion.mechanisms].sort((a, b) => b.score - a.score)[0];
  const mechanism = top ? (MECHANISMS.find(m => m.id === top.id)?.name ?? top.id) : 'none';
  const l6 = rec.pending.response ? 'waiting' : user.executed ? 'done' : rec.response?.blocked.length ? 'blocked' : 'waiting';
  const l7 = user.label ? 'done' : 'waiting';
  const steps = [
    `Read ${counts.SALE?.n ?? 0} sales, ${counts.REFUND?.n ?? 0} refunds, ${counts.SETTLEMENT?.n ?? 0} settlements, ${counts.TRANSFER?.n ?? 0} payouts. ${missing.length ? `Missing feeds stay UNKNOWN: ${missing.join(', ')}.` : 'No feed is marked missing.'}`,
    `${result.l2.profile.name}, ${result.l2.profile.category}. ${alarms} CUSUM alarm week${alarms === 1 ? '' : 's'}.${peak?.rSeasonal != null ? ` Latest seasonal residual ${peak.rSeasonal.toFixed(2)}.` : ''}`,
    `${n('ILLICIT')} illicit, ${n('BENIGN')} benign, ${n('UNKNOWN')} unknown. UNKNOWN is excluded from the score.`,
    `${result.fusion.decision} (${result.fusion.priority}). ${result.fusion.gateReason} Leading mechanism: ${mechanism}${top ? ` (${top.score.toFixed(2)})` : ''}.`,
    `Legitimate-business chain ${result.review.legitStatus}. Recommended response ${result.review.recommended}.${user.notes ? ` Analyst note: ${user.notes}` : ' Engine draft is waiting for a human note.'}`,
    rec.pending.response
      ? `${rec.pending.response.level} proposed by ${rec.pending.response.by.username}; waiting for ${needsLegal(rec.pending.response.level) ? 'legal' : 'reviewer'} approval by a different person.`
      : user.executed
      ? rec.response!.actions.join(' ')
      : rec.response?.blocked.length
        ? rec.response.blocked.join(' ')
        : `Waiting for a human decision. The engine recommends ${result.review.recommended}.`,
    rec.pending.label
      ? `CONFIRMED_ILLICIT proposed by ${rec.pending.label.by.username}; a second reviewer must confirm.`
      : user.label
      ? `${user.label}. ${rec.learning?.profile[0] ?? ''}`
      : 'Waiting for a label: CONFIRMED_ILLICIT, ADJUDICATED_BENIGN, or UNRESOLVED.',
  ];
  const state = ['done', 'done', 'done', 'done', 'done', l6, l7];
  return {
    status: 200,
    body: {
      id: rec.id,
      createdAt: rec.createdAt,
      scenario: result.scenario,
      engineVersion: rec.engineVersion ?? ENGINE_VERSION,
      merchant: { id: result.scenario.profile.id, name: result.scenario.profile.name, category: result.scenario.profile.category, city: result.scenario.profile.city },
      workflow: LAYERS.map((layer, i) => ({ layer: layer.n, code: layer.code, name: layer.name, state: state[i], summary: steps[i] })),
      result: {
        decision: result.fusion.decision,
        priority: result.fusion.priority,
        gatePassed: result.fusion.gatePassed,
        gateReason: result.fusion.gateReason,
        recommended: result.review.recommended,
        legitStatus: result.review.legitStatus,
        topMechanism: mechanism,
        evidence: { illicit: n('ILLICIT'), benign: n('BENIGN'), unknown: n('UNKNOWN') },
      },
      stage2: rec.ml?.assessment ?? null,
      coverage: result.l1.sources.map(source => ({ name: source.name, state: source.state, records: source.records, note: source.note })),
      evidenceItems: result.evidence.map(item => ({
        id: item.id, name: item.name, family: item.family, status: item.status,
        observed: item.observed, expected: item.expected, explanation: item.explanation,
        metrics: item.metrics, sourceRecordIds: item.records,
      })),
      user: { notes: user.notes, clarification: user.clarification, chosenLevel: user.chosenLevel, legalVerified: user.legalVerified, escrowConfirmed: user.escrowConfirmed, executed: user.executed, label: user.label },
      response: rec.response,
      learning: rec.learning,
      audit: readAudit(rec.id).map(({ seq, at, actor, action, detail, prevHash, hash }) => ({ seq, at, actor, action, detail, prevHash, hash })),
      auditIntact: verifyAudit(rec.id).ok,
      pending: rec.pending,
      status: user.label ? wf().statuses.labelled : rec.pending.response ? wf().statuses.proposed : user.executed ? wf().statuses.approved : wf().statuses.opened,
      rulesVersion: result.fusion.rulesVersion,
      posterior: { p: result.fusion.posterior, ci: result.fusion.posteriorCi, prior: result.fusion.prior },
    },
  };
}

/** Load an existing case. Cases are never created here, and client-supplied user state is never trusted. */
function ensure(id: string): CaseRecord | ApiReply {
  if (!isCaseId(id)) return fail(400, 'Invalid case id.');
  return getCase(id) ?? fail(404, 'No case with that id.');
}

function saveAnalysis(raw: unknown, actor: Actor, analysis: ReturnType<typeof analyzeDataset>, ml?: MlOpinion | null): ApiReply {
  if (!can(actor, wf().approvals.actions.open ?? [])) return fail(403, 'Your role cannot open cases.');
  if (!analysis.ok) return fail(400, analysis.errors.join(' ') || 'Dataset could not be read.');
  const id = `INV-${randomBytes(4).toString('hex')}`;
  if (ml?.ensemble) {
    const statP = analysis.result.fusion.posterior;
    const trust = ml.ensemble.confidence === 'HIGH' ? 0.3 : ml.ensemble.confidence === 'MEDIUM' ? 0.15 : 0.05;
    const clamp = (p: number) => Math.max(1e-6, Math.min(1 - 1e-6, p));
    const logit = (p: number) => Math.log(clamp(p) / (1 - clamp(p)));
    const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
    const combinedP = sigmoid((1 - trust) * logit(statP) + trust * logit(ml.ensemble.p));
    ml.assessment = { statisticalP: statP, combinedP,
      classification: ml.ensemble.review ? 'REVIEW' : combinedP >= 0.8 ? 'HIGH_RISK' : combinedP <= 0.1 ? 'LOW_RISK' : 'REVIEW',
      review: ml.ensemble.review || (combinedP > 0.1 && combinedP < 0.8) };
  }
  const rec: CaseRecord = {
    id, createdAt: new Date().toISOString(), createdBy: actor.id > 0 ? actor.id : null, engineVersion: analysis.engineVersion, datasetSha256: sha256(JSON.stringify(raw)),
    result: analysis.result, user: emptyUser(), response: null, learning: null, pending: {},
    ...(ml ? { ml } : {}),
  };
  putCase(rec);
  const f = analysis.result.fusion;
  const stage2 = ml?.assessment ? ` · Stage 2 ${ml.assessment.classification}, combined P=${ml.assessment.combinedP.toFixed(3)}, ${ml.ensemble?.confidence.toLowerCase()} confidence${ml.assessment.review ? ', analyst review suggested' : ''}` : ' · Stage 2 unavailable';
  appendAudit(id, [{ action: 'Case analysed', detail: `${f.decision} · P(front) ${f.posterior.toFixed(4)} [${f.posteriorCi.map(x => x.toFixed(4)).join(', ')}] · rules ${f.rulesVersion}${stage2} · dataset ${rec.datasetSha256.slice(0, 16)}` }], actor);
  void emit('case.opened', id, { decision: f.decision, posterior: f.posterior });
  return view(getCase(id)!);
}

export function openInvestigation(raw: unknown, actor: Actor, suppliedMl?: MlOpinion | null): ApiReply {
  return saveAnalysis(raw, actor, analyzeDataset(raw), suppliedMl);
}

/** Stage 2 runs after Stage 1 evidence exists and before the governed case decision is persisted. */
export async function openInvestigationWithStage2(raw: unknown, actor: Actor, precomputed?: ReturnType<typeof analyzeDataset>, suppliedMl?: MlOpinion | null): Promise<ApiReply> {
  if (!can(actor, wf().approvals.actions.open ?? [])) return fail(403, 'Your role cannot open cases.');
  const analysis = precomputed ?? analyzeDataset(raw);
  if (!analysis.ok) return fail(400, analysis.errors.join(' ') || 'Dataset could not be read.');
  const ml = suppliedMl === undefined ? await scoreWithHost(analysis.result) : suppliedMl;
  return saveAnalysis(raw, actor, analysis, ml);
}

export function getInvestigation(id: string): ApiReply {
  if (!isCaseId(id)) return fail(400, 'Invalid case id.');
  const rec = getCase(id);
  return rec ? view(rec) : fail(404, 'No case with that id.');
}

export function listInvestigations(): ApiReply {
  return {
    status: 200,
    body: {
      cases: listCases().map(rec => ({
        id: rec.id,
        createdAt: rec.createdAt,
        merchant: { id: rec.result.scenario.profile.id, name: rec.result.scenario.profile.name, category: rec.result.scenario.profile.category, city: rec.result.scenario.profile.city },
        result: { decision: rec.result.fusion.decision, priority: rec.result.fusion.priority, recommended: rec.result.review.recommended, legitStatus: rec.result.review.legitStatus, posterior: rec.result.fusion.posterior },
        user: { executed: rec.user.executed, label: rec.user.label },
        workflow: view(rec).body.workflow,
      })),
    },
  };
}

export function reviewInvestigation(id: string, body: unknown, actor: Actor): ApiReply {
  const rec = ensure(id);
  if ('status' in rec) return rec;
  if (!can(actor, wf().approvals.actions.review ?? [])) return fail(403, 'Your role cannot record reviews.');
  const input = (body ?? {}) as { notes?: unknown; clarification?: unknown };
  if (typeof input.notes === 'string') rec.user.notes = input.notes.slice(0, 2000);
  if (typeof input.clarification === 'string') rec.user.clarification = input.clarification.slice(0, 2000);
  putCase(rec);
  appendAudit(id, [{ action: 'Recorded review', detail: rec.user.notes }], actor);
  return view(getCase(id)!);
}

function execute(rec: CaseRecord, level: ResponseLevel, actor: Actor, approvedBy: string | null): void {
  rec.user.chosenLevel = level;
  const plan = planResponse(rec.result, rec.user);
  rec.response = plan;
  if (plan.blocked.length) {
    rec.user.executed = false;
    putCase(rec);
    appendAudit(rec.id, [{ action: `${plan.level} blocked`, detail: plan.blocked.join(' ') }], actor);
  } else {
    rec.user.executed = true;
    putCase(rec);
    appendAudit(rec.id, plan.actions.map(a => ({ action: `${plan.level}: ${a}`, detail: approvedBy ? `Approved by ${approvedBy}` : '' })), actor);
  }
}

/** Propose a response. L0–L2 take effect at once; L3+ wait for a second person (see approveInvestigation). */
export function respondInvestigation(id: string, body: unknown, actor: Actor): ApiReply {
  const rec = ensure(id);
  if ('status' in rec) return rec;
  if (!can(actor, wf().approvals.actions.propose ?? [])) return fail(403, 'Your role cannot propose responses.');
  const level = ((body ?? {}) as { chosenLevel?: string }).chosenLevel ?? rec.result.review.recommended;
  if (!responseOf(level)) return fail(400, 'chosenLevel is not a response in the workflow config.');
  // legalVerified / escrowConfirmed are never taken from the request body; only a legal approval sets them.
  if (needsApproval(level)) {
    rec.pending.response = { level, by: { id: actor.id, username: actor.username }, at: new Date().toISOString() };
    rec.user.chosenLevel = engineLevelOf(wf(), level); rec.user.executed = false;
    putCase(rec);
    appendAudit(id, [{ action: `${level} proposed`, detail: `Waiting for ${needsLegal(level) ? 'legal' : 'reviewer'} approval by a different person.` }], actor);
    void emit('case.response.proposed', id, { level });
    return view(getCase(id)!);
  }
  delete rec.pending.response;
  execute(rec, engineLevelOf(wf(), level), actor, null);
  return view(getCase(id)!);
}

export function approveInvestigation(id: string, body: unknown, actor: Actor): ApiReply {
  const rec = ensure(id);
  if ('status' in rec) return rec;
  const p = rec.pending.response;
  if (!p) return fail(409, 'There is no proposed response waiting for approval.');
  if (p.by.id === actor.id) return fail(403, 'You cannot approve your own proposal. A different person must approve it.');
  const rule = wf().approvals.levels[p.level];
  const roles = rule?.approverRoles ?? [];
  if (!can(actor, roles)) return fail(403, `${p.level} must be approved by a ${needsLegal(p.level) ? 'legal' : roles.join(' or ') || 'different'} user.`);
  const input = (body ?? {}) as { approve?: unknown; escrowConfirmed?: unknown; reason?: unknown };
  const reason = typeof input.reason === 'string' ? input.reason.slice(0, 500) : '';
  if (input.approve !== true) {
    delete rec.pending.response;
    putCase(rec);
    appendAudit(id, [{ action: `${p.level} rejected`, detail: reason || `Proposal by ${p.by.username} rejected.` }], actor);
    return view(getCase(id)!);
  }
  const soFar = [...(p.approvals ?? [])];
  if (soFar.some(a => a.id === actor.id)) return fail(403, 'You have already approved this proposal.');
  soFar.push({ id: actor.id, username: actor.username });
  const needed = rule?.approvers ?? 1;
  if (soFar.length < needed) {
    rec.pending.response = { ...p, approvals: soFar };
    putCase(rec);
    appendAudit(id, [{ action: `${p.level} approval ${soFar.length} of ${needed}`, detail: `Approved by ${actor.username}. Waiting for another approver.` }], actor);
    return view(getCase(id)!);
  }
  delete rec.pending.response;
  if (needsLegal(p.level)) { rec.user.legalVerified = true; rec.user.escrowConfirmed = input.escrowConfirmed === true; }
  execute(rec, engineLevelOf(wf(), p.level), actor, `${actor.username} (${actor.role}); proposed by ${p.by.username}${reason ? `; ${reason}` : ''}`);
  void emit('case.response.approved', id, { level: p.level });
  return view(getCase(id)!);
}

export function labelInvestigation(id: string, body: unknown, actor: Actor): ApiReply {
  const rec = ensure(id);
  if ('status' in rec) return rec;
  const input = (body ?? {}) as { label?: string; origin?: string };
  const rawLabel = input.label ?? '';
  const label = (wf().labels[rawLabel] ?? rawLabel) as Label;
  if (!LABELS.includes(label)) return fail(400, 'label must be CONFIRMED_ILLICIT, ADJUDICATED_BENIGN, or UNRESOLVED.');
  const finalize = () => {
    rec.user.label = label; delete rec.pending.label;
    const mcc = rec.result.scenario.profile.mcc;
    recordLabelEvents(id, mcc, rec.result.evidence, label, actor.id, input.origin);
    const events = getAllLabelEvents();
    const bayesianUpdates = rec.result.evidence
      .filter(e => e.status !== 'UNKNOWN')
      .map(e => {
        const rate = effectiveRates(e.id, events, mcc);
        return {
          id: e.id,
          name: e.name,
          before: rate.priorSensitivity,
          after: rate.sensitivity,
        };
      });
    rec.learning = {
      updates: bayesianUpdates.length ? bayesianUpdates : reliabilityUpdates(rec.result.evidence, label),
      profile: profileUpdates(rec.result, label),
    };
  };
  if (label !== 'CONFIRMED_ILLICIT') {
    if (!can(actor, wf().approvals.actions.labelBenign ?? [])) return fail(403, 'Your role cannot label cases.');
    finalize(); putCase(rec);
    appendAudit(id, [{ action: `Label ${label}`, detail: rec.learning?.profile[0] ?? '' }], actor);
    void emit('case.labelled', id, { label });
    return view(getCase(id)!);
  }
  if (!rec.pending.label) {
    if (!can(actor, [...(wf().approvals.actions.labelBenign ?? []), ...wf().approvals.confirmedIllicit.confirmRoles])) return fail(403, 'Your role cannot propose this label.');
    rec.pending.label = { label, by: { id: actor.id, username: actor.username }, at: new Date().toISOString() };
    putCase(rec);
    appendAudit(id, [{ action: 'CONFIRMED_ILLICIT proposed', detail: 'Needs confirmation by a second reviewer.' }], actor);
    return view(getCase(id)!);
  }
  if (rec.pending.label.by.id === actor.id) return fail(403, 'A second, different reviewer must confirm CONFIRMED_ILLICIT.');
  if (!can(actor, wf().approvals.confirmedIllicit.confirmRoles)) return fail(403, 'Only a reviewer, admin or legal user can confirm CONFIRMED_ILLICIT.');
  const first = rec.pending.label.by.username;
  finalize(); putCase(rec);
  appendAudit(id, [{ action: 'Label CONFIRMED_ILLICIT', detail: `Proposed by ${first}, confirmed by ${actor.username}. ${rec.learning?.profile[0] ?? ''}` }], actor);
  void emit('case.labelled', id, { label });
  return view(getCase(id)!);
}

export function auditStatus(id: string): ApiReply {
  if (!isCaseId(id)) return fail(400, 'Invalid case id.');
  if (!getCase(id)) return fail(404, 'No case with that id.');
  return { status: 200, body: verifyAudit(id) };
}
