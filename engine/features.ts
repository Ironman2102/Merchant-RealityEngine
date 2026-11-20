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
