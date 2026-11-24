/** Model columns computed by the TypeScript engine so a later Python model cannot drift from these numbers. */
import { DETECTORS } from '../frontend/src/engines/detectors';
import type { InvestigationResult } from '../frontend/src/types/investigation';
import type { CoverageKey } from '../frontend/src/types/merchant';

const COVERAGE: CoverageKey[] = ['acquiring', 'website', 'orders', 'bank', 'fulfillment', 'calendar', 'verification'];

export const FEATURE_COLUMNS: string[] = [
  ...DETECTORS.flatMap(d => [`llr_${d.id}`, `eff_${d.id}`, `fired_${d.id}`, `unk_${d.id}`]),
  'posterior', 'prior', 'logodds_total',
  ...COVERAGE.map(k => `cov_${k}`),
  'n_sales', 'account_age_days',
];

/** Leakage-free behavioral feature columns for independent ML training (no posterior/prior/logodds/coverage shortcuts). */
export const BEHAVIORAL_FEATURE_COLUMNS: string[] = [
  ...DETECTORS.flatMap(d => [`llr_${d.id}`, `eff_${d.id}`, `fired_${d.id}`]),
  'n_sales', 'account_age_days',
  'night_share', 'refund_ratio', 'payer_hhi', 'ticket_cv',
];

export function behavioralFeatures(result: InvestigationResult): Record<string, number> {
  const byId = new Map(result.evidence.map(e => [e.id, e]));
  const row: Record<string, number> = {};
  for (const d of DETECTORS) {
    const e = byId.get(d.id);
    row[`llr_${d.id}`] = e?.llr ?? 0;
    row[`eff_${d.id}`] = e?.effect ?? 0;
    row[`fired_${d.id}`] = e?.status === 'ILLICIT' ? 1 : 0;
  }
  const sales = result.events.filter(e => e.type === 'SALE');
  const refunds = result.events.filter(e => e.type === 'REFUND');
  row.n_sales = sales.length;
  row.account_age_days = result.scenario.profile.accountAgeDays;
  const night = sales.filter(e => { const h = new Date(e.eventTime).getHours(); return h >= 23 || h < 6; }).length;
  row.night_share = sales.length ? night / sales.length : 0;
  row.refund_ratio = sales.length ? refunds.length / sales.length : 0;
  const payerCounts = new Map<string, number>();
  for (const s of sales) if (s.payerHash) payerCounts.set(s.payerHash, (payerCounts.get(s.payerHash) ?? 0) + 1);
  let hhi = 0;
  if (sales.length) for (const c of payerCounts.values()) hhi += (c / sales.length) ** 2;
  row.payer_hhi = hhi;
  const mean = sales.length ? sales.reduce((s, e) => s + e.amount, 0) / sales.length : 0;
  const variance = sales.length && mean > 0 ? sales.reduce((s, e) => s + (e.amount - mean) ** 2, 0) / sales.length : 0;
  row.ticket_cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  return row;
}

export function features(result: InvestigationResult): Record<string, number> {
  const byId = new Map(result.evidence.map(e => [e.id, e]));
  const row: Record<string, number> = {};
  for (const d of DETECTORS) {
    const e = byId.get(d.id);
    row[`llr_${d.id}`] = e?.llr ?? 0;
    row[`eff_${d.id}`] = e?.effect ?? 0;
    row[`fired_${d.id}`] = e?.status === 'ILLICIT' ? 1 : 0;
    row[`unk_${d.id}`] = e?.status === 'UNKNOWN' ? 1 : 0;
  }
  row.posterior = result.fusion.posterior;
  row.prior = result.fusion.prior;
  row.logodds_total = result.fusion.logOdds.total;
  for (const k of COVERAGE) row[`cov_${k}`] = result.scenario.coverage[k] === 'MISSING' ? 0 : 1;
  row.n_sales = result.events.filter(e => e.type === 'SALE').length;
  row.account_age_days = result.scenario.profile.accountAgeDays;
  return row;
}
