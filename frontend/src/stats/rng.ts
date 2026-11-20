/** Seeded randomness for every stochastic routine (permutation tests, bootstrap, Monte Carlo). Same seed → same result. */
import { mulberry32, type Rng } from '../utils/prng';
export type { Rng };

export const rng = (seed = 1) => mulberry32(seed);

/** Stable 32-bit seed from a string (e.g. merchant id), so each merchant's draws are reproducible. */
export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function normal(r: Rng): number {
  let u = 0; while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Marsaglia–Tsang gamma(shape, 1). */
export function gamma(r: Rng, shape: number): number {
  if (shape < 1) return gamma(r, shape + 1) * Math.pow(r() || 1e-300, 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do { x = normal(r); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = r();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export const beta = (r: Rng, a: number, b: number) => { const x = gamma(r, a); return x / (x + gamma(r, b)); };

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(r: Rng, xs: readonly T[]): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export const resample = <T>(r: Rng, xs: readonly T[]): T[] => xs.map(() => xs[Math.floor(r() * xs.length)]);
