/**
 * L4 Bayesian evidence fusion.
 *   log-odds(front | E) = logit(prior) + Σ_family LLR_family + Σ overrides
 *   LLR_family = strongest positive + ρ·(other positives) + strongest negative + ρ·(other negatives)
 * Detectors in one family share data, so ρ (rules/engine.json) stops them counting as independent facts.
 * UNKNOWN evidence has LLR 0 and never moves the odds. A 90% interval comes from Monte-Carlo draws of every
 * detector's sensitivity / false-positive rate (Beta, prior strength from rules) and of the base rate.
 * Governance gate (not statistics): a case opens only if P(front) ≥ threshold AND the evidence comes from
 * ≥ 2 independent data provenances, or ≥ 3 independent families when only one provenance is available.
 */
import type { EvidenceItem, Family, Mechanism } from '../types/evidence';
import type { FusionResult, FusedItem, FamilySummary, MechanismScore } from '../types/investigation';
import type { MerchantProfile } from '../types/merchant';
import { FAMILIES } from '../data/evidence';
import { RULES } from '../../../rules/index';
import { calmLlr, fireLlr } from './judge';
import { normal, rng, seedOf } from '../stats/rng';
import { quantile } from '../stats/intervals';
import { decide } from './decision';
import { fmtProb, fmtInterval, probEq } from '../utils/format';

export const MIN_INDEPENDENT_FAMILIES = RULES.engine.gate.minProvenances;
const MECHS: Mechanism[] = ['TRANSACTION_LAUNDERING', 'ROTATION', 'FABRICATED_SUBSTANCE', 'OTHER_ABUSE'];
const logit = (p: number) => Math.log(p / (1 - p)), sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Evidence weight on a 0–1 scale for UI and chain verdicts (|LLR| / 4 nats). */
export const effWeight = (e: EvidenceItem) => (e.status === 'UNKNOWN' ? 0 : Math.min(1, Math.abs(e.llr) / 4));

export function priorFor(p: MerchantProfile): { rate: number; strength: number; odds: number } {
  const base = RULES.priors.byMcc[p.mcc] ?? RULES.priors.default;
  const odds = RULES.priors.ageOdds.find(a => p.accountAgeDays <= a.maxDays)?.odds ?? 1;
  return { ...base, odds };
}

/** Family-level LLR with within-family correlation shrinkage ρ. `llrOf` lets Monte-Carlo draws swap in sampled LLRs. */
function familyLlr(items: EvidenceItem[], llrOf: (e: EvidenceItem) => number, rho: number) {
  const pos = items.map(llrOf).filter(v => v > 0).sort((a, b) => b - a), neg = items.map(llrOf).filter(v => v < 0).sort((a, b) => a - b);
  const part = (xs: number[]) => (xs.length ? xs[0] + rho * xs.slice(1).reduce((s, v) => s + v, 0) : 0);
  return part(pos) + part(neg);
}

export function fuse(evidence: EvidenceItem[], profile: MerchantProfile, opts: { draws?: number } = {}): FusionResult {
  const E = RULES.engine, rho = E.familyRho, pr = priorFor(profile);
  const priorLogOdds = logit(pr.rate) + Math.log(pr.odds);
  const byFam = new Map<Family, EvidenceItem[]>();
  evidence.filter(e => e.status !== 'UNKNOWN').forEach(e => byFam.set(e.family, [...(byFam.get(e.family) ?? []), e]));

  const famRows = [...byFam.entries()].map(([family, xs]) => ({ family, llr: familyLlr(xs, e => e.llr, rho), items: xs.map(e => e.id) }));
  const overrides = RULES.overrides.rules.filter(r => evidence.some(e => e.id === r.detector && e.status === 'ILLICIT' && (r.id !== 'R-01' || (e.effect ?? 0) >= 1.25)))
    .map(r => ({ id: r.id, llr: r.llr, when: r.when }));
  const total = priorLogOdds + famRows.reduce((s, f) => s + f.llr, 0) + overrides.reduce((s, o) => s + o.llr, 0);

  // Monte-Carlo interval: redraw each fired/calm detector's s, f, and the base rate on the logit scale so medians match point estimates.
  const r = rng(seedOf(profile.id + '|fusion')), k = E.detectorPriorStrength, draws: number[] = [];
  const drawProb = (p: number, strength: number) => sigmoid(logit(p) + normal(r) / Math.sqrt(1 + strength * p * (1 - p)));
  for (let d = 0; d < (opts.draws ?? E.posteriorDraws); d++) {
    const sampled = new Map<string, number>();
    evidence.forEach(e => {
      if (e.status === 'UNKNOWN') return;
      const cfg = RULES.detector(e.id), s = drawProb(cfg.sensitivity, k), f = drawProb(cfg.falsePositive, k);
      // Keep the item's grade / fake-difficulty / coverage factor (e.llr ÷ point LLR) and redraw only s and f.
      const point = e.status === 'ILLICIT' ? fireLlr(cfg.sensitivity, cfg.falsePositive) : calmLlr(cfg.sensitivity, cfg.falsePositive);
      const now = e.status === 'ILLICIT' ? fireLlr(s, f) : calmLlr(s, f);
      sampled.set(e.id, Math.max(E.benignLlrFloor, e.llr * (now / point)));
    });
    const rate = drawProb(pr.rate, pr.strength);
    const lo = logit(rate) + Math.log(pr.odds) + [...byFam.values()].reduce((s, xs) => s + familyLlr(xs, e => sampled.get(e.id) ?? e.llr, rho), 0) + overrides.reduce((s, o) => s + o.llr, 0);
    draws.push(sigmoid(lo));
  }
  draws.sort((a, b) => a - b);
  const posterior = sigmoid(total), posteriorCi: [number, number] = draws.length ? [quantile(draws, 0.05), quantile(draws, 0.95)] : [posterior, posterior];

  // Provenance and family contributions (positive side only: what supports "front").
  const items: FusedItem[] = evidence.map(e => ({ evidence: e, counted: e.status !== 'UNKNOWN', weight: e.llr,
    reason: e.status === 'UNKNOWN' ? 'UNKNOWN: LLR 0, does not move the odds' : `${e.llr >= 0 ? '+' : ''}${e.llr.toFixed(2)} nats (${e.status === 'ILLICIT' ? 'fires' : 'calm'}; family ${e.family} shrinkage ρ = ${rho})` }));
  const provNats = new Map<string, number>();
  byFam.forEach(xs => { const pos = xs.filter(e => e.llr > 0).sort((a, b) => b.llr - a.llr); pos.forEach((e, i) => provNats.set(e.provenance, (provNats.get(e.provenance) ?? 0) + e.llr * (i ? rho : 1))); });
  const provenances = [...provNats.entries()].map(([provenance, nats]) => ({ provenance, nats })).sort((a, b) => b.nats - a.nats);
  const strongProv = provenances.filter(p => p.nats >= E.gate.minNats), strongFam = famRows.filter(f => f.llr >= E.gate.minNats);
  const independent = strongProv.length >= E.gate.minProvenances || strongFam.length >= E.gate.minFamiliesSingleProvenance;
  const gatePassed = posterior >= E.gate.openPosterior && independent;
  const gateReason = gatePassed
    ? `P(front) ${probEq(posterior)} (${fmtInterval(posteriorCi)}) from a ${fmtProb(sigmoid(priorLogOdds))} base rate (category rate adjusted for account age); evidence from ${strongProv.length} independent source(s) (${strongProv.map(p => p.provenance).join(', ')}) across ${strongFam.length} families.`
    : posterior < E.gate.openPosterior
      ? `P(front) ${probEq(posterior)} (${fmtInterval(posteriorCi)}), below the ${fmtProb(E.gate.openPosterior)} needed to open a case. Base rate ${fmtProb(sigmoid(priorLogOdds))} (category rate adjusted for account age).`
      : `P(front) ${probEq(posterior)} but the support comes from one data source and fewer than ${E.gate.minFamiliesSingleProvenance} independent families; a second source is needed.`;

  const families: FamilySummary[] = FAMILIES.map(f => {
    const inF = evidence.filter(e => e.family === f.id);
    return { family: f.id, illicit: inF.filter(e => e.status === 'ILLICIT').length, benign: inF.filter(e => e.status === 'BENIGN').length, unknown: inF.filter(e => e.status === 'UNKNOWN').length, mass: Math.max(0, famRows.find(x => x.family === f.id)?.llr ?? 0) };
  });

  // Mechanism posterior: P(μ | front) ∝ π_μ · exp(Σ positive LLR_i · affinity_iμ).
  const fired = evidence.filter(e => e.llr > 0), logits = MECHS.map(m => Math.log(E.mechanismPrior[m]) + fired.reduce((s, e) => s + e.llr * e.affinity[m], 0));
  const mx = Math.max(...logits), ex = logits.map(v => Math.exp(v - mx)), z = ex.reduce((s, v) => s + v, 0);
  const mechanismPosterior = Object.fromEntries(MECHS.map((m, i) => [m, ex[i] / z])) as Record<Mechanism, number>;
  const mechanisms: MechanismScore[] = MECHS.map(m => ({ id: m, score: posterior * mechanismPosterior[m],
    contributors: fired.map(e => ({ id: e.id, contribution: e.llr * e.affinity[m] })).filter(c => c.contribution > 0.05).sort((a, b) => b.contribution - a.contribution) })).sort((a, b) => b.score - a.score);

  const illicitMass = famRows.reduce((s, f) => s + Math.max(0, f.llr), 0), benignMass = famRows.reduce((s, f) => s + Math.max(0, -f.llr), 0);
  const decisionAnalysis = decide(posterior, posteriorCi, gatePassed);
  const priority = !gatePassed ? 'NONE' : posterior >= E.priority.high ? 'HIGH' : posterior >= E.priority.medium ? 'MEDIUM' : 'LOW';
  return {
    items, families, independentFamilies: strongFam.map(f => f.family), systems: strongProv.map(p => p.provenance), gatePassed, gateReason, illicitMass, benignMass, mechanisms,
    decision: gatePassed ? 'OPEN_CASE' : 'NO_CASE', priority, priorityScore: posterior, unknownIds: evidence.filter(e => e.status === 'UNKNOWN').map(e => e.id),
    rulesVersion: RULES.version, prior: sigmoid(priorLogOdds), posterior, posteriorCi,
    logOdds: { prior: priorLogOdds, families: famRows, overrides, total }, provenances, mechanismPosterior, decisionAnalysis,
  };
}
