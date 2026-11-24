/** Batch PSI (Population Stability Index) & detector false-positive calibration drift monitor. */
import type { InvestigationResult } from '../frontend/src/types/investigation';
import { RULES } from '../rules/index';

export interface DetectorDrift {
  id: string;
  name: string;
  clearedEvaluated: number;
  observedFireRate: number;
  priorFalsePositive: number;
  ratio: number;
}

export interface DriftReport {
  n: number;
  psi: number;
  psiStatus: 'OK' | 'MODERATE' | 'SIGNIFICANT';
  abstainCount: number;
  abstainShare: number;
  detectorDrifts: DetectorDrift[];
}

// Reference bin shares across [0,0.05), [0.05,0.2), [0.2,0.5), [0.5,0.8), [0.8,1.0] (1k synthetic portfolio calibration).
const REF_BINS = [0.88, 0.04, 0.02, 0.02, 0.04];

function binOf(p: number): number {
  if (p < 0.05) return 0;
  if (p < 0.2) return 1;
  if (p < 0.5) return 2;
  if (p < 0.8) return 3;
  return 4;
}

export function computeBatchDrift(results: readonly InvestigationResult[]): DriftReport {
  const n = results.length;
  if (!n) {
    return { n: 0, psi: 0, psiStatus: 'OK', abstainCount: 0, abstainShare: 0, detectorDrifts: [] };
  }

  const counts = [0, 0, 0, 0, 0];
  let abstainCount = 0;
  const fpStats = new Map<string, { name: string; total: number; fired: number }>();

  for (const r of results) {
    counts[binOf(r.fusion.posterior)]++;
    if (r.fusion.abstainRecommended) abstainCount++;
    if (r.fusion.decision === 'NO_CASE') {
      for (const e of r.evidence) {
        if (e.status === 'UNKNOWN') continue;
        const row = fpStats.get(e.id) ?? { name: e.name, total: 0, fired: 0 };
        row.total++;
        if (e.status === 'ILLICIT') row.fired++;
        fpStats.set(e.id, row);
      }
    }
  }

  let psi = 0;
  for (let i = 0; i < 5; i++) {
    const act = Math.max(1e-4, counts[i] / n);
    const ref = Math.max(1e-4, REF_BINS[i]);
    psi += (act - ref) * Math.log(act / ref);
  }
  const psiStatus: DriftReport['psiStatus'] = psi >= 0.25 ? 'SIGNIFICANT' : psi >= 0.1 ? 'MODERATE' : 'OK';

  const detectorDrifts: DetectorDrift[] = [];
  for (const [id, s] of fpStats) {
    if (s.total < 5) continue;
    const priorFp = RULES.detector(id).falsePositive;
    const obs = s.fired / s.total;
    const ratio = obs / Math.max(1e-4, priorFp);
    if (ratio >= 2 || obs - priorFp >= 0.05) {
      detectorDrifts.push({ id, name: s.name, clearedEvaluated: s.total, observedFireRate: obs, priorFalsePositive: priorFp, ratio });
    }
  }
  detectorDrifts.sort((a, b) => b.ratio - a.ratio);

  return {
    n,
    psi,
    psiStatus,
    abstainCount,
    abstainShare: abstainCount / n,
    detectorDrifts: detectorDrifts.slice(0, 6),
  };
}
