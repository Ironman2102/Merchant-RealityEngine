/**
 * Distribution functions. Special functions come from @stdlib (vetted implementations);
 * everything else is a thin, tested wrapper. All functions return probabilities in [0, 1].
 */
import gammainc from '@stdlib/math-base-special-gammainc';
import betainc from '@stdlib/math-base-special-betainc';
import betaincinv from '@stdlib/math-base-special-betaincinv';
import erfc from '@stdlib/math-base-special-erfc';
import erfcinv from '@stdlib/math-base-special-erfcinv';
import gammaln from '@stdlib/math-base-special-gammaln';

export { gammaln };
const clamp01 = (p: number) => (p < 0 ? 0 : p > 1 ? 1 : p);

/* ---------- normal ---------- */
export const normalCdf = (z: number) => 0.5 * erfc(-z / Math.SQRT2);
export const normalSf = (z: number) => 0.5 * erfc(z / Math.SQRT2);
export const normalQuantile = (p: number) => -Math.SQRT2 * erfcinv(2 * p);

/* ---------- chi-square / gamma ---------- */
/** P(X ≥ x) for χ² with k degrees of freedom. */
export const chi2Sf = (x: number, k: number) => (x <= 0 ? 1 : clamp01(gammainc(x / 2, k / 2, true, true)));

/* ---------- beta ---------- */
export const betaCdf = (x: number, a: number, b: number) => (x <= 0 ? 0 : x >= 1 ? 1 : clamp01(betainc(x, a, b)));
export const betaQuantile = (p: number, a: number, b: number) => (p <= 0 ? 0 : p >= 1 ? 1 : betaincinv(p, a, b));

/* ---------- binomial ---------- */
export const lnChoose = (n: number, k: number) => gammaln(n + 1) - gammaln(k + 1) - gammaln(n - k + 1);
/** P(X ≥ k), X ~ Binomial(n, p). */
export function binomSf(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return clamp01(betainc(p, k, n - k + 1));
}
/** P(X ≤ k). */
export const binomCdf = (k: number, n: number, p: number) => 1 - binomSf(k + 1, n, p);

/* ---------- Poisson ---------- */
/** P(X ≥ k), X ~ Poisson(λ). */
export function poissonSf(k: number, lambda: number): number {
  if (k <= 0) return 1;
  if (lambda <= 0) return 0;
  return clamp01(gammainc(lambda, k, true, false));
}

/* ---------- hypergeometric ---------- */
/** P(X ≥ k): drawing n from N items of which K are "successes". */
export function hypergeomSf(k: number, N: number, K: number, n: number): number {
  const lo = Math.max(0, n - (N - K)), hi = Math.min(n, K);
  if (k <= lo) return 1;
  if (k > hi) return 0;
  const den = lnChoose(N, n);
  let s = 0;
  for (let i = k; i <= hi; i++) s += Math.exp(lnChoose(K, i) + lnChoose(N - K, n - i) - den);
  return clamp01(s);
}

/* ---------- beta-binomial (over-dispersed rates) ---------- */
const lnBeta = (a: number, b: number) => gammaln(a) + gammaln(b) - gammaln(a + b);
export const betaBinomLnPmf = (k: number, n: number, a: number, b: number) => lnChoose(n, k) + lnBeta(k + a, n - k + b) - lnBeta(a, b);
/** P(X ≥ k), X ~ BetaBinomial(n, a, b). ponytail: O(n) sum; fine for n ≤ 1e5 transactions per merchant. */
export function betaBinomSf(k: number, n: number, a: number, b: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let s = 0;
  for (let i = k; i <= n; i++) s += Math.exp(betaBinomLnPmf(i, n, a, b));
  return clamp01(s);
}

/* ---------- negative binomial (mean μ, size θ; Var = μ + μ²/θ) ---------- */
export function negBinomLnPmf(k: number, mu: number, theta: number): number {
  const p = theta / (theta + mu);
  return gammaln(k + theta) - gammaln(theta) - gammaln(k + 1) + theta * Math.log(p) + k * Math.log(1 - p);
}
/** Central prediction interval [lo, hi] of NB(μ, θ) covering `level` (e.g. 0.95). */
export function negBinomInterval(mu: number, theta: number, level = 0.95): [number, number] {
  const a = (1 - level) / 2, sd = Math.sqrt(mu + (mu * mu) / theta);
  // ponytail: normal approximation on the NB moments; exact enough for weekly rupee volumes (μ ≫ 1).
  const z = normalQuantile(1 - a);
  return [Math.max(0, mu - z * sd), mu + z * sd];
}

/* ---------- log-normal ---------- */
export const lognormalCdf = (x: number, median: number, sigma: number) => (x <= 0 ? 0 : normalCdf(Math.log(x / median) / sigma));
