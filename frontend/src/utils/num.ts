/** Helpers for event-sized lists. Spreading one into a call (Math.max(...xs)) overflows the stack near 120,000 items. */

/** Smallest and largest of `f(x)`, or undefined for an empty list. */
export function extent<T>(xs: readonly T[], f: (x: T) => number): [number, number] | undefined {
  if (!xs.length) return undefined;
  let lo = Infinity, hi = -Infinity;
  for (const x of xs) { const v = f(x); if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}

/** Does the ascending list hold a value in [lo, hi]? */
export function hasBetween(sorted: readonly number[], lo: number, hi: number): boolean {
  let a = 0, b = sorted.length;
  while (a < b) { const m = (a + b) >> 1; if (sorted[m] < lo) a = m + 1; else b = m; }
  return a < sorted.length && sorted[a] <= hi;
}
