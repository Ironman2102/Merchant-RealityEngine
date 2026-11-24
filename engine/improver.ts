/** Propose a rules change inside pre-set bands. It never applies the change. */
import type { MreDataset } from '../frontend/src/data/dataset';
import { analyze } from './index';
import { RULES, withDetectorOverrides, type DetectorCfg } from '../rules/index';

export interface Metrics { recall: number; recallCi: [number, number]; fp: number; fpCi: [number, number]; tp: number; fpCount: number; nFront: number; nGenuine: number }
export interface Proposal {
  id: string;
  createdAt: string;
  createdBy: 'mre-improver' | string;
  patch: Record<string, Partial<Pick<DetectorCfg, 'minEffect' | 'alpha' | 'minN'>>>;
  rationale: string;
  backtest: { champion: Metrics; challenger: Metrics; mcnemarP: number };
  status: 'proposed' | 'approved' | 'rejected' | 'shadow' | 'live' | 'rolled_back';
}

export function bandOf(id: string): { minEffect: [number, number]; alpha: [number, number]; minN: [number, number] } {
  const c = RULES.detector(id);
  const declared = (c as DetectorCfg & { bands?: { minEffect?: [number, number]; alpha?: [number, number]; minN?: [number, number] } }).bands;
  return {
    minEffect: declared?.minEffect ?? [c.minEffect * 0.6, c.minEffect * 1.4],
    alpha: declared?.alpha ?? [0.0005, 0.05],
    minN: declared?.minN ?? [8, Math.max(40, c.minN)],
  };
}

export function insideBand(id: string, patch: Partial<Pick<DetectorCfg, 'minEffect' | 'alpha' | 'minN'>>): boolean {
  const b = bandOf(id);
  if (patch.minEffect !== undefined && (patch.minEffect < b.minEffect[0] || patch.minEffect > b.minEffect[1])) return false;
  if (patch.alpha !== undefined && (patch.alpha < b.alpha[0] || patch.alpha > b.alpha[1])) return false;
  if (patch.minN !== undefined && (patch.minN < b.minN[0] || patch.minN > b.minN[1])) return false;
  return true;
}

function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 1];
  const p = k / n, den = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / den;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / den;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

function metrics(fronts: MreDataset[], genuine: MreDataset[], patch?: Proposal['patch']): Metrics {
  const run = (d: MreDataset) => patch ? withDetectorOverrides(patch, () => analyze(d)) : analyze(d);
  let tp = 0, fpCount = 0;
  for (const d of fronts) { const r = run(d); if (r.ok && r.result.fusion.decision === 'OPEN_CASE') tp++; }
  for (const d of genuine) { const r = run(d); if (r.ok && r.result.fusion.decision === 'OPEN_CASE') fpCount++; }
  return {
    recall: fronts.length ? tp / fronts.length : 0, recallCi: wilson(tp, fronts.length),
    fp: genuine.length ? fpCount / genuine.length : 0, fpCi: wilson(fpCount, genuine.length),
    tp, fpCount, nFront: fronts.length, nGenuine: genuine.length,
  };
}

function mcnemar(fronts: MreDataset[], patch: Proposal['patch']): number {
  let b01 = 0, b10 = 0;
  for (const d of fronts) {
    const a = analyze(d);
    const b = withDetectorOverrides(patch, () => analyze(d));
    const ao = a.ok && a.result.fusion.decision === 'OPEN_CASE';
    const bo = b.ok && b.result.fusion.decision === 'OPEN_CASE';
    if (ao && !bo) b01++;
    if (!ao && bo) b10++;
  }
  const n = b01 + b10;
  if (!n) return 1;
  const k = Math.min(b01, b10);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += binom(n, i);
  return Math.min(1, 2 * tail / (2 ** n));
}

function binom(n: number, k: number): number {
  let c = 1;
  for (let i = 0; i < k; i++) c = c * (n - i) / (i + 1);
  return c;
}

/** Dynamically diagnose silenced detectors on red-team evasions and search in-band parameter fixes. */
export function propose(fronts: MreDataset[], genuine: MreDataset[], evasions: MreDataset[]): Proposal | null {
  const silencedCounts = new Map<string, number>();
  const baselineDetectors = new Set<string>();
  for (const f of fronts) {
    const r = analyze(f);
    if (!r.ok) continue;
    for (const e of r.result.evidence) if (e.status === 'ILLICIT') baselineDetectors.add(e.id);
  }
  const targetPool = baselineDetectors.size > 0 ? [...baselineDetectors] : ['A1', 'A4', 'B6', 'H3'];
  for (const ev of evasions) {
    const r = analyze(ev);
    if (!r.ok) continue;
    for (const e of r.result.evidence) {
      if (targetPool.includes(e.id) && e.status !== 'ILLICIT') {
        silencedCounts.set(e.id, (silencedCounts.get(e.id) ?? 0) + 1);
      }
    }
  }
  const rankedSilenced = [...silencedCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);
  const candidates = rankedSilenced.length > 0 ? rankedSilenced : ['A1', 'A4', 'B6', 'H3'];

  const patch: Proposal['patch'] = {};
  for (const id of candidates) {
    const cfg = RULES.detector(id);
    const band = bandOf(id);
    const p: Partial<Pick<DetectorCfg, 'minEffect' | 'alpha' | 'minN'>> = {};
    if (band.minN[0] < cfg.minN && insideBand(id, { minN: band.minN[0] })) p.minN = band.minN[0];
    if (Object.keys(p).length) patch[id] = p;
  }
  if (!Object.keys(patch).length) return null;

  let champion = metrics(evasions, genuine);
  let challenger = metrics(evasions, genuine, patch);
  let mcnemarP = mcnemar(evasions, patch);

  // If minN alone doesn't lift recall enough, also try in-band minEffect floor on silenced detectors
  if (!(challenger.recall > champion.recall && mcnemarP < 0.05)) {
    for (const id of candidates) {
      const cfg = RULES.detector(id);
      const band = bandOf(id);
      if (band.minEffect[0] < cfg.minEffect && insideBand(id, { minEffect: band.minEffect[0] })) {
        patch[id] = { ...patch[id], minEffect: Number(band.minEffect[0].toFixed(4)) };
      }
    }
    challenger = metrics(evasions, genuine, patch);
    mcnemarP = mcnemar(evasions, patch);
  }

  const fpOk = challenger.fpCi[1] <= champion.fpCi[1] + 0.005;
  const recallUp = challenger.recall > champion.recall;
  const significant = mcnemarP < 0.05;
  if (!(fpOk && recallUp && significant)) return null;
  return {
    id: `prop-${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    createdBy: 'mre-improver',
    patch,
    rationale: `Red-team search diagnosed ${Object.keys(patch).join(', ')} as silenced on evasion variants and tuned in-band bounds while clearing the genuine-merchant FP bound.`,
    backtest: { champion, challenger, mcnemarP },
    status: 'proposed',
  };
}
