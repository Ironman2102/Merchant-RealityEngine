/**
 * Context Passport, server side. A named person records what the merchant says changed, a different person checks the
 * document, and only then is the merchant re-scored. A verified passport follows the merchant to later uploads, one per
 * QR at a time, until it expires or a reviewer revokes it.
 */
import { randomBytes } from 'node:crypto';
import type { ContextPassport } from '../../frontend/src/types/merchant';
import { passportErrors, passportPeriod, passportsInForce, passportsOverlap } from '../../frontend/src/engines/passport';
import { runInvestigation } from '../../frontend/src/engines/investigationEngine';
import { scrubText } from '../../adapters/privacy';
import { getDb } from './db';
import { assertRows, atomic, sealedWrite } from './integrity';
import { appendAudit, assertCase, getCase, isCaseId, merchantCases, putCase, restoreInForce, type CaseRecord } from './store';
import { getInvestigation, type ApiReply } from './workflow';
import { samePerson, type Actor } from './auth';
import { syncLiveRules } from './rulesState';
import { clearLabelEvents, merchantLabel } from './improverApi';

const fail = (status: number, error: string): ApiReply => ({ status, body: { error } });

/**
 * A service client gets the passports verified on its own cases and on the payment aggregator's own, never another
 * client's. With no client (staff, and the operator's command line) every one applies.
 */
export function verifiedPassports(merchantId: string, client?: string): ContextPassport[] {
  assertRows('passports', merchantId);
  return (getDb().prepare('SELECT id, case_id, passport_json FROM passports WHERE merchant_id = ? ORDER BY id').all(merchantId) as { id: string; case_id: string; passport_json: string }[])
    .map(r => {
      const p = JSON.parse(r.passport_json) as ContextPassport;
      // Registered before the key and the client were written on the passport itself.
      return p.ref ? p : { ...p, ref: r.id, client: getCase(r.case_id)?.client };
    })
    .filter(p => p.status === 'VERIFIED' && (!client || !p.client || p.client === client));
}

const terms = (p: ContextPassport) => JSON.stringify([p.linkId, p.from, p.until ?? null, p.document, p.reason, p.hours ?? null, p.states ?? null, p.ticketBand ?? null, p.volumeUplift ?? null]);
export const sameTerms = (a: ContextPassport, b: ContextPassport) => terms(a) === terms(b);

/** Who recorded it. A file's passport is stamped with whoever uploaded it. A service key is not a person. */
function makerOf(rec: CaseRecord, p: ContextPassport): { id: number; username: string } | null {
  if (p.submittedBy) return { id: 0, username: p.submittedBy };
  return rec.createdBy ? { id: rec.createdBy, username: '' } : null;
}

/** New evidence: score again. A proposal made on the old evidence cannot be approved on the new one. */
function rescore(rec: CaseRecord): string[] {
  const dropped: string[] = [];
  syncLiveRules();
  rec.result = runInvestigation(rec.result.scenario);
  delete rec.ml;
  if (rec.pending.response) { dropped.push(rec.pending.response.level); restoreInForce(rec); }
  if (rec.pending.label) dropped.push(rec.pending.label.label);
  delete rec.pending.label;
  return dropped;
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
  assertCase(caseId);
  if (!['analyst', 'reviewer', 'admin'].includes(actor.role)) return fail(403, 'Your role cannot record a Context Passport.');
  if ((body as { endorse?: unknown } | null)?.endorse !== undefined) return endorsePassport(rec, (body as { endorse: unknown }).endorse, actor);
  const b = (body ?? {}) as Record<string, unknown>, text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 300) : v);
  const passport = {
    id: `CP-${randomBytes(4).toString('hex')}`, reason: typeof b.reason === 'string' ? scrubText(b.reason.trim().slice(0, 300)) : b.reason, linkId: text(b.linkId), from: text(b.from), until: text(b.until) || undefined,
    document: typeof b.document === 'string' ? scrubText(b.document.trim().slice(0, 300)) : b.document, hours: b.hours, states: b.states, ticketBand: b.ticketBand, volumeUplift: b.volumeUplift,
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
  return atomic(() => review(caseId, body, actor));
}

function review(caseId: string, body: unknown, actor: Actor): ApiReply {
  if (!isCaseId(caseId)) return fail(400, 'Invalid case id.');
  const rec = getCase(caseId);
  if (!rec) return fail(404, 'No case with that id.');
  assertCase(caseId);
  if (actor.role !== 'reviewer' && actor.role !== 'admin') return fail(403, 'Only a reviewer or admin can verify a Context Passport.');
  const b = (body ?? {}) as { passportId?: unknown; verify?: unknown };
  const p = rec.result.scenario.passports?.find(x => x.id === b.passportId && x.status === 'SUBMITTED');
  if (!p) return fail(404, 'No passport is waiting with that id.');
  if (typeof b.verify !== 'boolean') return fail(400, 'verify must be true or false.');
  const maker = makerOf(rec, p);
  if (maker && samePerson(maker, actor)) return fail(403, 'A different person must verify this passport.');
  // Rejecting only tightens. Verifying needs two people, and a service key is not one of them.
  if (b.verify && !maker) return fail(409, 'This passport came through the API, so no person has recorded it. Someone must take it on before a different person verifies it.');
  // Submitted under wider limits, or edited since: what is verified must be valid now.
  const invalid = b.verify ? passportErrors(p) : [];
  if (invalid.length) return fail(400, invalid.join(' '));
  const ref = `${caseId}:${p.id}`;
  if (b.verify) {
    const merchant = rec.result.scenario.primaryMerchantId;
    const standing = [...verifiedPassports(merchant, rec.client), ...(rec.result.scenario.passports ?? []).filter(x => x.status === 'VERIFIED')];
    const clash = standing.find(x => passportsOverlap(x, p));
    if (clash) return fail(409, `Passport ${clash.id} already covers this QR for part of that period. Revoke it first, or use dates that do not overlap.`);
    // A file chooses its own ids, so a later passport can reuse one that is already registered.
    if ((getDb().prepare('SELECT passport_json FROM passports WHERE merchant_id = ?').all(merchant) as { passport_json: string }[]).some(r => (JSON.parse(r.passport_json) as ContextPassport).id === p.id)) p.id = `${p.id}-${randomBytes(3).toString('hex')}`;
    p.ref = ref;
    p.client = rec.client;
  }
  p.status = b.verify ? 'VERIFIED' : 'REJECTED';
  p.reviewedBy = actor.username;
  const before = rec.result.fusion;
  let dropped: string[] = [];
  if (b.verify) {
    sealedWrite('passports', ref, () => getDb().prepare('INSERT INTO passports (id, case_id, merchant_id, passport_json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET passport_json = excluded.passport_json')
      .run(ref, caseId, rec.result.scenario.primaryMerchantId, JSON.stringify(p)));
    dropped = rescore(rec);
  }
  putCase(rec);
  const f = rec.result.fusion;
  appendAudit(caseId, [{ action: `Context Passport ${p.id} ${p.status.toLowerCase()}`, detail: b.verify ? `Re-scored: ${before.decision}/${before.followUp} P ${before.posterior.toFixed(4)} → ${f.decision}/${f.followUp} P ${f.posterior.toFixed(4)}${rec.result.passportsSuspended ? ' · not applied: a conduct signal fired' : ''}${dropped.length ? ` · proposals withdrawn by the re-score: ${dropped.join(', ')}` : ''}` : 'No change to the score.' }], actor);
  return getInvestigation(caseId);
}

/** An analyst takes on a passport that arrived through the API, and is from then on its maker. */
function endorsePassport(rec: CaseRecord, passportId: unknown, actor: Actor): ApiReply {
  const p = rec.result.scenario.passports?.find(x => x.id === passportId && x.status === 'SUBMITTED');
  if (!p) return fail(404, 'No passport is waiting with that id.');
  if (makerOf(rec, p)) return fail(409, 'A person has already recorded this passport.');
  p.submittedBy = actor.username;
  putCase(rec);
  appendAudit(rec.id, [{ action: `Context Passport ${p.id} taken on`, detail: `${actor.username} is now its maker. A different person must verify it.` }], actor);
  return getInvestigation(rec.id);
}

/**
 * One reviewer can revoke at once: revoking only brings a question back, and can neither open a case by itself nor
 * restrict anything. Every case that used the passport is scored again. Reinstating it takes two people.
 */
export function revokePassport(caseId: string, body: unknown, actor: Actor): ApiReply {
  return atomic(() => revoke(caseId, body, actor));
}

function revoke(caseId: string, body: unknown, actor: Actor): ApiReply {
  if (!isCaseId(caseId)) return fail(400, 'Invalid case id.');
  const rec = getCase(caseId);
  if (!rec) return fail(404, 'No case with that id.');
  assertCase(caseId);
  if (actor.role !== 'reviewer' && actor.role !== 'admin') return fail(403, 'Only a reviewer or admin can revoke a Context Passport.');
  const b = (body ?? {}) as { passportId?: unknown; reason?: unknown };
  const found = rec.result.scenario.passports?.find(x => x.id === b.passportId && x.status === 'VERIFIED');
  if (!found) return fail(404, 'No verified passport has that id.');
  const reason = typeof b.reason === 'string' ? scrubText(b.reason.trim().slice(0, 500)) : '';
  if (!reason) return fail(400, 'A reason is required to revoke a passport.');

  assertRows('passports', rec.result.scenario.primaryMerchantId);
  const target = { ...found }, ref = target.ref ?? `${caseId}:${target.id}`, db = getDb();
  const row = db.prepare('SELECT passport_json FROM passports WHERE id = ?').get(ref) as { passport_json: string } | undefined;
  if (row) sealedWrite('passports', ref, () => db.prepare('UPDATE passports SET passport_json = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(row.passport_json), status: 'REVOKED', revokedBy: actor.username }), ref));
  for (const { id } of merchantCases(rec.result.scenario.primaryMerchantId)) {
    const c = getCase(id)!;
    const hit = (c.result.scenario.passports ?? []).filter(x => x.status === 'VERIFIED' && (x.ref ? x.ref === ref : sameTerms(x, target)));
    if (!hit.length) continue;
    for (const x of hit) Object.assign(x, { status: 'REVOKED', revokedBy: actor.username });
    let detail: string;
    if (c.result.passportsSuspended) {
      c.result.passportsSuspended = passportsInForce(c.result.scenario).length > 0;
      detail = 'It was not being applied, so the score is unchanged.';
    } else {
      const old = c.result, before = old.fusion, dropped = rescore(c);
      const weight = (x: typeof before) => (x.decision === 'OPEN_CASE' ? 2 : x.followUp === 'ASK' ? 1 : 0);
      // One person revokes, so revoking may raise scrutiny and never lower it, even if the rules changed since.
      if (weight(c.result.fusion) < weight(before)) c.result = { ...old, scenario: c.result.scenario };
      const f = c.result.fusion;
      if (weight(f) > weight(before)) {
        // The question is back, so whatever closed it while it was answered no longer does.
        if (c.user.label && c.user.label !== 'CONFIRMED_ILLICIT') {
          if (merchantLabel(c.result.scenario.primaryMerchantId) === c.user.label) clearLabelEvents(c.result.scenario.primaryMerchantId);
          c.user.label = null;
        }
        if (c.inForce && ['L0', 'L1', 'L2'].includes(c.inForce.plan.level)) {
          c.inForce = null;
          c.response = null;
          c.user.executed = false;
          c.user.chosenLevel = null;
        }
      }
      detail = `Re-scored: ${before.decision}/${before.followUp} → ${f.decision}/${f.followUp}.${dropped.length ? ` Proposals withdrawn by the re-score: ${dropped.join(', ')}.` : ''}`;
    }
    putCase(c);
    appendAudit(id, [{ action: `Context Passport ${target.id} revoked`, detail: id === caseId ? `${reason}. ${detail}` : detail }], actor);
  }
  return getInvestigation(caseId);
}
