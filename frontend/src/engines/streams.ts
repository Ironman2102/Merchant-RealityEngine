/**
 * Per-stream scoring. A bakery that takes bets on the side looks like a bakery on average, so every QR / link is also
 * scored on its own, plus the merchant's repeat payers as a group (for betting mixed into the same QR).
 * The repeat-payer group is chosen only by how often people pay, so B7 abstains inside it. B8 and B10 do not, and they
 * count payments rather than people there: a few generous regulars can open a false case. Counting people instead was
 * tried on 22 Nov 2026 and lost 80 of 3,112 caught fronts on holdout seeds, so it was not adopted.
 */
import type { Scenario } from '../types/merchant';
import type { PaymentEvent } from '../types/payment';
import type { Scope } from '../types/investigation';
import { RULES } from '../../../rules/index';
import { regulars } from './detectors';

export interface Stream { scope: Scope; events: PaymentEvent[] }

export function splitStreams(events: PaymentEvent[]): Stream[] {
  const cfg = RULES.engine.streams, sales = events.filter(e => e.type === 'SALE'), N = sales.length;
  const refunds = events.filter(e => e.type === 'REFUND');
  const withRefunds = (xs: PaymentEvent[], link?: string) => {
    const ids = new Set(xs.map(e => e.id));
    return [...xs, ...refunds.filter(r => (r.linkedSaleId && ids.has(r.linkedSaleId)) || (link && r.linkId === link))].sort((a, b) => a.eventTime - b.eventTime);
  };
  const byLink = new Map<string, PaymentEvent[]>();
  for (const e of sales) if (e.linkId) { const list = byLink.get(e.linkId); if (list) list.push(e); else byLink.set(e.linkId, [e]); }
  const out: Stream[] = [...byLink.entries()]
    .filter(([, xs]) => xs.length >= cfg.minSales && xs.length <= cfg.maxShare * N)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, cfg.maxStreams)
    .map(([id, xs]) => ({ scope: { kind: 'link', id, label: `QR / link ${id}`, sales: xs.length, share: xs.length / N }, events: withRefunds(xs, id) }));
  const repeat = regulars(sales);
  if (repeat.length >= cfg.minSales && repeat.length <= cfg.repeatCohortMaxShare * N)
    out.push({ scope: { kind: 'repeat-payers', id: 'repeat-payers', label: 'Repeat payers, across every QR', sales: repeat.length, share: repeat.length / N }, events: withRefunds(repeat) });
  return out;
}

/** Links that can be disabled on their own. The busiest link is never picked as a fallback. */
export function narrowSuspects(sc: Scenario, events: PaymentEvent[], openLinks: string[]): string[] {
  const known = new Set(RULES.hosts.known.map(h => h.host));
  const sighted = sc.web.embeds
    .filter(e => e.merchantId === sc.primaryMerchantId && !sc.profile.declaredDomains.includes(e.host) && (e.category === 'gambling' || e.category === 'resale' || known.has(e.host)))
    .map(e => e.linkId);
  // A link seen on a betting or resale page is specific by itself. A link found by behaviour is narrow only if other trade survives it.
  const out = new Set(sighted), all = new Set([...sighted, ...openLinks]);
  if (events.some(e => e.type === 'SALE' && (!e.linkId || !all.has(e.linkId)))) openLinks.forEach(l => out.add(l));
  return [...out];
}
