/**
 * Turns a statistical result into evidence. A detector FIRES only when it is both statistically significant
 * (p ≤ alpha) and practically large (effect ≥ minEffect); big samples therefore cannot flag trivial differences.
 *   fires      → LLR = ln(sensitivity / falsePositive) × grade,  grade = clamp(effect / effectFull, 0.5, 1.25)
 *   clear miss → LLR = ln((1 − sensitivity) / (1 − falsePositive)) × (0.35 + 0.65 × fakeDifficulty)   (easy-to-fake calm counts less)
 *   otherwise  → UNKNOWN, LLR 0 (grey zone, too little data, or source missing)
 * sensitivity / falsePositive are priors in rules/detectors.json until learned from labels.
 */
import type { EvidenceStatus } from '../types/evidence';
import { RULES, type DetectorCfg } from '../../../rules/index';

export interface Obs {
  p: number | null; effect: number | null; n: number; effectLabel: string;
  observed: string; expected: string; explanation: string; expectedSource: string;
  ci?: [number, number] | null; metrics?: Record<string, string | number>; records?: string[];
  /** Deterministic checks set the verdict directly. */
  force?: EvidenceStatus;
}
export interface Judged { status: EvidenceStatus; llr: number; grade: number; tau: number }

export const fireLlr = (s: number, f: number) => Math.log(s / f);
export const calmLlr = (s: number, f: number) => Math.log((1 - s) / (1 - f));
export const tauOf = (fakeDifficulty: number) => 0.35 + 0.65 * fakeDifficulty;

export function judge(cfg: DetectorCfg, o: Obs): Judged {
  const tau = tauOf(cfg.fakeDifficulty), floor = RULES.engine.benignLlrFloor;
  if (o.force === 'UNKNOWN' || o.n < cfg.minN) return { status: 'UNKNOWN', llr: 0, grade: 0, tau };
  const sig = o.p !== null && o.p <= cfg.alpha, big = o.effect !== null && o.effect >= cfg.minEffect;
  if (o.force === 'ILLICIT' || (o.force === undefined && sig && big)) {
    const grade = Math.min(1.25, Math.max(0.5, (o.effect ?? cfg.effectFull) / cfg.effectFull));
    return { status: 'ILLICIT', llr: fireLlr(cfg.sensitivity, cfg.falsePositive) * grade, grade, tau };
  }
  const clearlyCalm = o.force === 'BENIGN' || (o.force === undefined && ((o.p !== null && o.p > 0.2) || (o.effect !== null && o.effect < cfg.minEffect * 0.5)));
  if (clearlyCalm) return { status: 'BENIGN', llr: Math.max(floor, calmLlr(cfg.sensitivity, cfg.falsePositive) * tau), grade: 1, tau };
  return { status: 'UNKNOWN', llr: 0, grade: 0, tau };
}
