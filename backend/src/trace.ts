/**
 * Server views built from a stored case: the reasoning trace and the evidence pack.
 * The evidence pack maps the case to the RBI Payment Aggregator Master Direction duty to monitor merchant
 * transactions against the business profile, and pre-fills the facts an FIU-IND STR needs. It is a DRAFT for
 * the Principal Officer: filing happens on FIU-IND's own portal, in its format.
 */
import { buildTrace } from '../../frontend/src/engines/traceEngine';
import { appendAudit, getCase, isCaseId, readAudit, verifyAudit } from './store';
import type { ApiReply } from './workflow';
import type { Actor } from './auth';
import { templateSummary } from './llm';

const fail = (status: number, error: string): ApiReply => ({ status, body: { error } });

export function caseTrace(id: string): ApiReply {
  if (!isCaseId(id)) return fail(400, 'Invalid case id.');
  const rec = getCase(id);
  return rec ? { status: 200, body: buildTrace(rec.result) as unknown as Record<string, unknown> } : fail(404, 'No case with that id.');
}

export function evidencePack(id: string, actor: Actor): ApiReply {
  if (!isCaseId(id)) return fail(400, 'Invalid case id.');
  const rec = getCase(id);
  if (!rec) return fail(404, 'No case with that id.');
  const r = rec.result, t = buildTrace(r), p = r.scenario.profile, sales = r.events.filter(e => e.type === 'SALE');
  const sum = (type: string) => { const xs = r.events.filter(e => e.type === type); return { count: xs.length, value: xs.reduce((s, e) => s + e.amount, 0) }; };
  const times = r.events.map(e => e.eventTime);
  const fired = t.detectors.filter(d => d.status === 'ILLICIT').sort((a, b) => b.llr - a.llr);
  appendAudit(id, [{ action: 'Evidence pack exported', detail: `By ${actor.username} (${actor.role})` }], actor);
  const audit = readAudit(id);
  return {
    status: 200,
    body: {
      packVersion: 'mre-evidence-pack/1',
      generatedAt: new Date().toISOString(), generatedBy: { username: actor.username, role: actor.role },
      case: { id: rec.id, createdAt: rec.createdAt, datasetSha256: rec.datasetSha256, rulesVersion: r.fusion.rulesVersion, engineVersion: rec.engineVersion },
      summary: templateSummary(t),
      regulatoryMapping: [
        { requirement: 'RBI Master Direction on Regulation of Payment Aggregators: monitor transactions subsequently undertaken by merchants to ensure they are in line with the merchant\'s business profile.',
          howMet: 'Each detector compares the merchant\'s transactions with the norm for its category (rules/mcc.json), the festival/match calendar or an independent source, and reports the test, p-value, effect size and expectation used.',
          evidence: t.detectors.filter(d => d.status !== 'UNKNOWN').map(d => d.id) },
        { requirement: 'Human oversight of automated decisions (maker/checker).',
          howMet: 'Restricting a flow needs a second reviewer; holding funds or terminating needs a different user with the legal role; a confirmed-illicit label needs two people. Every step is in the hash-chained audit trail below.',
          evidence: audit.filter(a => /proposed|approved|Approved by|Label/.test(a.action + a.detail)).map(a => `#${a.seq}`) },
        { requirement: 'PMLA / FIU-IND: report suspicious transactions.', howMet: 'Draft STR facts below, for the Principal Officer to review and file on FIU-IND\'s portal.', evidence: fired.map(d => d.id) },
      ],
      strDraft: {
        status: 'DRAFT: review by the Principal Officer before filing on FIU-IND\'s portal',
        reportingEntity: process.env.MRE_ENTITY_NAME ?? '(set MRE_ENTITY_NAME)',
        subject: { merchantId: p.id, name: p.name, category: `${p.category} (MCC ${p.mcc})`, city: p.city, accountAgeDays: p.accountAgeDays },
        period: { from: times.length ? new Date(Math.min(...times)).toISOString() : null, to: times.length ? new Date(Math.max(...times)).toISOString() : null },
        transactionSummary: { sales: sum('SALE'), refunds: sum('REFUND'), settlements: sum('SETTLEMENT'), payouts: sum('TRANSFER'), distinctPayers: new Set(sales.map(s => s.payerHash)).size },
        groundsOfSuspicion: [t.gate.reason, ...fired.slice(0, 6).map(d => `${d.id} ${d.name}: ${d.observed} (expected ${d.expected}; ${d.test}${d.p !== null ? `; p = ${d.p.toExponential(2)}` : ''}).`)],
        probability: { posterior: t.caseSummary.posterior, interval90: t.caseSummary.ci, baseRate: t.caseSummary.prior, leadingMechanism: t.caseSummary.mechanism },
        actionTaken: rec.user.executed && rec.response ? rec.response.actions : [],
        label: rec.user.label, analystNotes: rec.user.notes,
      },
      trace: t,
      audit: audit.map(({ seq, at, actor: who, action, detail, prevHash, hash }) => ({ seq, at, actor: who, action, detail, prevHash, hash })),
      auditVerification: verifyAudit(id),
      limits: [
        'Category norms and detector sensitivities are expert priors until calibrated on labelled cases.',
        'Probabilities assume evidence families are independent given the truth; correlated families are shrunk but not removed.',
        'Payer and beneficiary identifiers are keyed pseudonyms; the PA holds the key to re-identify.',
      ],
    },
  };
}
