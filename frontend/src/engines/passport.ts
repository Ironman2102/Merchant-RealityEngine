/** Context Passport: what a verified, declared change is allowed to explain. */
import type { ContextPassport, Scenario } from '../types/merchant';
import type { PaymentEvent } from '../types/payment';
import { RULES } from '../../../rules/index';
import { istHour } from '../utils/format';
import { instant } from '../utils/time';

const DAY = 86400000;
export type Axis = 'hours' | 'area' | 'amount';

export function passportPeriod(p: ContextPassport): [number, number] {
  const from = instant(p.from), cap = from + RULES.engine.passport.maxDays * DAY;
  const until = p.until ? instant(p.until.length === 10 ? `${p.until}T23:59:59+05:30` : p.until) : cap;
  return [from, Math.min(cap, until)];
}

/** Returns a message for each thing wrong with a submitted passport. */
export function passportErrors(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return ['A Context Passport must be an object.'];
  const p = raw as Partial<ContextPassport>, out: string[] = [];
  for (const k of ['id', 'reason', 'linkId', 'from', 'document'] as const) if (typeof p[k] !== 'string' || !p[k]!.trim()) out.push(`passport.${k} is required.`);
  if (typeof p.from === 'string' && Number.isNaN(instant(p.from))) out.push('passport.from must be an ISO date.');
  if (p.until !== undefined && (typeof p.until !== 'string' || Number.isNaN(instant(p.until)))) out.push('passport.until must be an ISO date.');
  if (!out.length) {
    const [from, until] = passportPeriod(p as ContextPassport);
    if (!(Number.isFinite(from) && until > from)) out.push('passport.until must be after passport.from.');
  }
  const L = RULES.engine.passport;
  const pair = (x: unknown, max: number) => Array.isArray(x) && x.length === 2 && x.every(n => typeof n === 'number' && n >= 0 && n <= max);
  if (p.hours !== undefined) {
    if (!pair(p.hours, 24)) out.push('passport.hours must be [open, close].');
    else {
      const [open, close] = p.hours, span = open < close ? close - open : close + 24 - open;
      if (span <= 0 || span > L.maxHoursSpan) out.push(`passport.hours can cover at most ${L.maxHoursSpan} hours a day.`);
    }
  }
  if (p.ticketBand !== undefined) {
    if (!(pair(p.ticketBand, RULES.engine.limits.maxPaymentRupees) && p.ticketBand[0] > 0 && p.ticketBand[0] <= p.ticketBand[1])) out.push('passport.ticketBand must be [min, max] in rupees, with min above 0.');
    else if (p.ticketBand[1] > L.maxTicketRatio * p.ticketBand[0]) out.push(`passport.ticketBand: the highest price can be at most ${L.maxTicketRatio} times the lowest.`);
  }
  if (p.states !== undefined) {
    if (!(Array.isArray(p.states) && p.states.length && p.states.every(s => typeof s === 'string' && s))) out.push('passport.states must be a list of state codes.');
    else if (!p.states.includes('*') && p.states.length > L.maxStates) out.push(`passport.states can list at most ${L.maxStates} states, or * for a national business.`);
  }
  if (!p.hours && !p.states && !p.ticketBand && !((p.volumeUplift ?? 1) > 1)) out.push('A passport must say what changed: hours, states, ticketBand or volumeUplift.');
  if (p.volumeUplift !== undefined && !(typeof p.volumeUplift === 'number' && p.volumeUplift >= 1 && p.volumeUplift <= RULES.engine.passport.maxUplift)) out.push(`passport.volumeUplift must be between 1 and ${RULES.engine.passport.maxUplift}.`);
  return out;
}

/** Two passports for the same QR whose periods meet. Together they would get around every limit that one has. */
export function passportsOverlap(a: ContextPassport, b: ContextPassport): boolean {
  if (a.linkId !== b.linkId) return false;
  const [from, until] = passportPeriod(a), [start, end] = passportPeriod(b);
  return from <= end && start <= until;
}

/** What explains payments: verified, within today's limits, and one per QR at a time (the earlier one stands). */
export function passportsInForce(sc: Scenario): ContextPassport[] {
  const valid = (sc.passports ?? []).filter(p => p.status === 'VERIFIED' && !passportErrors(p).length)
    .sort((a, b) => passportPeriod(a)[0] - passportPeriod(b)[0] || a.id.localeCompare(b.id));
  const out: ContextPassport[] = [];
  for (const p of valid) if (!out.some(q => passportsOverlap(p, q))) out.push(p);
  return out;
}

/** Payments a verified passport explains on one axis. They are set aside from that test: not counted as innocent either. */
export function passportCover(sc: Scenario): (e: PaymentEvent, axis: Axis) => boolean {
  const active = passportsInForce(sc).map(p => ({ p, period: passportPeriod(p) }));
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

/** Primary-merchant sales backed by a delivered order with unique tracking; excused on `area` only when the order feed itself is sound. */
export function deliveredOrderCover(sc: Scenario): Set<string> {
  const cnt = new Map<string, number>();
  for (const o of sc.orders) if (o.trackingId) cnt.set(o.trackingId, (cnt.get(o.trackingId) ?? 0) + 1);
  const ok = sc.orders.filter(o => o.status === 'DELIVERED' && !(o.trackingId && cnt.get(o.trackingId)! > 1));
  if (!sc.orders.length || ok.length / sc.orders.length < 0.9) return new Set(); // same bar and count as F7
  const good = ok.filter(o => o.trackingId); // an excused sale needs its own tracking
  return new Set(sc.events
    .filter(e => e.merchantId === sc.primaryMerchantId && e.type === 'SALE' && good.some(o => o.saleId === e.id || (!!e.orderId && o.orderId === e.orderId)))
    .map(e => e.id));
}

export function passportUplift(sc: Scenario, weekEnd: number): number {
  let uplift = 1;
  const ownSales = sc.events.filter(e => e.merchantId === sc.primaryMerchantId && e.type === 'SALE');
  for (const p of passportsInForce(sc)) {
    const [a, b] = passportPeriod(p);
    if (!p.volumeUplift || !(weekEnd >= a && weekEnd - 7 * DAY < b)) continue;
    const cap = Math.min(RULES.engine.passport.maxUplift, p.volumeUplift);
    // Scope volumeUplift to the passport's link share of sales so a minor side link cannot grant a 3x whole-account uplift.
    const periodSales = ownSales.filter(e => e.eventTime >= a && e.eventTime <= b);
    const baseSales = periodSales.length ? periodSales : ownSales;
    const totalAmt = baseSales.reduce((s, e) => s + e.amount, 0);
    if (totalAmt > 0 && p.linkId && p.linkId !== '*') {
      const linkAmt = baseSales.filter(e => e.linkId === p.linkId).reduce((s, e) => s + e.amount, 0);
      const share = linkAmt / totalAmt;
      const scoped = share > 0 ? Math.min(cap, 1 / Math.max(1 - share, 1 / cap)) : 1;
      uplift = Math.max(uplift, scoped);
    } else {
      uplift = Math.max(uplift, cap);
    }
  }
  return uplift;
}
