/** Hypothesis tests. Every function returns a p-value (and its statistic) so detectors can report both. */
import { binomSf, chi2Sf, normalSf } from './dist';
import { shuffle, type Rng } from './rng';

export interface TestResult { statistic: number; p: number; df?: number }

/**
 * G-test of goodness of fit: observed counts vs expected probabilities.
 * Cells with expected count < `minExpected` are pooled into one "other" cell so the χ² approximation holds.
 */
export function gTest(observed: readonly number[], expectedP: readonly number[], minExpected = 5): TestResult & { jsd: number } {
  const n = observed.reduce((s, x) => s + x, 0);
  if (n === 0) return { statistic: 0, p: 1, df: 0, jsd: 0 };
  const sumP = expectedP.reduce((s, x) => s + x, 0) || 1;
  const o: number[] = [], e: number[] = [];
  let oo = 0, ee = 0;
  observed.forEach((x, i) => { const ex = (n * expectedP[i]) / sumP; if (ex >= minExpected) { o.push(x); e.push(ex); } else { oo += x; ee += ex; } });
  if (ee > 0) { o.push(oo); e.push(ee); }
  const G = 2 * o.reduce((s, x, i) => s + (x > 0 ? x * Math.log(x / e[i]) : 0), 0), df = Math.max(o.length - 1, 1);
  // Jensen–Shannon divergence (bits) between observed and expected shares: an effect size in [0, 1].
  const P = observed.map(x => x / n), Q = expectedP.map(x => x / sumP), M = P.map((p, i) => (p + Q[i]) / 2);
  const kl = (A: number[], B: number[]) => A.reduce((s, a, i) => s + (a > 0 ? a * Math.log2(a / B[i]) : 0), 0);
  return { statistic: G, p: chi2Sf(G, df), df, jsd: 0.5 * kl(P, M) + 0.5 * kl(Q, M) };
}

/** Two-sample Kolmogorov–Smirnov test (asymptotic, Stephens' small-sample correction). Effect = D. */
export function ksTwoSample(a: readonly number[], b: readonly number[]): TestResult {
  if (!a.length || !b.length) return { statistic: 0, p: 1 };
  const x = [...a].sort((p, q) => p - q), y = [...b].sort((p, q) => p - q);
  let i = 0, j = 0, d = 0;
  while (i < x.length && j < y.length) {
    const v = Math.min(x[i], y[j]);
    while (i < x.length && x[i] <= v) i++;
    while (j < y.length && y[j] <= v) j++;
    d = Math.max(d, Math.abs(i / x.length - j / y.length));
  }
  const ne = (x.length * y.length) / (x.length + y.length), lam = (Math.sqrt(ne) + 0.12 + 0.11 / Math.sqrt(ne)) * d;
  let p = 0;
  for (let k = 1; k <= 100; k++) { const t = 2 * (k % 2 ? 1 : -1) * Math.exp(-2 * k * k * lam * lam); p += t; if (Math.abs(t) < 1e-12) break; }
  return { statistic: d, p: Math.min(1, Math.max(0, p)) };
}

/** Exact one-sided binomial test: P(X ≥ x | n, p0). */
export const binomUpper = (x: number, n: number, p0: number): TestResult => ({ statistic: n ? x / n : 0, p: binomSf(x, n, p0) });

/**
 * Exact conditional test for a Poisson rate ratio. Counts c1 over exposure t1 vs c2 over t2.
 * Under H0 (equal rates) c1 | c1 + c2 ~ Binomial(c1 + c2, t1 / (t1 + t2)). One-sided: rate1 > rate2.
 */
export function poissonRateRatio(c1: number, t1: number, c2: number, t2: number): TestResult & { ratio: number } {
  const ratio = t1 > 0 && t2 > 0 ? (c1 / t1) / Math.max(c2 / t2, 0.5 / t2) : 1;
  return { statistic: ratio, ratio, p: binomSf(c1, c1 + c2, t1 / (t1 + t2)) };
}

/**
 * Permutation p-value: shuffle the group labels B times and count how often the statistic is at least as extreme.
 * (1 + #≥) / (B + 1) is exact and never zero.
 */
export function permutationTest<T>(r: Rng, items: readonly T[], isA: readonly boolean[], stat: (a: T[], b: T[]) => number, B = 2000): TestResult {
  const split = (lab: readonly boolean[]) => { const a: T[] = [], b: T[] = []; items.forEach((it, i) => (lab[i] ? a : b).push(it)); return stat(a, b); };
  const obs = split(isA);
  let ge = 0;
  for (let k = 0; k < B; k++) if (split(shuffle(r, isA)) >= obs - 1e-12) ge++;
  return { statistic: obs, p: (ge + 1) / (B + 1) };
}

/** Mann–Whitney U (normal approximation with tie correction). One-sided: values in `a` tend to be smaller than `b`. */
export function mannWhitneyLess(a: readonly number[], b: readonly number[]): TestResult {
  const n1 = a.length, n2 = b.length;
  if (!n1 || !n2) return { statistic: 0, p: 1 };
  const all = [...a.map(v => [v, 0] as const), ...b.map(v => [v, 1] as const)].sort((p, q) => p[0] - q[0]);
  const ranks = Array(all.length).fill(0);
  let tie = 0;
  for (let i = 0; i < all.length;) {
    let j = i; while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++;
    const rk = (i + j) / 2 + 1, t = j - i + 1; tie += t ** 3 - t;
    for (let k = i; k <= j; k++) ranks[k] = rk;
    i = j + 1;
  }
  const r1 = all.reduce((s, x, i) => s + (x[1] === 0 ? ranks[i] : 0), 0), U = r1 - (n1 * (n1 + 1)) / 2;
  const N = n1 + n2, mu = (n1 * n2) / 2, sd = Math.sqrt(((n1 * n2) / 12) * (N + 1 - tie / (N * (N - 1))));
  return { statistic: U, p: sd > 0 ? normalSf((mu - U - 0.5) / sd) : 1 };
}

/** Fisher's method (independent p-values). */
export function fisherCombine(ps: readonly number[]): TestResult {
  const x = -2 * ps.reduce((s, p) => s + Math.log(Math.max(p, 1e-300)), 0);
  return { statistic: x, p: chi2Sf(x, 2 * ps.length), df: 2 * ps.length };
}

/** Cauchy combination (Liu & Xie 2020): valid under arbitrary dependence between the p-values. */
export function cauchyCombine(ps: readonly number[], w?: readonly number[]): TestResult {
  const ws = w ?? ps.map(() => 1 / ps.length), sw = ws.reduce((s, x) => s + x, 0);
  const T = ps.reduce((s, p, i) => s + (ws[i] / sw) * Math.tan((0.5 - Math.min(Math.max(p, 1e-15), 1 - 1e-15)) * Math.PI), 0);
  return { statistic: T, p: Math.min(1, Math.max(0, 0.5 - Math.atan(T) / Math.PI)) };
}

/** Exact McNemar test on discordant pairs b (A right, B wrong) and c (A wrong, B right). Two-sided. */
export function mcnemarExact(b: number, c: number): TestResult {
  const n = b + c;
  if (n === 0) return { statistic: 0, p: 1 };
  return { statistic: Math.min(b, c), p: Math.min(1, 2 * binomSf(Math.max(b, c), n, 0.5)) };
}

/**
 * Sellke–Bayarri–Berger bound: the largest Bayes factor against H0 a p-value can support, 1 / (−e·p·ln p) for p < 1/e.
 * Used as a conservative evidence weight (in nats) until a detector's likelihood ratio has been learned from labels.
 */
export const sbbLlr = (p: number, cap = 4) => (p >= 1 / Math.E ? 0 : Math.min(cap, -Math.log(-Math.E * p * Math.log(Math.max(p, 1e-300)))));
