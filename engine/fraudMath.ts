/**
 * Fraud-detection statistics over a merchant's sales, used as Stage 2 model features.
 * Pure functions: deterministic, finite for every input, and cheap (one sort at most).
 */
import { chi2Sf } from '../frontend/src/stats/dist';

/** Below this many sales the tests carry too little information; they return neutral values. */
export const MIN_N = 30;

/** Benford expected first-digit shares: P(d) = log10(1 + 1/d), d = 1..9. */
export const BENFORD = Array.from({ length: 9 }, (_, i) => Math.log10(1 + 1 / (i + 1)));

/** First significant digit of a positive amount (1..9), or 0 when there is none. */
export function firstDigit(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 0;
  const d = Math.floor(x / 10 ** Math.floor(Math.log10(x)));
  return d >= 1 && d <= 9 ? d : 0;
}

/**
 * Benford's law first-digit test (Nigrini 2012).
 * chi2 = sum_d (O_d - E_d)^2 / E_d with E_d = n * log10(1 + 1/d), 8 degrees of freedom; p = upper chi-square tail.
 * MAD = (1/9) sum_d |O_d/n - log10(1 + 1/d)|, Nigrini's conformity measure (about 0.006 close, 0.015 nonconforming).
 * chi2PerN = chi2 / n, a sample-size-free effect size. Neutral (0, 1, 0) below MIN_N.
 */
export function benford(amounts: number[]): { chi2PerN: number; p: number; mad: number } {
  const counts = new Array(9).fill(0);
  let n = 0;
  for (const a of amounts) { const d = firstDigit(a); if (d) { counts[d - 1]++; n++; } }
  if (n < MIN_N) return { chi2PerN: 0, p: 1, mad: 0 };
  let chi2 = 0, mad = 0;
  for (let i = 0; i < 9; i++) {
    const e = n * BENFORD[i];
    chi2 += (counts[i] - e) ** 2 / e;
    mad += Math.abs(counts[i] / n - BENFORD[i]);
  }
  return { chi2PerN: chi2 / n, p: chi2Sf(chi2, 8), mad: mad / 9 };
}

const meanSd = (xs: number[]) => {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return { m, sd: Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length) };
};

/**
 * Timing of payments (times in ms, any order).
 * dispersion = Var / Mean of sales per calendar day (IST) over the active span; 1 for a Poisson process, > 1 bursty.
 * burstiness B = (sigma - mu) / (sigma + mu) of inter-arrival gaps (Goh & Barabasi 2008): -1 periodic, 0 Poisson, -> 1 bursty.
 * gapCv = sigma / mu of the gaps. Neutral (1, 0, 1) below MIN_N, matching a Poisson process.
 */
export function timing(times: number[], dayOffsetMs = 19_800_000): { dispersion: number; burstiness: number; gapCv: number } {
  if (times.length < MIN_N) return { dispersion: 1, burstiness: 0, gapCv: 1 };
  const t = [...times].sort((a, b) => a - b);
  const day = (x: number) => Math.floor((x + dayOffsetMs) / 86_400_000);
  const first = day(t[0]), span = day(t[t.length - 1]) - first + 1;
  const perDay = new Array(span).fill(0);
  for (const x of t) perDay[day(x) - first]++;
  const d = meanSd(perDay);
  const gaps: number[] = [];
  for (let i = 1; i < t.length; i++) gaps.push(t[i] - t[i - 1]);
  const g = meanSd(gaps);
  return {
    dispersion: span > 1 && d.m > 0 ? d.sd ** 2 / d.m : 1,
    burstiness: g.sd + g.m > 0 ? (g.sd - g.m) / (g.sd + g.m) : 0,
    gapCv: g.m > 0 ? g.sd / g.m : 0,
  };
}

/**
 * Concentration of sales across payers (counts per payer).
 * entropy = -sum p_i ln p_i / ln K, normalised Shannon entropy in [0, 1] (1 = every payer equally often).
 * gini = (2 sum_i i x_(i)) / (K sum x) - (K + 1) / K over ascending counts, in [0, 1) (0 = equal, -> 1 = one payer).
 * Neutral (1, 0) with fewer than two payers.
 */
export function payerConcentration(counts: number[]): { entropy: number; gini: number } {
  const xs = counts.filter(c => c > 0).sort((a, b) => a - b);
  const k = xs.length, total = xs.reduce((s, x) => s + x, 0);
  if (k < 2 || total === 0) return { entropy: 1, gini: 0 };
  let h = 0, w = 0;
  xs.forEach((x, i) => { const p = x / total; h -= p * Math.log(p); w += (i + 1) * x; });
  return { entropy: h / Math.log(k), gini: (2 * w) / (k * total) - (k + 1) / k };
}

/**
 * Repeat-payer behaviour.
 * returningShare = share of identified sales made by payers seen at least twice.
 * repeatGapCv = mean over payers with >= 3 sales of the coefficient of variation of their own gaps
 * (low = clockwork-regular top-ups, typical of deposit accounts; around 1 = irregular, like real customers).
 * Neutral (0, 1) when there is nothing to measure.
 */
export function repeatPayers(byPayer: Map<string, number[]>): { returningShare: number; repeatGapCv: number } {
  let identified = 0, returning = 0;
  const cvs: number[] = [];
  for (const times of byPayer.values()) {
    identified += times.length;
    if (times.length >= 2) returning += times.length;
    if (times.length >= 3) {
      const t = [...times].sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i < t.length; i++) gaps.push(t[i] - t[i - 1]);
      const g = meanSd(gaps);
      if (g.m > 0) cvs.push(g.sd / g.m);
    }
  }
  return {
    returningShare: identified ? returning / identified : 0,
    repeatGapCv: cvs.length ? cvs.reduce((s, x) => s + x, 0) / cvs.length : 1,
  };
}
