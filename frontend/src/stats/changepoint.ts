/** Change detection on standardised residuals (≈ N(0,1) when the merchant behaves as expected). */
import { normal, rng } from './rng';

/** One-sided upper CUSUM: S_t = max(0, S_{t−1} + z_t − k). Alarm when S_t > h. */
export function cusum(z: readonly number[], k: number, h: number) {
  let s = 0;
  return z.map(v => { s = Math.max(0, s + v - k); return { s, alarm: s > h }; });
}

/** Average run length to a false alarm for N(0,1) data, by simulation (seeded). */
export function arl0(k: number, h: number, sims = 400, cap = 5000, seed = 7): number {
  const r = rng(seed);
  let total = 0;
  for (let i = 0; i < sims; i++) {
    let s = 0, t = 0;
    while (t < cap) { t++; s = Math.max(0, s + normal(r) - k); if (s > h) break; }
    total += t;
  }
  return total / sims;
}

/** Smallest h (to 0.05) whose in-control ARL is at least `target` weeks. Default target 52: one false alarm per merchant-year. */
export function calibrateH(k: number, target = 52): number {
  let lo = 0, hi = 15;
  for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (arl0(k, mid) >= target) hi = mid; else lo = mid; }
  return Math.ceil(hi * 20) / 20;
}

/**
 * Bayesian online changepoint detection (Adams & MacKay 2007) for a Gaussian mean with known unit variance,
 * prior mean 0 (expected behaviour) and prior variance `tau2`. Returns P(a change happened within the last `window` steps).
 */
export function bocpdRecentChange(z: readonly number[], hazard = 1 / 52, tau2 = 4, window = 4): number {
  if (!z.length) return 0;
  let R = [1], mus = [0], vars = [tau2];
  for (const x of z) {
    const pred = R.map((_, i) => { const v = vars[i] + 1; return Math.exp(-((x - mus[i]) ** 2) / (2 * v)) / Math.sqrt(2 * Math.PI * v); });
    const growth = R.map((r, i) => r * pred[i] * (1 - hazard)), cp = R.reduce((s, r, i) => s + r * pred[i] * hazard, 0);
    const next = [cp, ...growth], tot = next.reduce((s, v) => s + v, 0) || 1;
    R = next.map(v => v / tot);
    const nv = vars.map(v => 1 / (1 / v + 1)), nm = mus.map((m, i) => nv[i] * (m / vars[i] + x));
    mus = [0, ...nm]; vars = [tau2, ...nv];
    if (R.length > 260) { R = R.slice(0, 260); mus = mus.slice(0, 260); vars = vars.slice(0, 260); }
  }
  return Math.min(1, R.slice(0, window + 1).reduce((s, v) => s + v, 0));
}
