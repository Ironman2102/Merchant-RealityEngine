/** Confidence intervals for proportions and bootstrap statistics. */
import { betaQuantile, normalQuantile } from './dist';
import { resample, type Rng } from './rng';

/** Wilson score interval for x successes in n trials. */
export function wilson(x: number, n: number, level = 0.95): [number, number] {
  if (n <= 0) return [0, 1];
  const z = normalQuantile(1 - (1 - level) / 2), p = x / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** Exact (Clopper–Pearson) interval. */
export function clopperPearson(x: number, n: number, level = 0.95): [number, number] {
  const a = (1 - level) / 2;
  return [x === 0 ? 0 : betaQuantile(a, x, n - x + 1), x === n ? 1 : betaQuantile(1 - a, x + 1, n - x)];
}

/** Newcombe hybrid-score interval for the difference p1 − p2. */
export function newcombe(x1: number, n1: number, x2: number, n2: number, level = 0.95): [number, number] {
  const [l1, u1] = wilson(x1, n1, level), [l2, u2] = wilson(x2, n2, level), p1 = x1 / n1, p2 = x2 / n2, d = p1 - p2;
  return [d - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), d + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)];
}

export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Percentile bootstrap CI of `stat` over `data`. */
export function bootstrapCI<T>(r: Rng, data: readonly T[], stat: (xs: T[]) => number, B = 1000, level = 0.9): [number, number] {
  if (!data.length) return [NaN, NaN];
  const draws = Array.from({ length: B }, () => stat(resample(r, data))).filter(Number.isFinite).sort((a, b) => a - b);
  const a = (1 - level) / 2;
  return [quantile(draws, a), quantile(draws, 1 - a)];
}
