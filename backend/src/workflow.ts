import { randomBytes } from 'node:crypto';
import { LAYERS, MECHANISMS } from '../../frontend/src/data/evidence';
import { profileUpdates } from '../../frontend/src/engines/learningEngine';
import { planResponse } from '../../frontend/src/engines/responseEngine';
import type { ResponseLevel } from '../../frontend/src/types/investigation';
import type { Label } from '../../frontend/src/types/merchant';
import { appendAudit, assertCase, emptyUser, forClient, getCase, isCaseId, listCases, merchantCases, putCase, readAudit, restoreInForce, verifyAudit, type CaseRecord, type MerchantCase } from './store';
import { analyzeDataset } from './algorithms/analyze';
import { own, RULES } from '../../rules/index';
import { sha256 } from './adapters/canonicalDataset';
import { scrubText } from '../../adapters/privacy';
import { samePerson, type Actor } from './auth';
import { emit } from './events';
import { atomic, IntegrityError } from './integrity';
import { clearLabelEvents, getAllLabelEvents, merchantLabel, recordLabelEvents } from './improverApi';
import { effectiveRates } from '../../engine/learnedRates';
import { engineLevelOf, loadWorkflow, RESTRICTING } from '../../engine/workflowConfig';

export interface ApiReply { status: number; body: Record<string, unknown> }

const LABELS: Label[] = ['CONFIRMED_ILLICIT', 'ADJUDICATED_BENIGN', 'UNRESOLVED'];

/** Roles and approval counts come from workflow/*.json. Nobody approves their own proposal (that rule is not in the file). */
const wf = () => loadWorkflow();
const responseOf = (id: string) => wf().responses.find(r => r.id === id);
const needsLegal = (l: string) => !!responseOf(l)?.needsLegal;
const restricts = (l: string) => !!responseOf(l)?.restrictsFunds || RESTRICTING.includes(engineLevelOf(wf(), l));

export interface Restriction { caseId: string; id: string; level: ResponseLevel; actions: string[]; at: string }
const isRestriction = (f: { id: string; level: ResponseLevel }) => RESTRICTING.includes(f.level) || !!responseOf(f.id)?.restrictsFunds;

/** The restriction this case itself put in force, if any. */
function ownRestriction(rec: CaseRecord): Restriction | null {
  const f = rec.inForce;
  return f && isRestriction({ id: f.id, level: f.plan.level }) ? { caseId: rec.id, id: f.id, level: f.plan.level, actions: f.plan.actions, at: f.at ?? '' } : null;
}

/**
 * Restrictions follow the merchant. They add up across its cases, every case shows all of them, and an approved response
 * that restricts nothing lifts all of them, wherever they were imposed.
 */
export function restrictionsOn(rec: CaseRecord, cases: MerchantCase[] = merchantCases(rec.result.scenario.primaryMerchantId)): Restriction[] {
  const own = ownRestriction(rec);
  return [...(own ? [own] : []), ...cases.flatMap(c => (c.id !== rec.id && c.inForce && isRestriction(c.inForce) ? [{ caseId: c.id, ...c.inForce }] : []))];
}

const fingerprint = (held: Restriction[]) => held.map(r => `${r.caseId}:${r.id}:${r.at}`).sort().join('|');

const rankOf = (level: string) => Number(level.slice(1));

/**
 * Doing less than the engine recommends closes a case or a question, so it takes a second person until two people have
 * cleared it. A confirmed merchant cannot be stood down below due diligence by one person either.
 */
function standsDown(rec: CaseRecord, id: string): boolean {
  if (rec.user.label === 'ADJUDICATED_BENIGN') return false;
  const f = rec.result.fusion;
  const least = Math.max(rankOf(rec.result.review.recommended), f.decision === 'OPEN_CASE' ? 2 : 0, f.followUp === 'ASK' ? 1 : 0, rec.user.label === 'CONFIRMED_ILLICIT' ? 2 : 0);
  return rankOf(engineLevelOf(wf(), id)) < least;
}

/** `auto` in a config file can never skip approval of a restriction, of standing down, or of any change while a restriction is in force. */
const needsApproval = (rec: CaseRecord, held: Restriction[], l: string) => !responseOf(l)?.auto || restricts(l) || held.length > 0 || standsDown(rec, l);

/** Who approves a move to `target`: the rule of the most severe of what is in force and where it would go. */
function approvalRule(held: Restriction[], target: string): { roles: string[]; approvers: number; legal: boolean; rank: number } {
  const cfg = wf();
  const ruleOf = (id: string) => {
    const rule = own(cfg.approvals.levels, id), legal = needsLegal(id), level = engineLevelOf(cfg, id);
    // An action that restricts nothing has no rule of its own. A reviewer, admin or legal user approves it.
    return { roles: rule?.approverRoles ?? cfg.approvals.confirmedIllicit.confirmRoles, approvers: rule?.approvers ?? 1, legal, rank: (legal ? 10 : 0) + Number(level.slice(1)) };
  };
  return held.reduce((strictest, r) => {
    // A restriction from an older config keeps the rule of the same engine level. If there is none, only legal can move it.
    const id = responseOf(r.id)?.id ?? cfg.responses.find(x => engineLevelOf(cfg, x.id) === r.level)?.id;
    const from = id ? ruleOf(id) : { roles: ['legal'], approvers: 1, legal: true, rank: Infinity };
    return { ...(from.rank >= strictest.rank ? from : strictest), approvers: Math.max(from.approvers, strictest.approvers) };
  }, ruleOf(target));
}

const can = (a: Actor, roles: readonly string[]) => roles.includes(a.role);

function fail(status: number, error: string): ApiReply {
  return { status, body: { error } };
}

/** `staff` is false for a service client: it sees its own case, not the merchant's other cases or their documents. */
function view(rec: CaseRecord, staff = true): ApiReply {
  const { user } = rec, result = staff ? rec.result : forClient(rec);
  const counts = result.l1.counts;
  const missing = result.l1.sources.filter(s => s.state === 'MISSING').map(s => s.name);
  const alarms = result.l2.cusum.filter(p => p.alarm).length;
  const peak = result.l2.peak;
  const n = (status: string) => result.evidence.filter(e => e.status === status).length;
  const top = [...result.fusion.mechanisms].sort((a, b) => b.score - a.score)[0];
  const mechanism = top ? (MECHANISMS.find(m => m.id === top.id)?.name ?? top.id) : 'none';
  const l6 = rec.pending.response ? 'waiting' : user.executed ? 'done' : rec.response?.blocked.length ? 'blocked' : 'waiting';
  const l7 = user.label ? 'done' : 'waiting';
  const mine = ownRestriction(rec);
  let intact = verifyAudit(rec.id).ok, cases: MerchantCase[] = [];
  // A tampered case is still shown, marked as tampered. It is only writes and exports that are refused.
  if (staff) try { cases = merchantCases(result.scenario.primaryMerchantId); } catch (e) { if (!(e instanceof IntegrityError)) throw e; intact = false; }
  const held = staff ? restrictionsOn(rec, cases) : mine ? [mine] : [];
  const stillOn = held.length ? ` ${held.map(r => (r.caseId === rec.id ? r.level : `${r.level} from ${r.caseId}`)).join(', ')} stays in force until a change is approved.` : '';
  const others = cases.filter(c => c.id !== rec.id).reverse();
  const history = others.filter((c, i) => c.label || c.decision === 'OPEN_CASE' || c.followUp === 'ASK' || i < 5).map(({ id, createdAt, decision, followUp, label }) => ({ id, createdAt, decision, followUp, label }));
  const steps = [
    `Read ${counts.SALE?.n ?? 0} sales, ${counts.REFUND?.n ?? 0} refunds, ${counts.SETTLEMENT?.n ?? 0} settlements, ${counts.TRANSFER?.n ?? 0} payouts. ${missing.length ? `Missing feeds stay UNKNOWN: ${missing.join(', ')}.` : 'No feed is marked missing.'}`,
    `${result.l2.profile.name}, ${result.l2.profile.category}. ${alarms} CUSUM alarm week${alarms === 1 ? '' : 's'}.${peak?.rSeasonal != null ? ` Latest seasonal residual ${peak.rSeasonal.toFixed(2)}.` : ''}`,
    `${n('ILLICIT')} illicit, ${n('BENIGN')} benign, ${n('UNKNOWN')} unknown. UNKNOWN is excluded from the score.`,
    `${result.fusion.decision} (${result.fusion.priority}). ${result.fusion.gateReason} Leading mechanism: ${mechanism}${top ? ` (${top.score.toFixed(2)})` : ''}.`,
    `Legitimate-business chain ${result.review.legitStatus}. Recommended response ${result.review.recommended}.${user.notes ? ` Analyst note: ${user.notes}` : ' Engine draft is waiting for a human note.'}`,
    rec.pending.response
      ? `${rec.pending.response.level} proposed by ${rec.pending.response.by.username}; waiting for ${approvalRule(held, rec.pending.response.level).legal ? 'legal' : 'reviewer'} approval by a different person.${stillOn}`
      : user.executed
      ? rec.response!.actions.join(' ')
      : rec.response?.blocked.length
        ? rec.response.blocked.join(' ') + stillOn
        : `Waiting for a human decision. The engine recommends ${result.review.recommended}.`,
    rec.pending.label
      ? `${rec.pending.label.label} proposed by ${rec.pending.label.by.username}; a second reviewer must confirm.`
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
      investigation: { ...result, scenario: undefined, events: undefined },
      engineVersion: rec.engineVersion ?? RULES.version,
      merchant: { id: result.scenario.profile.id, name: result.scenario.profile.name, category: result.scenario.profile.category, city: result.scenario.profile.city },
      workflow: LAYERS.map((layer, i) => ({ layer: layer.n, code: layer.code, name: layer.name, state: state[i], summary: steps[i] })),
      result: {
        decision: result.fusion.decision,
        priority: result.fusion.priority,
        gatePassed: result.fusion.gatePassed,
        gateReason: result.fusion.gateReason,
        followUp: result.fusion.followUp,
        passportAnswered: result.passportAnswered ?? [],
        scope: result.scope,
        streams: result.streams,
        suspectLinks: result.suspectLinks,
        recommended: result.review.recommended,
        legitStatus: result.review.legitStatus,
        topMechanism: mechanism,
        evidence: { illicit: n('ILLICIT'), benign: n('BENIGN'), unknown: n('UNKNOWN') },
      },
      coverage: result.l1.sources.map(source => ({ name: source.name, state: source.state, records: source.records, note: source.note })),
      evidenceItems: result.evidence.map(item => ({
        id: item.id, name: item.name, family: item.family, status: item.status,
        observed: item.observed, expected: item.expected, explanation: item.explanation,
        metrics: item.metrics, sourceRecordIds: item.records,
      })),
      user: { notes: user.notes, clarification: user.clarification, chosenLevel: user.chosenLevel, legalVerified: user.legalVerified, escrowConfirmed: user.escrowConfirmed, executed: user.executed, label: user.label },
      response: rec.response,
      inForce: rec.inForce ? { id: rec.inForce.id, level: rec.inForce.plan.level, actions: rec.inForce.plan.actions, restricts: !!mine } : null,
      restrictions: held,
      history,
      learning: rec.learning,
      audit: readAudit(rec.id).map(({ seq, at, actor, action, detail, prevHash, hash }) => ({ seq, at, actor, action, detail, prevHash, hash })),
      auditIntact: intact,
      // `over` fingerprints the restrictions on the merchant's other cases.
      pending: staff || !rec.pending.response ? rec.pending : { ...rec.pending, response: { ...rec.pending.response, over: undefined } },
      status: user.label ? wf().statuses.labelled : rec.pending.response ? wf().statuses.proposed : user.executed || held.length ? wf().statuses.approved : wf().statuses.opened,
      rulesVersion: result.fusion.rulesVersion,
      posterior: { p: result.fusion.posterior, ci: result.fusion.posteriorCi, prior: result.fusion.prior },
    },
  };
}

/** Load an existing case. Cases are never created here, and client-supplied user state is never trusted. */
function ensure(id: string): CaseRecord | ApiReply {
  if (!isCaseId(id)) return fail(400, 'Invalid case id.');
  const rec = getCase(id);
  if (!rec) return fail(404, 'No case with that id.');
  assertCase(id);
  return rec;
}

export function openInvestigation(raw: unknown, actor: Actor, client?: string): ApiReply {
  if (!can(actor, wf().approvals.actions.open ?? [])) return fail(403, 'Your role cannot open cases.');
  const id = `INV-${randomBytes(4).toString('hex')}`;
  const analysis = analyzeDataset(raw, client);
  // Whoever uploads a passport is its maker. A service key is not a person, so its passports wait for one.
  if (analysis.ok && actor.id > 0) for (const p of analysis.scenario.passports ?? []) if (p.status === 'SUBMITTED') p.submittedBy = actor.username;
  if (!analysis.ok) return fail(400, analysis.errors.join(' ') || 'Dataset could not be read.');
  const rec: CaseRecord = {
    id, createdAt: new Date().toISOString(), createdBy: actor.id > 0 ? actor.id : null, client, engineVersion: analysis.engineVersion, datasetSha256: sha256(JSON.stringify(raw)),
    result: analysis.result, user: emptyUser(), response: null, inForce: null, learning: null, pending: {},
  };
  const f = analysis.result.fusion;
  atomic(() => {
  putCase(rec);
  appendAudit(id, [{ action: 'Case analysed', detail: `${f.decision} · P(front) ${f.posterior.toFixed(4)} [${f.posteriorCi.map(x => x.toFixed(4)).join(', ')}] · rules ${f.rulesVersion} · dataset ${rec.datasetSha256.slice(0, 16)}` }], actor);
  });
  void emit('case.opened', id, { decision: f.decision, posterior: f.posterior });
  return view(getCase(id)!);
}

export function getInvestigation(id: string, staff = true): ApiReply {
  if (!isCaseId(id)) return fail(400, 'Invalid case id.');
  const rec = getCase(id);
  return rec ? view(rec, staff) : fail(404, 'No case with that id.');
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
        ...(({ workflow, auditIntact }) => ({ workflow, auditIntact }))(view(rec).body),
      })),
    },
  };
}

export function reviewInvestigation(id: string, body: unknown, actor: Actor): ApiReply {
  const rec = ensure(id);
  if ('status' in rec) return rec;
  if (!can(actor, wf().approvals.actions.review ?? [])) return fail(403, 'Your role cannot record reviews.');
  const input = (body ?? {}) as { notes?: unknown; clarification?: unknown };
  if (typeof input.notes === 'string') rec.user.notes = scrubText(input.notes.slice(0, 2000));
  if (typeof input.clarification === 'string') rec.user.clarification = scrubText(input.clarification.slice(0, 2000));
  putCase(rec);
  appendAudit(id, [{ action: 'Recorded review', detail: rec.user.notes }], actor);
  return view(getCase(id)!);
}

function execute(rec: CaseRecord, id: string, actor: Actor, approvedBy: string | null): void {
  const held = restrictionsOn(rec), mine = ownRestriction(rec), others = held.filter(r => r.caseId !== rec.id);
  rec.user.chosenLevel = engineLevelOf(wf(), id);
  const plan = planResponse(rec.result, rec.user);
  rec.response = plan;
  if (plan.blocked.length) {
    rec.user.executed = false;
    putCase(rec);
    appendAudit(rec.id, [{ action: `${plan.level} blocked`, detail: plan.blocked.join(' ') + (held.length ? ' What was in force stays in force.' : '') }], actor);
    return;
  }
  const at = new Date().toISOString(), lifts = !restricts(id);
  rec.user.executed = true;
  rec.inForce = { id, plan, at };
  putCase(rec);
  const detail = [approvedBy ? `Approved by ${approvedBy}` : '', mine && mine.id !== id ? `Replaces ${mine.id}` : '', lifts && others.length ? 'Lifts the restrictions from the merchant\'s other cases' : ''].filter(Boolean).join('; ');
  appendAudit(rec.id, plan.actions.map(a => ({ action: `${plan.level}: ${a}`, detail })), actor);
  // A restriction adds to what other cases imposed. A response that restricts nothing replaces it.
  if (!lifts) return;
  for (const r of others) {
    const c = getCase(r.caseId)!;
    c.inForce = { id, plan: { ...plan, hold: null }, at };
    if (!c.pending.response) restoreInForce(c);
    putCase(c);
    appendAudit(c.id, [{ action: `${r.id} lifted from ${rec.id}`, detail: `Now ${plan.level}. ${approvedBy ? `Approved by ${approvedBy}` : ''}` }], actor);
  }
}

/**
 * Propose a response. An action that restricts nothing takes effect at once, unless it does less than the engine recommends
 * or this merchant has a restriction in force on any of its cases. Those, and every restriction, wait for a second person (see
 * approveInvestigation) and changes nothing until then.
 */
export function respondInvestigation(id: string, body: unknown, actor: Actor): ApiReply {
  const rec = ensure(id);
  if ('status' in rec) return rec;
  if (!can(actor, wf().approvals.actions.propose ?? [])) return fail(403, 'Your role cannot propose responses.');
  const level = ((body ?? {}) as { chosenLevel?: string }).chosenLevel ?? rec.result.review.recommended;
  if (!responseOf(level)) return fail(400, 'chosenLevel is not a response in the workflow config.');
  // legalVerified / escrowConfirmed are never taken from the request body; only a legal approval sets them.
  if (rec.pending.response && !samePerson(rec.pending.response.by, actor))
    return fail(409, 'Another person\'s proposal is waiting. It must be approved or rejected before a new response is recorded.');
  const held = restrictionsOn(rec);
  if (needsApproval(rec, held, level)) {
    rec.pending.response = { level, by: { id: actor.id, username: actor.username }, at: new Date().toISOString(), over: fingerprint(held) };
    rec.user.chosenLevel = engineLevelOf(wf(), level); rec.user.executed = false;
    putCase(rec);
    appendAudit(id, [{ action: `${level} proposed`, detail: `Waiting for ${approvalRule(held, level).legal ? 'legal' : 'reviewer'} approval by a different person.${held.length ? ' What is in force stays in force until then.' : ''}` }], actor);
    void emit('case.response.proposed', id, { level });
    return view(getCase(id)!);
  }
  delete rec.pending.response;
  execute(rec, level, actor, null);
  return view(getCase(id)!);
}

/** `mustName`: over HTTP an approval names the proposal it saw, so the proposer cannot swap it just before the click. */
export function approveInvestigation(id: string, body: unknown, actor: Actor, mustName = false): ApiReply {
  const rec = ensure(id);
  if ('status' in rec) return rec;
  const p = rec.pending.response;
  if (!p) return fail(409, 'There is no proposed response waiting for approval.');
  const input = (body ?? {}) as { approve?: unknown; escrowConfirmed?: unknown; reason?: unknown };
  const reason = typeof input.reason === 'string' ? scrubText(input.reason.slice(0, 500)) : '';
  const self = samePerson(p.by, actor), held = restrictionsOn(rec), rule = approvalRule(held, p.level);
  // The proposer may withdraw, never approve.
  if (self && input.approve !== false) return fail(403, 'You cannot approve your own proposal. A different person must approve it.');
  if (!self && !can(actor, rule.roles)) return fail(403, `${p.level} must be approved by a ${rule.legal ? 'legal' : rule.roles.join(' or ') || 'different'} user.`);
  if (input.approve !== true) {
    restoreInForce(rec);
    putCase(rec);
    appendAudit(id, [{ action: `${p.level} ${self ? 'withdrawn' : 'rejected'}`, detail: reason || `Proposal by ${p.by.username} ${self ? 'withdrawn' : 'rejected'}.` }], actor);
    return view(getCase(id)!);
  }
  const seen = input as { proposedAt?: unknown; level?: unknown };
  if ((mustName || seen.proposedAt !== undefined) && (seen.proposedAt !== p.at || seen.level !== p.level))
    return fail(409, 'The approval must name the proposal that is waiting. It may have changed: refresh and look again.');
  // The config may have changed since the proposal.
  if ((p.over ?? '') !== fingerprint(held)) return fail(409, 'The restrictions on this merchant changed after this was proposed. Reject it and propose again.');
  if (!responseOf(p.level)) return fail(409, `${p.level} is no longer a response in the workflow config. Reject it and propose again.`);
  const soFar = [...(p.approvals ?? [])];
  if (soFar.some(a => samePerson(a, actor))) return fail(403, 'You have already approved this proposal.');
  soFar.push({ id: actor.id, username: actor.username });
  const needed = rule.approvers;
  if (soFar.length < needed) {
    rec.pending.response = { ...p, approvals: soFar };
    putCase(rec);
    appendAudit(id, [{ action: `${p.level} approval ${soFar.length} of ${needed}`, detail: `Approved by ${actor.username}. Waiting for another approver.` }], actor);
    return view(getCase(id)!);
  }
  delete rec.pending.response;
  if (needsLegal(p.level)) { rec.user.legalVerified = true; rec.user.escrowConfirmed = input.escrowConfirmed === true; }
  execute(rec, p.level, actor, `${actor.username} (${actor.role}); proposed by ${p.by.username}${reason ? `; ${reason}` : ''}`);
  void emit('case.response.approved', id, { level: p.level });
  return view(getCase(id)!);
}

export function labelInvestigation(id: string, body: unknown, actor: Actor): ApiReply {
  const rec = ensure(id);
  if ('status' in rec) return rec;
  const input = (body ?? {}) as { label?: string; origin?: string; reject?: unknown; reason?: unknown };
  if (input.reject === true) {
    const p = rec.pending.label;
    if (!p) return fail(409, 'There is no proposed label waiting to be rejected.');
    const self = samePerson(p.by, actor);
    if (!self && !can(actor, wf().approvals.confirmedIllicit.confirmRoles)) return fail(403, 'Only the proposer, or a reviewer, admin or legal user, can reject a proposed label.');
    delete rec.pending.label;
    putCase(rec);
    const why = typeof input.reason === 'string' ? scrubText(input.reason.slice(0, 500)) : '';
    appendAudit(id, [{ action: `${p.label} ${self ? 'withdrawn' : 'rejected'}`, detail: `Proposed by ${p.by.username}.${why ? ` ${why}` : ''}` }], actor);
    return view(getCase(id)!);
  }
  const rawLabel = typeof input.label === 'string' ? input.label : '';
  const label = (own(wf().labels, rawLabel) ?? rawLabel) as Label;
  if (!LABELS.includes(label)) return fail(400, 'label must be CONFIRMED_ILLICIT, ADJUDICATED_BENIGN, or UNRESOLVED.');
  if (rec.pending.label && rec.pending.label.label !== label) return fail(409, `${rec.pending.label.label} is waiting. Confirm or reject it before recording a different label.`);
  const merchant = rec.result.scenario.profile.id, was = rec.user.label;
  if (!rec.pending.label && was === label) return view(rec);
  const finalize = () => {
    rec.user.label = label; delete rec.pending.label;
    const mcc = rec.result.scenario.profile.mcc;
    // A retracted decision must stop counting towards calibration.
    if (label === 'UNRESOLVED' && was && merchantLabel(merchant) === was) clearLabelEvents(merchant);
    recordLabelEvents(rec.result.scenario.profile.id, mcc, rec.result.evidence, label, actor.id, input.origin);
    // These are candidate rates. They change scoring only through an approved calibration proposal.
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
      updates: bayesianUpdates,
      profile: profileUpdates(rec.result, label),
    };
  };
  // Two people: confirming a front, changing a final label, finishing anything that two people started, closing a case
  // or question, and clearing a merchant that has a case, question, confirmation or restriction on any of its cases. This
  // reads the cases themselves, because a label recorded as a dispute never becomes a calibration event.
  const cases = merchantCases(merchant), f = rec.result.fusion;
  const twoPeople = !!rec.pending.label || label === 'CONFIRMED_ILLICIT' || was === 'CONFIRMED_ILLICIT' || was === 'ADJUDICATED_BENIGN'
    || f.decision === 'OPEN_CASE' || f.followUp === 'ASK'
    || (label === 'ADJUDICATED_BENIGN' && (merchantLabel(merchant) === 'CONFIRMED_ILLICIT'
      || cases.some(c => c.decision === 'OPEN_CASE' || c.followUp === 'ASK' || c.label === 'CONFIRMED_ILLICIT') || restrictionsOn(rec, cases).length > 0));
  if (!twoPeople) {
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
    appendAudit(id, [{ action: `${label} proposed`, detail: 'Needs confirmation by a second reviewer.' }], actor);
    return view(getCase(id)!);
  }
  if (samePerson(rec.pending.label.by, actor)) return fail(403, `A second, different reviewer must confirm ${label}.`);
  if (!can(actor, wf().approvals.confirmedIllicit.confirmRoles)) return fail(403, `Only a reviewer, admin or legal user can confirm ${label}.`);
  const first = rec.pending.label.by.username;
  finalize(); putCase(rec);
  appendAudit(id, [{ action: `Label ${label}`, detail: `Proposed by ${first}, confirmed by ${actor.username}. ${rec.learning?.profile[0] ?? ''}` }], actor);
  void emit('case.labelled', id, { label });
  return view(getCase(id)!);
}

export function auditStatus(id: string): ApiReply {
  if (!isCaseId(id)) return fail(400, 'Invalid case id.');
  if (!getCase(id)) return fail(404, 'No case with that id.');
  return { status: 200, body: verifyAudit(id) };
}
