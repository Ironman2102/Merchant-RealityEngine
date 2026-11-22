/**
 * Evidence pack body. The server adds the hash-chained audit and its verification after this returns.
 * Draft for a Principal Officer: filing happens on FIU-IND's portal, in its format.
 */
import type { InvestigationResult } from '../frontend/src/types/investigation';
import { buildTrace } from '../frontend/src/engines/traceEngine';
import { templateSummary } from './summary';
import { extent } from '../frontend/src/utils/num';

export interface PackMeta {
  caseId: string | null;
  createdAt: string;
  datasetSha256: string;
  /** What exactly was hashed. */
  hashBasis?: string;
  generatedBy: string | { username: string; role: string } | null;
  reportingEntity?: string;
  engineVersion?: string | null;
  /** Audit seqs already recorded, so the human-oversight clause can cite them. */
  oversightEvidence?: string[];
  actionTaken?: unknown[];
  label?: string | null;
  analystNotes?: string;
}

function who(generatedBy: PackMeta['generatedBy']): { username: string; role: string } | null {
  if (!generatedBy) return null;
  if (typeof generatedBy === 'string') return { username: generatedBy, role: 'service' };
  return generatedBy;
}

export function buildPack(result: InvestigationResult, meta: PackMeta): Record<string, unknown> {
  const t = buildTrace(result);
  const p = result.scenario.profile;
  const sales = result.events.filter(e => e.type === 'SALE');
  const sum = (type: string) => {
    const xs = result.events.filter(e => e.type === type);
    return { count: xs.length, value: xs.reduce((s, e) => s + e.amount, 0) };
  };
  const times = extent(result.events, e => e.eventTime);
  const fired = t.detectors.filter(d => d.status === 'ILLICIT').sort((a, b) => b.llr - a.llr);
  const author = who(meta.generatedBy);
  return {
    packVersion: 'mre-evidence-pack/1',
    generatedAt: new Date().toISOString(),
    generatedBy: author,
    case: {
      id: meta.caseId,
      createdAt: meta.createdAt,
      datasetSha256: meta.datasetSha256,
      datasetHashBasis: meta.hashBasis ?? 'SHA-256 of the uploaded dataset as received (JSON).',
      rulesVersion: result.fusion.rulesVersion,
      engineVersion: meta.engineVersion ?? null,
    },
    summary: templateSummary(t),
    regulatoryMapping: [
      {
        requirement: 'RBI Master Direction on Regulation of Payment Aggregators: monitor transactions subsequently undertaken by merchants to ensure they are in line with the merchant\'s business profile.',
        howMet: 'Each detector compares the merchant\'s transactions with the norm for its category (rules/mcc.json), the festival/match calendar or an independent source, and reports the test, p-value, effect size and expectation used.',
        evidence: t.detectors.filter(d => d.status !== 'UNKNOWN').map(d => d.id),
      },
      {
        requirement: 'Human oversight of automated decisions (maker/checker).',
        howMet: 'Restricting a flow needs a second reviewer; holding funds or terminating needs a different user with the legal role; a confirmed-illicit label needs two people. Every step is in the hash-chained audit trail below.',
        evidence: meta.oversightEvidence ?? [],
      },
      {
        requirement: 'PMLA / FIU-IND: report suspicious transactions.',
        howMet: 'Draft STR facts below, for the Principal Officer to review and file on FIU-IND\'s portal.',
        evidence: fired.map(d => d.id),
      },
    ],
    scope: result.scope,
    streams: result.streams,
    contextPassports: result.scenario.passports ?? [],
    contextPassportsAnswered: result.passportAnswered ?? [],
    contextPassportsSuspended: result.passportsSuspended ?? false,
    confidentiality: 'Internal. Do not share this pack, its reasons or the fact of any report with the merchant.',
    strDraft: {
      status: 'DRAFT: review by the Principal Officer before filing on FIU-IND\'s portal',
      reportingEntity: meta.reportingEntity ?? '(set MRE_ENTITY_NAME)',
      subject: { merchantId: p.id, name: p.name, category: `${p.category} (MCC ${p.mcc})`, city: p.city, accountAgeDays: p.accountAgeDays },
      period: {
        from: times ? new Date(times[0]).toISOString() : null,
        to: times ? new Date(times[1]).toISOString() : null,
      },
      transactionSummary: {
        sales: sum('SALE'), refunds: sum('REFUND'), settlements: sum('SETTLEMENT'), payouts: sum('TRANSFER'),
        distinctPayers: new Set(sales.map(s => s.payerHash)).size,
      },
      groundsOfSuspicion: [
        t.gate.reason,
        ...fired.slice(0, 6).map(d => `${d.id} ${d.name}: ${d.observed} (expected ${d.expected}; ${d.test}${d.p !== null ? `; p = ${d.p.toExponential(2)}` : ''}).`),
      ],
      probability: { posterior: t.caseSummary.posterior, interval90: t.caseSummary.ci, baseRate: t.caseSummary.prior, leadingMechanism: t.caseSummary.mechanism },
      actionTaken: meta.actionTaken ?? [],
      label: meta.label ?? null,
      analystNotes: meta.analystNotes ?? '',
    },
    trace: t,
    limits: [
      'Category norms and detector sensitivities are expert priors until calibrated on labelled cases.',
      'Probabilities assume evidence families are independent given the truth; correlated families are shrunk but not removed.',
      'Payer and beneficiary identifiers are keyed pseudonyms; the PA holds the key to re-identify.',
      'Betting that copies a shop\'s amounts, hours, locations and payer mix cannot be found from payment data alone.',
    ],
  };
}
