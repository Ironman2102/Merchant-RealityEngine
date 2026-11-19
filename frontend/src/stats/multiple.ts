/** Multiple-testing control. Both return adjusted p-values in the original order. */

/** Holm step-down (family-wise error). */
export function holm(ps: readonly number[]): number[] {
  const m = ps.length, idx = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]), out = Array(m).fill(1);
  let run = 0;
  idx.forEach(([p, i], r) => { run = Math.max(run, Math.min(1, (m - r) * p)); out[i] = run; });
  return out;
}

/** Benjamini–Hochberg q-values (false discovery rate). */
export function bhQValues(ps: readonly number[]): number[] {
  const m = ps.length, idx = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]), out = Array(m).fill(1);
  let run = 1;
  for (let r = m - 1; r >= 0; r--) { const [p, i] = idx[r]; run = Math.min(run, (p * m) / (r + 1)); out[i] = Math.min(1, run); }
  return out;
}

/** Indices rejected at FDR q, plus the expected number of false discoveries among them (Σ q-values is conservative; we report q × R). */
export function bhReject(ps: readonly number[], q = 0.1): { rejected: number[]; expectedFalse: number } {
  const qv = bhQValues(ps), rejected = qv.map((v, i) => (v <= q ? i : -1)).filter(i => i >= 0);
  return { rejected, expectedFalse: q * rejected.length };
}
