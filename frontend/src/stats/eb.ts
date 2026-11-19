/**
 * Empirical-Bayes beta-binomial: fit a peer group's rate distribution, then shrink a small merchant's
 * observed rate towards it. A shop with 4 round amounts in 20 sales is pulled to its peers' rate instead of flagging.
 */
import { betaBinomSf } from './dist';

export interface BetaPrior { a: number; b: number }

/** Method-of-moments fit of Beta(a, b) to peer rates x_i / n_i, correcting for binomial sampling noise. */
export function fitBetaBinomial(xs: readonly number[], ns: readonly number[], fallback: BetaPrior = { a: 1, b: 1 }): BetaPrior {
  const k = xs.length;
  if (k < 3) return fallback;
  const N = ns.reduce((s, n) => s + n, 0);
  if (N <= 0) return fallback;
  const p = xs.reduce((s, x) => s + x, 0) / N;
  if (p <= 0 || p >= 1) return fallback;
  const nBar = N / k;
  const s2 = ns.reduce((s, n, i) => s + n * (xs[i] / n - p) ** 2, 0) / ((k - 1) * nBar); // weighted variance of rates
  const binom = (p * (1 - p)) / nBar;
  const extra = Math.max(s2 - binom, 1e-6);   // between-merchant variance
  const conc = Math.min(Math.max((p * (1 - p)) / extra - 1, 2), 1e5); // a + b, bounded for stability
  return { a: p * conc, b: (1 - p) * conc };
}

/** A prior expressed as a mean rate and a strength "worth n merchants-sales". */
export const priorFromRate = (rate: number, strength: number): BetaPrior => ({ a: Math.max(rate * strength, 1e-3), b: Math.max((1 - rate) * strength, 1e-3) });

/** Posterior mean of the merchant's rate (shrunk estimate). */
export const shrunkRate = (x: number, n: number, pr: BetaPrior) => (x + pr.a) / (n + pr.a + pr.b);

/** Upper-tail p-value: how surprising x of n is if the merchant draws its rate from the peer distribution. */
export const betaBinomUpperP = (x: number, n: number, pr: BetaPrior) => betaBinomSf(x, n, pr.a, pr.b);
