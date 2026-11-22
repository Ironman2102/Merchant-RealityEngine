/**
 * Second opinion: a logistic model with non-negative weights over fired payment signals.
 * By construction it cannot read account age, feed availability, category, or "looked normal" results, and a missing
 * feed is a zero. Nothing here can turn an absent feed into suspicion. It never chooses the action.
 */
import type { InvestigationResult } from '../frontend/src/types/investigation';
import model from '../ml/models/linear-v1.json';

export const MODEL_FEATURES = ['A1', 'A4', 'A5', 'B6', 'B7', 'B8', 'B10', 'C2', 'C5', 'C6', 'H3'] as const;

export function modelVector(result: InvestigationResult): number[] {
  const by = new Map(result.evidence.map(e => [e.id, e]));
  return MODEL_FEATURES.map(id => Math.max(0, by.get(id)?.llr ?? 0));
}

export function linearScore(x: number[], intercept: number, weights: number[]): number {
  return 1 / (1 + Math.exp(-x.reduce((z, v, i) => z + v * weights[i], intercept)));
}

export interface SecondOpinion { p: number; threshold: number; drivers: { feature: string; weight: number }[]; modelVersion: string }

export function secondOpinion(result: InvestigationResult): SecondOpinion {
  const x = modelVector(result), w = MODEL_FEATURES.map(id => (model.weights as Record<string, number>)[id] ?? 0);
  return {
    p: linearScore(x, model.intercept, w), threshold: model.threshold, modelVersion: model.version,
    drivers: MODEL_FEATURES.map((feature, i) => ({ feature, weight: x[i] * w[i] })).filter(d => d.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, 5),
  };
}
