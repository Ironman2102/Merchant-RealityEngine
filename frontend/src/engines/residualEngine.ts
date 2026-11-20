/**
 * L2 volume model. Expected weekly volume = merchant baseline × festival multiplier from rules/calendar.json
 * (by category sector), NOT the multiplier the merchant uploaded. Week dates are inferred backwards from the
 * last transaction (weeklySales are the most recent N weeks). Residuals are on the log scale:
 *   z_t = (ln actual − ln expected) / sqrt(cv² + σ_fest² · [festival week])
 * so festival weeks are judged loosely (their multiplier is itself uncertain).
 */
import type { Scenario } from '../types/merchant';
import type { WeeklyRow } from '../types/investigation';
import { RULES } from '../../../rules/index';

export const EPSILON = 1;
const DAY = 86400000;
export interface VolumeModel { rows: WeeklyRow[]; z: (number | null)[]; mult: number[]; weekEnd: number[]; base: number; cv: number; fitted: boolean; note: string }

/** Festival multiplier for the 7-day week ending at `end` (epoch ms), for a festival sector. */
export function festivalMultiplier(end: number, sector: string): { mult: number; festival: string | null } {
  let best = { mult: 1, festival: null as string | null };
  for (const f of RULES.calendar.festivals) {
    const ramp = (RULES.calendar.sectorRamps as Record<string, Record<string, number[]>>)[f.name]?.[sector];
    if (!ramp) continue;
    const date = Date.parse(f.date + 'T12:00:00+05:30');
    const k = end >= date ? (end - 7 * DAY < date ? 0 : -1) : Math.ceil((date - end) / (7 * DAY));
    if (k >= 0 && k < ramp.length && ramp[k] > best.mult) best = { mult: ramp[k], festival: f.name };
  }
  return best;
}

export function volumeModel(sc: Scenario): VolumeModel {
  const cfg = RULES.engine.volume, sector = RULES.mcc(sc.profile.mcc).festivalSector, sigmaF = RULES.calendar.sigma;
  const own = sc.events.filter(e => e.merchantId === sc.primaryMerchantId);
  const last = own.length ? Math.max(...own.map(e => e.eventTime)) : Date.now();
  const N = sc.weekly.length, weekEnd = sc.weekly.map((_, i) => last - 7 * DAY * (N - 1 - i));
  const mult = weekEnd.map(e => festivalMultiplier(e, sector).mult);
  const base0 = sc.weekly.slice(0, cfg.baselineWeeks).map((w, i) => ({ v: w.actual, m: mult[i] })).filter(x => x.v !== null && x.v > 0 && x.m === 1);
  const fitted = base0.length >= 3;
  const logs = base0.map(x => Math.log(x.v!)), mean = logs.length ? logs.reduce((s, v) => s + v, 0) / logs.length : Math.log(sc.profile.baselineWeekly);
  const cv = logs.length > 1 ? Math.max(0.05, Math.sqrt(logs.reduce((s, v) => s + (v - mean) ** 2, 0) / (logs.length - 1))) : 0.15;
  const base = fitted ? Math.exp(mean) : sc.profile.baselineWeekly;
  const hist: number[] = [];
  const rows: WeeklyRow[] = [], z: (number | null)[] = [];
  sc.weekly.forEach((w, i) => {
    const exp = base * mult[i], v = w.actual, prev = hist.slice(-4), rolling = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : base;
    if (v !== null) hist.push(v);
    rows.push({ week: w.week, actual: v, anchored: base, seasonal: exp, rolling,
      rAnchored: v === null ? null : (v - base) / Math.max(base, EPSILON), rSeasonal: v === null ? null : (v - exp) / Math.max(exp, EPSILON), rRolling: v === null ? null : (v - rolling) / Math.max(rolling, EPSILON) });
    z.push(v === null || v <= 0 ? null : (Math.log(v) - Math.log(exp)) / Math.sqrt(cv * cv + (mult[i] > 1 ? sigmaF * sigmaF : 0)));
  });
  return { rows, z, mult, weekEnd, base, cv, fitted, note: fitted ? `Baseline from ${base0.length} non-festival weeks; festival multipliers from the ${sector} calendar.` : 'Too few clean baseline weeks: the declared baseline is used and volume evidence is weak.' };
}
