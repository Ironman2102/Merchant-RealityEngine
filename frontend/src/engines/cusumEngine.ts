import type { CusumPoint, WeeklyRow } from '../types/investigation';
import { RULES } from '../../../rules/index';

/** One-sided CUSUM on standardised log residuals z: S_t = max(0, S_{t−1} + z_t − k). h is set (by simulation) for an
 * in-control average run length of one false alarm per merchant-year; see tests/stats/sim.test.ts. */
export const CUSUM_K = RULES.engine.cusum.k;
export const CUSUM_H = RULES.engine.cusum.h;
export function cusum(rows: WeeklyRow[], z: (number | null)[], k = CUSUM_K, h = CUSUM_H): CusumPoint[] {
  let s = 0;
  return rows.map((r, i) => {
    const v = z[i];
    if (v === null || v === undefined) return { week: r.week, r: null, s, alarm: false };
    s = Math.max(0, s + v - k);
    return { week: r.week, r: v, s, alarm: s > h };
  });
}
