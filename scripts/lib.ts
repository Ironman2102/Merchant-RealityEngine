export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 1];
  const p = k / n, den = 1 + z * z / n, centre = (p + z * z / (2 * n)) / den;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / den;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}
export const rate = (k: number, n: number) => { const [a, b] = wilson(k, n); return `${k}/${n} = ${(k / (n || 1)).toFixed(3)} | ${a.toFixed(3)}–${b.toFixed(3)}`; };
