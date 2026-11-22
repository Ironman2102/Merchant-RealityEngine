/**
 * Context Passport, server side. One person records what the merchant says changed, a different person checks the
 * document, and only then is the merchant re-scored. A verified passport follows the merchant to later uploads.
 */
import { randomBytes } from 'node:crypto';
import type { ContextPassport } from '../../frontend/src/types/merchant';
import { passportErrors, passportPeriod } from '../../frontend/src/engines/passport';
import { runInvestigation } from '../../frontend/src/engines/investigationEngine';
import { mlScore } from './ml';
import { getDb } from './db';
import { appendAudit, getCase, isCaseId, putCase, restoreInForce } from './store';
import { getInvestigation, type ApiReply } from './workflow';
import { samePerson, type Actor } from './auth';
import { syncLiveRules } from './rulesState';

const fail = (status: number, error: string): ApiReply => ({ status, body: { error } });

export function verifiedPassports(merchantId: string): ContextPassport[] {
  return (getDb().prepare('SELECT passport_json FROM passports WHERE merchant_id = ? ORDER BY id').all(merchantId) as { passport_json: string }[])
    .map(r => JSON.parse(r.passport_json) as ContextPassport).filter(p => p.status === 'VERIFIED');
}

export function listPassports(caseId: string): ApiReply {
  if (!isCaseId(caseId)) return fail(400, 'Invalid case id.');
  const rec = getCase(caseId);
  return rec ? { status: 200, body: { passports: rec.result.scenario.passports ?? [] } } : fail(404, 'No case with that id.');
}

export function proposePassport(caseId: string, body: unknown, actor: Actor): ApiReply {
  if (!isCaseId(caseId)) return fail(400, 'Invalid case id.');
  const rec = getCase(caseId);
  if (!rec) return fail(404, 'No case with that id.');
  if (!['analyst', 'reviewer', 'admin'].includes(actor.role)) return fail(403, 'Your role cannot record a Context Passport.');
  const b = (body ?? {}) as Record<string, unknown>, text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 300) : v);
  const passport = {
    id: `CP-${randomBytes(4).toString('hex')}`, reason: text(b.reason), linkId: text(b.linkId), from: text(b.from), until: text(b.until) || undefined,
    document: text(b.document), hours: b.hours, states: b.states, ticketBand: b.ticketBand, volumeUplift: b.volumeUplift,
    status: 'SUBMITTED', submittedBy: actor.username,
  } as ContextPassport;
  const errors = passportErrors(passport);
  if (errors.length) return fail(400, errors.join(' '));
  if (!rec.result.events.some(e => e.linkId === passport.linkId)) return fail(400, 'linkId must be a QR or link in this merchant\'s ledger.');
  const [from, until] = passportPeriod(passport);
  if (until <= from) return fail(400, 'until must be after from.');
  rec.result.scenario.passports = [...(rec.result.scenario.passports ?? []), passport];
  putCase(rec);
  appendAudit(caseId, [{ action: `Context Passport ${passport.id} submitted`, detail: `${passport.reason} · ${passport.linkId} · document ${passport.document}. Changes nothing until verified.` }], actor);
  return getInvestigation(caseId);
}

export function reviewPassport(caseId: string, body: unknown, actor: Actor): ApiReply {
  if (!isCaseId(caseId)) return fail(400, 'Invalid case id.');
  const rec = getCase(caseId);
  if (!rec) return fail(404, 'No case with that id.');
  if (actor.role !== 'reviewer' && actor.role !== 'admin') return fail(403, 'Only a reviewer or admin can verify a Context Passport.');
  const b = (body ?? {}) as { passportId?: unknown; verify?: unknown };
  const p = rec.result.scenario.passports?.find(x => x.id === b.passportId && x.status === 'SUBMITTED');
  if (!p) return fail(404, 'No passport is waiting with that id.');
  // An uploaded passport has no recorded submitter, so whoever opened the case counts as its maker.
  const maker = { id: p.submittedBy ? 0 : rec.createdBy ?? 0, username: p.submittedBy ?? '' };
  if (samePerson(maker, actor)) return fail(403, 'A different person must verify this passport.');
  if (typeof b.verify !== 'boolean') return fail(400, 'verify must be true or false.');
  // Submitted under wider limits, or edited since: what is verified must be valid now.
  const invalid = b.verify ? passportErrors(p) : [];
  if (invalid.length) return fail(400, invalid.join(' '));
  p.status = b.verify ? 'VERIFIED' : 'REJECTED';
  p.reviewedBy = actor.username;
  const before = rec.result.fusion, dropped: string[] = [];
  if (b.verify) {
    getDb().prepare('INSERT INTO passports (id, case_id, merchant_id, passport_json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET passport_json = excluded.passport_json')
      .run(`${caseId}:${p.id}`, caseId, rec.result.scenario.primaryMerchantId, JSON.stringify(p));
    syncLiveRules();
    rec.result = runInvestigation(rec.result.scenario);
    rec.ml = mlScore(rec.result);
    // A proposal made on the old evidence cannot be approved on the new one.
    if (rec.pending.response) { dropped.push(rec.pending.response.level); restoreInForce(rec); }
    if (rec.pending.label) dropped.push(rec.pending.label.label);
    delete rec.pending.label;
  }
  putCase(rec);
  const f = rec.result.fusion;
  appendAudit(caseId, [{ action: `Context Passport ${p.id} ${p.status.toLowerCase()}`, detail: b.verify ? `Re-scored: ${before.decision}/${before.followUp} P ${before.posterior.toFixed(4)} → ${f.decision}/${f.followUp} P ${f.posterior.toFixed(4)}${rec.result.passportsSuspended ? ' · not applied: a conduct signal fired' : ''}${dropped.length ? ` · proposals withdrawn by the re-score: ${dropped.join(', ')}` : ''}` : 'No change to the score.' }], actor);
  return getInvestigation(caseId);
}
