const IST = 19800000;
export const istMs = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) - IST;
export const istHour = (t: number) => new Date(t + IST).getUTCHours();
export const istMinuteOfDay = (t: number) => { const d = new Date(t + IST); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
export const istDayKey = (t: number) => new Date(t + IST).toISOString().slice(0, 10);
export const fmtDateTime = (t: number) => new Date(t + IST).toISOString().replace('T', ' ').slice(5, 16);
export const fmtDay = (t: number) => new Date(t + IST).toISOString().slice(5, 10);
export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
export const inrK = (n: number) => n >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)}L` : n >= 1e3 ? `₹${(n / 1e3).toFixed(1)}K` : `₹${Math.round(n)}`;
export const pct = (x: number, d = 0) => (x * 100).toFixed(d) + '%';
export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/** Probability for display. Never prints 0% or 100%: the model is not that certain, whatever the arithmetic says. */
export const fmtProb = (v: number) => (v > 0.999 ? '> 99.9%' : v < 0.001 ? '< 0.1%' : `${(v * 100).toFixed(v < 0.1 || v > 0.9 ? 1 : 0)}%`);
/** "P(front) = 78%" / "P(front) > 99.9%". */
export const probEq = (v: number) => { const s = fmtProb(v); return /^[<>]/.test(s) ? s : `= ${s}`; };
/** 90% interval text that stays readable at the extremes. */
export const fmtInterval = ([lo, hi]: [number, number]) => (lo > 0.999 ? '90% interval above 99.9%' : hi < 0.001 ? '90% interval below 0.1%' : `90% interval ${fmtProb(lo)} to ${fmtProb(hi)}`);
