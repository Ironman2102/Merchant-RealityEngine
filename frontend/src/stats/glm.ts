/**
 * Poisson / negative-binomial regression by IRLS: log E[y] = Xβ.
 * Used for weekly volume: intercept + festival covariates + trend, so a Diwali spike is *expected*, not anomalous.
 */
import { negBinomInterval } from './dist';

export interface GlmFit { beta: number[]; mu: number[]; theta: number; dispersion: number; converged: boolean }

/** Solve A x = b (small dense systems, Gaussian elimination with partial pivoting). */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / piv; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / (M[r][r] || 1e-12); }
  return x;
}

/** Poisson IRLS with a small ridge (λ) for stability; θ (NB size) estimated by moments from the residuals. */
export function fitPoissonGlm(X: number[][], y: number[], ridge = 1e-6, iters = 50): GlmFit {
  const p = X[0]?.length ?? 0, n = y.length;
  const mean = y.reduce((s, v) => s + v, 0) / Math.max(n, 1);
  let beta = Array(p).fill(0); beta[0] = Math.log(Math.max(mean, 1e-6));
  let converged = false, mu = y.map(() => mean);
  for (let it = 0; it < iters; it++) {
    const eta = X.map(r => r.reduce((s, x, j) => s + x * beta[j], 0));
    mu = eta.map(e => Math.exp(Math.min(e, 700)));
    const z = eta.map((e, i) => e + (y[i] - mu[i]) / Math.max(mu[i], 1e-12));
    const A = Array.from({ length: p }, () => Array(p).fill(0)), b = Array(p).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) { b[j] += mu[i] * X[i][j] * z[i]; for (let k = 0; k < p; k++) A[j][k] += mu[i] * X[i][j] * X[i][k]; }
    for (let j = 1; j < p; j++) A[j][j] += ridge * n;
    const next = solve(A, b), step = Math.max(...next.map((v, j) => Math.abs(v - beta[j])));
    beta = next;
    if (step < 1e-8) { converged = true; break; }
  }
  mu = X.map(r => Math.exp(Math.min(r.reduce((s, x, j) => s + x * beta[j], 0), 700)));
  const pearson = y.reduce((s, v, i) => s + (v - mu[i]) ** 2 / Math.max(mu[i], 1e-12), 0), dispersion = pearson / Math.max(n - p, 1);
  const excess = y.reduce((s, v, i) => s + (v - mu[i]) ** 2 - mu[i], 0), mu2 = mu.reduce((s, m) => s + m * m, 0);
  const theta = excess > 0 ? Math.min(Math.max(mu2 / excess, 0.5), 1e6) : 1e6;
  return { beta, mu, theta, dispersion, converged };
}

export const predictMu = (fit: GlmFit, x: number[]) => Math.exp(x.reduce((s, v, j) => s + v * fit.beta[j], 0));

/** Pearson residual and 95% NB prediction band for one new observation. */
export function nbCheck(fit: GlmFit, x: number[], y: number) {
  const mu = predictMu(fit, x), sd = Math.sqrt(mu + (mu * mu) / fit.theta);
  return { mu, residual: (y - mu) / sd, band: negBinomInterval(mu, fit.theta, 0.95) };
}
