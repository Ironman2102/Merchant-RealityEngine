/**
 * The reasoning trace: everything needed to check a verdict by hand.
 *  - waterfall: prior → each evidence family → overrides → posterior (log-odds, so steps add)
 *  - detectors: test, statistic, p, effect, CI, n, expectation and its source, weight, source records
 *  - counterfactuals: how P(front) and the action change if one fired signal were absent
 *  - value of information: expected-loss reduction from obtaining each missing feed (pre-posterior analysis):
 *      VOI = EL*(now) − [P(fire)·EL*(after fire) + P(calm)·EL*(after calm)],  P(fire) = P·s + (1 − P)·f
 * Pure function of an InvestigationResult; the server and the browser compute the same trace.
 */
import type { CoverageKey } from '../types/merchant';
import type { EvidenceItem, Family, Mechanism, Provenance } from '../types/evidence';
import type { InvestigationResult, ResponseLevel } from '../types/investigation';
import { RULES } from '../../../rules/index';
import { fuse } from './evidenceFusion';
import { calmLlr, fireLlr, tauOf } from './judge';
import { decide } from './decision';
import { FAMILIES } from '../data/evidence';

export interface TraceStep { label: string; delta: number; cumulative: number; probability: number }
export interface Counterfactual { what: string; posterior: number; action: ResponseLevel; decision: string }
export interface ValueOfInformation { feed: CoverageKey; detector: string; pFire: number; ifFires: number; ifCalm: number; voiRupees: number }
export interface Trace {
  scope: { label: string; sales: number; share: number };
  caseSummary: { merchant: string; mcc: string; decision: string; posterior: number; ci: [number, number]; prior: number; action: ResponseLevel; mechanism: string; mechanismP: number };
  coverage: { name: string; state: string; records: number }[];
  waterfall: TraceStep[];
  detectors: Pick<EvidenceItem, 'id' | 'name' | 'family' | 'status' | 'llr' | 'test' | 'p' | 'effect' | 'effectLabel' | 'ci' | 'n' | 'observed' | 'expected' | 'expectedSource' | 'provenance' | 'records'>[];
  gate: { passed: boolean; reason: string; provenances: { provenance: string; nats: number }[] };
  decision: { reason: string; actions: { level: ResponseLevel; label: string; expectedLoss: number; low: number; high: number; auto: boolean }[] };
  stories: { legit: { label: string; verdict: string; evidence: string[] }[]; front: { label: string; verdict: string; evidence: string[] }[] };
  counterfactuals: Counterfactual[];
  valueOfInformation: ValueOfInformation[];
  versions: { rules: string; engine: string };
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const minLoss = (p: number, open: boolean) => Math.min(...decide(p, [p, p], open).actions.filter(a => a.autoAllowed).map(a => a.expectedLoss));

/** A hypothetical evidence item for a detector whose feed is missing. */
function hypothetical(id: string, fires: boolean): EvidenceItem {
  const c = RULES.detector(id);
  return {
    id, name: c.name, family: c.family as Family, status: fires ? 'ILLICIT' : 'BENIGN', strength: 1, reliability: 1, fakeDifficulty: c.fakeDifficulty, lineage: c.lineage, system: c.provenance,
    affinity: { ROTATION: c.affinity[0], TRANSACTION_LAUNDERING: c.affinity[1], FABRICATED_SUBSTANCE: c.affinity[2], OTHER_ABUSE: c.affinity[3] } as Record<Mechanism, number>,
    observed: '', expected: '', explanation: '', metrics: {}, records: [], requires: c.requires as CoverageKey[],
    llr: fires ? fireLlr(c.sensitivity, c.falsePositive) : Math.max(RULES.engine.benignLlrFloor, calmLlr(c.sensitivity, c.falsePositive) * tauOf(c.fakeDifficulty)),
    provenance: c.provenance as Provenance, signal: c.class, test: c.test, p: null, effect: null, effectLabel: '', ci: null, n: 0, expectedSource: 'hypothetical',
  };
}

export function buildTrace(r: InvestigationResult): Trace {
  const f = r.fusion, p = r.scenario.profile, ev = r.evidence, opts = { draws: 0, priorShift: f.priorShift };
  const top = f.mechanisms[0];
  // Waterfall in log-odds: prior, then each family (largest effect first), then overrides.
  const steps: TraceStep[] = [];
  let cum = f.logOdds.prior;
  steps.push({ label: `Base rate for MCC ${p.mcc}, account ${p.accountAgeDays} days${f.priorShift ? `, lowered because ${r.streams.length} streams were tested` : ''}`, delta: f.logOdds.prior, cumulative: cum, probability: sigmoid(cum) });
  [...f.logOdds.families].sort((a, b) => Math.abs(b.llr) - Math.abs(a.llr)).forEach(x => {
    cum += x.llr;
    steps.push({ label: `Family ${x.family} · ${FAMILIES.find(fm => fm.id === x.family)?.name ?? ''} (${x.items.join(', ')})`, delta: x.llr, cumulative: cum, probability: sigmoid(cum) });
  });
  f.logOdds.overrides.forEach(o => { cum += o.llr; steps.push({ label: `Override ${o.id}: ${o.when}`, delta: o.llr, cumulative: cum, probability: sigmoid(cum) }); });

  // Counterfactuals: remove each of the strongest fired signals in turn, plus the smallest top-signal set that flips OPEN_CASE -> NO_CASE.
  const allPositive = ev.filter(e => e.llr > 0).sort((a, b) => b.llr - a.llr);
  const fired = allPositive.slice(0, 5);
  const counterfactuals: Counterfactual[] = fired.map(e => {
    const g = fuse(ev.map(x => (x.id === e.id ? { ...x, status: 'UNKNOWN' as const, llr: 0 } : x)), p, opts);
    return { what: `Without ${e.id} (${e.name})`, posterior: g.posterior, action: g.decisionAnalysis.recommended, decision: g.decision };
  });
  if (f.decision === 'OPEN_CASE' && counterfactuals.every(c => c.decision === 'OPEN_CASE') && allPositive.length > 1) {
    const dropIds = new Set<string>();
    for (const e of allPositive) {
      dropIds.add(e.id);
      if (dropIds.size <= 1) continue;
      const g = fuse(ev.map(x => (dropIds.has(x.id) ? { ...x, status: 'UNKNOWN' as const, llr: 0 } : x)), p, opts);
      if (g.decision === 'NO_CASE') {
        counterfactuals.push({
          what: `Flip set (greedy): without ${[...dropIds].join(' + ')} (${dropIds.size} signals)`,
          posterior: g.posterior,
          action: g.decisionAnalysis.recommended,
          decision: g.decision,
        });
        break;
      }
    }
  }

  // Value of information for each missing feed (its strongest-weighted detector stands in for the feed).
  const missing = (Object.entries(r.scenario.coverage) as [CoverageKey, string][]).filter(([, s]) => s === 'MISSING').map(([k]) => k);
  const P = f.posterior, now = minLoss(P, f.gatePassed);
  const valueOfInformation: ValueOfInformation[] = missing.flatMap(feed => {
    const ids = ev.filter(e => e.requires.includes(feed) && e.status === 'UNKNOWN').map(e => e.id);
    if (!ids.length) return [];
    const id = ids.sort((a, b) => { const A = RULES.detector(a), B = RULES.detector(b); return fireLlr(B.sensitivity, B.falsePositive) - fireLlr(A.sensitivity, A.falsePositive); })[0];
    const c = RULES.detector(id), pFire = P * c.sensitivity + (1 - P) * c.falsePositive;
    const withIt = (fires: boolean) => fuse(ev.map(x => (x.id === id ? hypothetical(id, fires) : x)), p, opts);
    const a = withIt(true), b = withIt(false);
    const after = pFire * minLoss(a.posterior, a.gatePassed) + (1 - pFire) * minLoss(b.posterior, b.gatePassed);
    return [{ feed, detector: id, pFire, ifFires: a.posterior, ifCalm: b.posterior, voiRupees: Math.max(0, now - after) }];
  }).sort((a, b) => b.voiRupees - a.voiRupees);

  return {
    scope: { label: r.scope.label, sales: r.scope.sales, share: r.scope.share },
    caseSummary: { merchant: p.name, mcc: p.mcc, decision: f.decision, posterior: f.posterior, ci: f.posteriorCi, prior: f.prior, action: r.review.recommended, mechanism: top.id, mechanismP: f.mechanismPosterior[top.id] },
    coverage: r.l1.sources.map(s => ({ name: s.name, state: s.state, records: s.records })),
    waterfall: steps,
    detectors: ev.map(({ id, name, family, status, llr, test, p: pv, effect, effectLabel, ci, n, observed, expected, expectedSource, provenance, records }) => ({ id, name, family, status, llr, test, p: pv, effect, effectLabel, ci, n, observed, expected, expectedSource, provenance, records })),
    gate: { passed: f.gatePassed, reason: f.gateReason, provenances: f.provenances },
    decision: { reason: f.decisionAnalysis.reason, actions: f.decisionAnalysis.actions.map(a => ({ level: a.level, label: a.label, expectedLoss: a.expectedLoss, low: a.expectedLossLow, high: a.expectedLossHigh, auto: a.autoAllowed })) },
    stories: { legit: r.review.legit.map(i => ({ label: i.label, verdict: i.verdict, evidence: i.evidenceIds })), front: r.review.front.map(i => ({ label: i.label, verdict: i.verdict, evidence: i.evidenceIds })) },
    counterfactuals, valueOfInformation,
    versions: { rules: f.rulesVersion, engine: RULES.version },
  };
}
