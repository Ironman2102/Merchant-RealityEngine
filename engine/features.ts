/** Model columns computed by the TypeScript engine so a later Python model cannot drift from these numbers. */
import { DETECTORS } from '../frontend/src/engines/detectors';
import type { InvestigationResult } from '../frontend/src/types/investigation';
import type { CoverageKey } from '../frontend/src/types/merchant';
import { benford, payerConcentration, repeatPayers, timing } from './fraudMath';

const COVERAGE: CoverageKey[] = ['acquiring', 'website', 'orders', 'bank', 'fulfillment', 'calendar', 'verification'];

export const FEATURE_COLUMNS: string[] = [
  ...DETECTORS.flatMap(d => [`llr_${d.id}`, `eff_${d.id}`, `fired_${d.id}`, `unk_${d.id}`]),
  'posterior', 'prior', 'logodds_total',
  ...COVERAGE.map(k => `cov_${k}`),
  'n_sales', 'account_age_days',
];

/** Leakage-free behavioral feature columns for independent ML training (no posterior/prior/logodds/coverage/age shortcuts). */
export const BEHAVIORAL_FEATURE_COLUMNS: string[] = [
  ...DETECTORS.flatMap(d => [`llr_${d.id}`, `eff_${d.id}`, `fired_${d.id}`]),
  'n_sales',
  'night_share', 'weekend_share', 'refund_ratio', 'payer_hhi', 'ticket_cv', 'sweep_lag_median_h',
  // Fraud-detection statistics (engine/fraudMath.ts).
  'benford_chi2_per_n', 'benford_p', 'benford_mad',
  'daily_dispersion', 'gap_burstiness', 'gap_cv',
  'payer_entropy', 'payer_gini',
  'returning_share', 'repeat_gap_cv',
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
  const sales = [], refunds = [], settlements = [], transfers = [];
  for (const e of result.events) {
    if (e.type === 'SALE') sales.push(e);
    else if (e.type === 'REFUND') refunds.push(e);
    else if (e.type === 'SETTLEMENT') settlements.push(e.eventTime);
    else if (e.type === 'TRANSFER') transfers.push(e.eventTime);
  }
  row.n_sales = sales.length;
  const IST = 19_800_000;
  let night = 0, weekend = 0, sum = 0;
  const payerCounts = new Map<string, number>();
  for (const s of sales) {
    const d = new Date(s.eventTime + IST);
    const h = d.getUTCHours(), wd = d.getUTCDay();
    if (h >= 23 || h < 6) night++;
    if (wd === 0 || wd === 6) weekend++;
    sum += s.amount;
    if (s.payerHash) payerCounts.set(s.payerHash, (payerCounts.get(s.payerHash) ?? 0) + 1);
  }
  row.night_share = sales.length ? night / sales.length : 0;
  row.weekend_share = sales.length ? weekend / sales.length : 0;
  row.refund_ratio = sales.length ? refunds.length / sales.length : 0;
  let hhi = 0;
  if (sales.length) for (const c of payerCounts.values()) hhi += (c / sales.length) ** 2;
  row.payer_hhi = hhi;
  const mean = sales.length ? sum / sales.length : 0;
  const variance = sales.length && mean > 0 ? sales.reduce((s, e) => s + (e.amount - mean) ** 2, 0) / sales.length : 0;
  row.ticket_cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

  // Benford first-digit test, payment timing, payer concentration and repeat-payer regularity.
  const bf = benford(sales.map(s => s.amount));
  row.benford_chi2_per_n = bf.chi2PerN; row.benford_p = bf.p; row.benford_mad = bf.mad;
  const tm = timing(sales.map(s => s.eventTime), IST);
  row.daily_dispersion = tm.dispersion; row.gap_burstiness = tm.burstiness; row.gap_cv = tm.gapCv;
  const pc = payerConcentration([...payerCounts.values()]);
  row.payer_entropy = pc.entropy; row.payer_gini = pc.gini;
  const byPayer = new Map<string, number[]>();
  for (const s of sales) if (s.payerHash) (byPayer.get(s.payerHash) ?? byPayer.set(s.payerHash, []).get(s.payerHash)!).push(s.eventTime);
  const rp = repeatPayers(byPayer);
  row.returning_share = rp.returningShare; row.repeat_gap_cv = rp.repeatGapCv;

  // Median hours from settlement to next onward payout (capped at 72 h if un-swept or missing).
  let sweepLagMedian = 72;
  if (settlements.length && transfers.length) {
    transfers.sort((a, b) => a - b);
    const lagsH: number[] = [];
    for (const st of settlements) {
      let lo = 0, hi = transfers.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (transfers[mid] < st) lo = mid + 1; else hi = mid; }
      if (lo < transfers.length) {
        const h = (transfers[lo] - st) / 3_600_000;
        if (h >= 0 && h <= 72) lagsH.push(h);
      }
    }
    if (lagsH.length) {
      lagsH.sort((a, b) => a - b);
      const m = Math.floor(lagsH.length / 2);
      sweepLagMedian = lagsH.length % 2 ? lagsH[m] : (lagsH[m - 1] + lagsH[m]) / 2;
    }
  }
  row.sweep_lag_median_h = sweepLagMedian;
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
