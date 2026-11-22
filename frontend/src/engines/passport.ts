/** Context Passport: what a verified, declared change is allowed to explain. */
import type { ContextPassport, Scenario } from '../types/merchant';
import type { PaymentEvent } from '../types/payment';
import { RULES } from '../../../rules/index';
import { istHour } from '../utils/format';

const DAY = 86400000;
export type Axis = 'hours' | 'area' | 'amount';

export function passportPeriod(p: ContextPassport): [number, number] {
  const from = Date.parse(p.from.length === 10 ? `${p.from}T00:00:00+05:30` : p.from), cap = from + RULES.engine.passport.maxDays * DAY;
  const until = p.until ? Date.parse(p.until.length === 10 ? `${p.until}T23:59:59+05:30` : p.until) : cap;
  return [from, Math.min(cap, until)];
}

/** Returns a message for each thing wrong with a submitted passport. */
export function passportErrors(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return ['A Context Passport must be an object.'];
  const p = raw as Partial<ContextPassport>, out: string[] = [];
  for (const k of ['id', 'reason', 'linkId', 'from', 'document'] as const) if (typeof p[k] !== 'string' || !p[k]!.trim()) out.push(`passport.${k} is required.`);
  if (typeof p.from === 'string' && Number.isNaN(Date.parse(p.from))) out.push('passport.from must be an ISO date.');
  if (p.until !== undefined && (typeof p.until !== 'string' || Number.isNaN(Date.parse(p.until)))) out.push('passport.until must be an ISO date.');
  const pair = (x: unknown, max: number) => Array.isArray(x) && x.length === 2 && x.every(n => typeof n === 'number' && n >= 0 && n <= max);
  if (p.hours !== undefined && !pair(p.hours, 24)) out.push('passport.hours must be [open, close].');
  if (p.ticketBand !== undefined && !(pair(p.ticketBand, RULES.engine.limits.maxPaymentRupees) && p.ticketBand[0] <= p.ticketBand[1])) out.push('passport.ticketBand must be [min, max] in rupees.');
  if (p.states !== undefined && !(Array.isArray(p.states) && p.states.every(s => typeof s === 'string'))) out.push('passport.states must be a list of state codes.');
  if (p.volumeUplift !== undefined && !(typeof p.volumeUplift === 'number' && p.volumeUplift >= 1 && p.volumeUplift <= RULES.engine.passport.maxUplift)) out.push(`passport.volumeUplift must be between 1 and ${RULES.engine.passport.maxUplift}.`);
  return out;
}

const verified = (sc: Scenario) => (sc.passports ?? []).filter(p => p.status === 'VERIFIED');

/** Payments a verified passport explains on one axis. They are set aside from that test: not counted as innocent either. */
export function passportCover(sc: Scenario): (e: PaymentEvent, axis: Axis) => boolean {
  const active = verified(sc).map(p => ({ p, period: passportPeriod(p) }));
  return (e, axis) => active.some(({ p, period: [a, b] }) => {
    if (e.linkId !== p.linkId || e.eventTime < a || e.eventTime > b) return false;
    if (axis === 'hours') {
      if (!p.hours) return false;
      const h = istHour(e.eventTime), [open, close] = p.hours;
      return open < close ? h >= open && h < close : h >= open || h < close;
    }
    if (axis === 'area') return !!p.states && (p.states.includes('*') || p.states.includes(e.payerState));
    return !!p.ticketBand && e.amount >= p.ticketBand[0] && e.amount <= p.ticketBand[1];
  });
}

export function passportUplift(sc: Scenario, weekEnd: number): number {
  let uplift = 1;
  for (const p of verified(sc)) {
    const [a, b] = passportPeriod(p);
    if (p.volumeUplift && weekEnd >= a && weekEnd - 7 * DAY < b) uplift = Math.max(uplift, Math.min(RULES.engine.passport.maxUplift, p.volumeUplift));
  }
  return uplift;
}
