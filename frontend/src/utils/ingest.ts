/** Reading an Indian PA export honestly. Anything that cannot be read is reported, never guessed. */
import { toIst } from '../data/dataset';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY = 86400000;

/**
 * An unambiguous ISO string, or null. A date written 05/10/2026 is 5 October: day first, always.
 * Accepts ISO, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD-Mon-YYYY, epoch seconds and epoch milliseconds.
 * A time with no offset is read in `offset` (IST unless the mapping says otherwise), not in the computer's timezone.
 */
export function parseTime(raw: string, offset = '+05:30'): string | null {
  const s = raw.trim();
  if (/^\d{10}$|^\d{13}$/.test(s)) return toIst(Number(s) * (s.length === 10 ? 1000 : 1));
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  const local = iso ? null : /^(\d{1,2})[/.\- ](\d{1,2}|[A-Za-z]{3,9})[/.\- ](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/.exec(s);
  if (!iso && !local) return null;
  let year: number, month: number, day: number, hour: number, min: number, sec: number, zone = offset;
  if (iso) {
    [year, month, day, hour, min, sec] = [iso[1], iso[2], iso[3], iso[4] ?? 0, iso[5] ?? 0, iso[6] ?? 0].map(Number);
    if (iso[7] === 'Z') zone = '+00:00'; else if (iso[7]) zone = iso[7].includes(':') ? iso[7] : `${iso[7].slice(0, 3)}:${iso[7].slice(3)}`;
  } else {
    const m = local!;
    [day, year, hour, min, sec] = [m[1], m[3], m[4] ?? 0, m[5] ?? 0, m[6] ?? 0].map(Number);
    month = /^\d+$/.test(m[2]) ? Number(m[2]) : MONTHS.indexOf(m[2].slice(0, 3).toUpperCase()) + 1;
    if (m[7]) { if (hour < 1 || hour > 12) return null; hour = (hour % 12) + (m[7].toUpperCase() === 'PM' ? 12 : 0); }
  }
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || min > 59 || sec > 59) return null;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${year}-${two(month)}-${two(day)}T${two(hour)}:${two(min)}:${two(sec)}${zone}`;
}

export function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(/^(?:₹|INR|Rs\.?)\s*/i, '').replace(/,/g, '');
  return /^-?\d+(?:\.\d+)?$/.test(s) ? Number(s) : null;
}

const SUCCESS = new Set(['SUCCESS', 'SUCCESSFUL', 'SUCCEEDED', 'CAPTURED', 'SETTLED', 'COMPLETED', 'COMPLETE', 'PAID', 'APPROVED', 'OK', 'PROCESSED', 'REFUNDED', 'TXN_SUCCESS', 'S']);
/** Only money that moved. An unfamiliar status is excluded and reported rather than counted as a sale. */
export const succeeded = (status: string) => SUCCESS.has(status.trim().toUpperCase());

/** Weekly totals from the ledger's complete weeks. A part-week would look like a collapse, then a spike, so it is dropped. */
export function weeklyFromLedger(sales: { time: string; amount: number }[]): { week: string; actual: number | null; seasonalMultiplier: number }[] {
  if (!sales.length) return [];
  const t = sales.map(s => Date.parse(s.time));
  let first = Infinity, last = -Infinity;
  for (const x of t) { if (x < first) first = x; if (x > last) last = x; }
  const weeks = Math.floor(((last - first) / DAY + 1) / 7);
  if (!weeks) return [{ week: toIst(last).slice(0, 10), actual: null, seasonalMultiplier: 1 }];
  const totals = Array<number>(weeks).fill(0);
  t.forEach((x, i) => { const back = Math.floor((last - x) / (7 * DAY)); if (back < weeks) totals[weeks - 1 - back] += sales[i].amount; });
  return totals.map((v, i) => ({ week: toIst(last - 7 * DAY * (weeks - 1 - i)).slice(0, 10), actual: Math.round(v * 100) / 100, seasonalMultiplier: 1 }));
}

const STATE_NAMES: Record<string, string> = {
  'ANDHRA PRADESH': 'AP', 'ARUNACHAL PRADESH': 'AR', ASSAM: 'AS', BIHAR: 'BR', CHHATTISGARH: 'CG', CHANDIGARH: 'CH', DELHI: 'DL', 'NEW DELHI': 'DL', GOA: 'GA',
  GUJARAT: 'GJ', HARYANA: 'HR', 'HIMACHAL PRADESH': 'HP', 'JAMMU AND KASHMIR': 'JK', JHARKHAND: 'JH', KARNATAKA: 'KA', KERALA: 'KL', LADAKH: 'LA',
  'MADHYA PRADESH': 'MP', MAHARASHTRA: 'MH', MANIPUR: 'MN', MEGHALAYA: 'ML', MIZORAM: 'MZ', NAGALAND: 'NL', ODISHA: 'OD', PUDUCHERRY: 'PY', PUNJAB: 'PB',
  RAJASTHAN: 'RJ', SIKKIM: 'SK', 'TAMIL NADU': 'TN', TELANGANA: 'TS', TRIPURA: 'TR', 'UTTAR PRADESH': 'UP', UTTARAKHAND: 'UK', 'WEST BENGAL': 'WB',
};
const CODES = new Set([...Object.values(STATE_NAMES), 'DN', 'AN', 'LD']);
export function stateCode(raw: string): string | undefined {
  const s = raw.trim().toUpperCase().replace(/\s+/g, ' ').replace('&', 'AND');
  return CODES.has(s) ? s : ({ OR: 'OD', TG: 'TS', UT: 'UK' } as Record<string, string>)[s] ?? STATE_NAMES[s];
}
