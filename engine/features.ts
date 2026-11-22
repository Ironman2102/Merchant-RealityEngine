/** Model columns computed by the TypeScript engine so a later Python model cannot drift from these numbers. */
import { DETECTORS } from '../frontend/src/engines/detectors';
import type { InvestigationResult } from '../frontend/src/types/investigation';

// Account age, the prior and feed availability are deliberately absent: in the first dataset each one leaked the label.

export const FEATURE_COLUMNS: string[] = [
  ...DETECTORS.flatMap(d => [`llr_${d.id}`, `eff_${d.id}`, `fired_${d.id}`, `unk_${d.id}`]),
  'posterior', 'logodds_total', 'n_sales',
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
  row.logodds_total = result.fusion.logOdds.total;
  row.n_sales = result.events.filter(e => e.type === 'SALE').length;
  return row;
}
