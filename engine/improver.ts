/** Propose a rules change inside pre-set bands. It never applies the change. */
import { datasetToScenario } from '../frontend/src/data/dataset';
import { runInvestigation } from '../frontend/src/engines/investigationEngine';
import type { Scenario } from '../frontend/src/types/merchant';
import { RULES, withDetectorOverrides, type DetectorCfg, type RulePatch } from '../rules/index';
import type { LearnedRate } from './learnedRates';
import { makeSuite, type SyntheticMerchant } from './synthetic';

export interface Metrics { recall: number; recallCi: [number, number]; fp: number; fpCi: [number, number]; tp: number; fpCount: number; nFront: number; nGenuine: number }
export interface Proposal {
  id: string;
  createdAt: string;
  createdBy: 'mre-improver' | string;
  patch: RulePatch;
  kind: 'threshold' | 'calibration';
  rationale: string;
  /** Measured on a holdout that played no part in choosing the patch. */
  backtest: { champion: Metrics; challenger: Metrics; mcnemarP: number };
  status: 'proposed' | 'approved' | 'rejected' | 'shadow' | 'live' | 'rolled_back';
}

export function bandOf(id: string): { minEffect: [number, number]; alpha: [number, number]; minN: [number, number]; sensitivity: [number, number]; falsePositive: [number, number] } {
  // Bands hang off the committed rule, so repeated small changes cannot walk out of them.
  const c = RULES.baseDetector(id), B = RULES.engine.bands;
  return {
    minEffect: [c.minEffect * 0.6, c.minEffect * 1.4],
    alpha: [B.alpha[0], B.alpha[1]],
    minN: [B.minN[0], Math.max(B.minN[1], c.minN)],
    sensitivity: [B.sensitivity[0], B.sensitivity[1]],
    falsePositive: [B.falsePositive[0], B.falsePositive[1]],
  };
}

export function insideBand(id: string, patch: RulePatch[string]): boolean {
  const b = bandOf(id);
  return (Object.keys(patch) as (keyof typeof b & keyof DetectorCfg)[]).every(k => {
    const v = patch[k as keyof typeof patch], band = b[k];
    return v === undefined || (!!band && v >= band[0] && v <= band[1]);
  });
}

function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 1];
  const p = k / n, den = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / den;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / den;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

function binom(n: number, k: number): number {
  let c = 1;
  for (let i = 0; i < k; i++) c = c * (n - i) / (i + 1);
  return c;
}

/** Exact McNemar on paired decisions for distinct merchants. */
export function mcnemarExact(before: boolean[], after: boolean[]): number {
  let lost = 0, gained = 0;
  before.forEach((b, i) => { if (b && !after[i]) lost++; if (!b && after[i]) gained++; });
  const n = lost + gained;
  if (!n) return 1;
  let tail = 0;
  for (let i = 0; i <= Math.min(lost, gained); i++) tail += binom(n, i);
  return Math.min(1, 2 * tail / 2 ** n);
}

interface Run { metrics: Metrics; caught: boolean[] }
const parsed = new WeakMap<SyntheticMerchant, Scenario | null>();
function opens(m: SyntheticMerchant): boolean {
  if (!parsed.has(m)) parsed.set(m, datasetToScenario(m.dataset).scenario ?? null);
  const sc = parsed.get(m);
  return !!sc && runInvestigation(sc, { draws: 0 }).fusion.gatePassed;
}
function evaluate(suite: SyntheticMerchant[], patch?: RulePatch): Run {
  const score = () => suite.map(opens);
  const opened = patch ? withDetectorOverrides(patch, score) : score();
  const caught = opened.filter((_, i) => suite[i].label === 1), alarms = opened.filter((o, i) => o && suite[i].label === 0).length;
  const tp = caught.filter(Boolean).length, nGenuine = suite.length - caught.length;
  return {
    caught,
    metrics: {
      recall: caught.length ? tp / caught.length : 0, recallCi: wilson(tp, caught.length),
      fp: nGenuine ? alarms / nGenuine : 0, fpCi: wilson(alarms, nGenuine),
      tp, fpCount: alarms, nFront: caught.length, nGenuine,
    },
  };
}

/** Honest merchants first: a candidate that adds even one false alarm is out, without scoring the rest. */
function screen(suite: SyntheticMerchant[], patch: RulePatch, maxAlarms: number): number | null {
  return withDetectorOverrides(patch, () => {
    let alarms = 0, tp = 0;
    for (const m of suite) if (m.label === 0 && opens(m) && ++alarms > maxAlarms) return null;
    for (const m of suite) if (m.label === 1 && opens(m)) tp++;
    return tp;
  });
}

/** A patch is chosen on one suite and judged on another. Both hold thin and ordinary merchants, honest and not. */
export const designSuite = (): SyntheticMerchant[] => [...makeSuite(5, 301, { volume: 0.09 }), ...makeSuite(2, 302)];
export const holdoutSuite = (): SyntheticMerchant[] => [...makeSuite(6, 401, { volume: 0.09 }), ...makeSuite(2, 402)];

export interface Attempt { proposal: Proposal | null; reason: string; backtest?: Proposal['backtest'] }

function judgeOnHoldout(patch: RulePatch, kind: Proposal['kind'], rationale: string, holdout: SyntheticMerchant[]): Attempt {
  const champ = evaluate(holdout), chal = evaluate(holdout, patch);
  const backtest = { champion: champ.metrics, challenger: chal.metrics, mcnemarP: mcnemarExact(champ.caught, chal.caught) };
  if (chal.metrics.fpCount > champ.metrics.fpCount) return { proposal: null, backtest, reason: `Rejected on the holdout: false alarms would rise from ${champ.metrics.fpCount} to ${chal.metrics.fpCount} of ${champ.metrics.nGenuine} honest merchants.` };
  if (chal.metrics.tp < champ.metrics.tp) return { proposal: null, backtest, reason: `Rejected on the holdout: it would catch ${chal.metrics.tp} fronts, down from ${champ.metrics.tp}.` };
  if (kind === 'threshold' && !(chal.metrics.tp > champ.metrics.tp && backtest.mcnemarP < 0.05)) return { proposal: null, backtest, reason: `Rejected on the holdout: the gain (${champ.metrics.tp} to ${chal.metrics.tp} fronts) is not significant (McNemar p = ${backtest.mcnemarP.toFixed(3)}).` };
  return {
    backtest, reason: 'Passed the holdout.',
    proposal: { id: `prop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, createdAt: new Date().toISOString(), createdBy: 'mre-improver', kind, patch, rationale, backtest, status: 'proposed' },
  };
}

/** Thin accounts hide below minN. Try lowering it, and keep the change only if honest thin accounts survive it too. */
export function propose(design = designSuite(), holdoutOverride?: SyntheticMerchant[]): Attempt {
  const champion = evaluate(design).metrics;
  let best: { patch: RulePatch; tp: number } | null = null;
  for (const ids of [['A1', 'A4', 'B6', 'H3', 'B8', 'B10'], ['A4', 'B6', 'B8', 'B10'], ['B8', 'B10']]) {
    for (const minN of [20, 12, 8]) {
      const patch: RulePatch = {};
      for (const id of ids) if (minN < RULES.detector(id).minN && insideBand(id, { minN })) patch[id] = { minN };
      if (!Object.keys(patch).length) continue;
      const tp = screen(design, patch, champion.fpCount);
      if (tp !== null && tp > (best?.tp ?? champion.tp)) best = { patch, tp };
    }
  }
  if (!best) return { proposal: null, reason: 'No in-band threshold caught more fronts without adding false alarms on the design suite.' };
  return judgeOnHoldout(best.patch, 'threshold', 'Thin accounts sit below the minimum sample size, so their tests return UNKNOWN. This lowers the minimum, inside its band.', holdoutOverride ?? holdoutSuite());
}

/** Labels never change a score directly. They produce a calibration that passes the same backtest and approval. */
export function proposeCalibration(rates: LearnedRate[], holdout = holdoutSuite()): Attempt {
  const min = RULES.engine.learning.minLabels, round = (x: number) => Math.round(x * 10000) / 10000, patch: RulePatch = {};
  for (const r of rates) {
    const p: RulePatch[string] = {};
    if (r.nPos >= min) p.sensitivity = round(r.sensitivity);
    if (r.nNeg >= min) p.falsePositive = round(r.falsePositive);
    if (Object.keys(p).length && insideBand(r.detectorId, p)) patch[r.detectorId] = p;
  }
  if (!Object.keys(patch).length) return { proposal: null, reason: `Not enough labels yet: a detector needs ${min} different merchants with the same label.` };
  return judgeOnHoldout(patch, 'calibration', 'Detector hit and false-alarm rates re-estimated from adjudicated labels.', holdout);
}
