import type { Scenario, ScenarioId, CoverageKey, CoverageState } from '../types/merchant';
import { genBakery, genRotation, genFabricated, genDiwali, genSideline, genChanged, weeklySeries, type Built } from './transactions';
import { autoGraph } from './dataset';
import { PROFILES, PEERS, WEB } from './merchants';
import { GRAPHS } from './graphs';

const cov = (a: Partial<Record<CoverageKey, CoverageState>>): Record<CoverageKey, CoverageState> => ({
  acquiring: 'AVAILABLE', website: 'AVAILABLE', orders: 'MISSING', bank: 'MISSING', fulfillment: 'MISSING', calendar: 'AVAILABLE', verification: 'MISSING', ...a,
});
const ones = (n: number) => Array(n).fill(1);

function make(id: ScenarioId, built: Built, rest: Omit<Scenario, 'id' | 'events' | 'fixtures' | 'orders' | 'bankCredits' | 'profile' | 'peers' | 'web' | 'graph' | 'primaryMerchantId'>): Scenario {
  const profile = PROFILES[id];
  return { id, primaryMerchantId: profile.id, profile, peers: PEERS[id], web: WEB[id], graph: GRAPHS[id] ?? autoGraph(profile, built.events, WEB[id].embeds, PEERS[id]), events: built.events, fixtures: built.fixtures, orders: built.orders, bankCredits: built.bankCredits, ...rest };
}

const cache = new Map<ScenarioId, Scenario>();
const BAKERY = genBakery(), ROTATION = genRotation(), FABRICATED = genFabricated(), DIWALI = genDiwali(), SIDELINE = genSideline(), CHANGED = genChanged();
const PAYMENTS_ONLY = cov({ website: 'MISSING', calendar: 'MISSING' });
const builders: Record<ScenarioId, () => Scenario> = {
  bakery: () => make('bakery', BAKERY, {
    title: 'Sweet Crumbs Bakery', subtitle: 'Undeclared betting collections behind a bakery',
    blurb: 'A registered bakery in Bengaluru shows a threefold rise in UPI collections, round-number tickets from far-away states, funding that peaks before match starts, and a payment link on an undeclared betting deposit page.',
    tone: 'illicit', expectedOutcome: 'Case opened. Legitimate chain fails. Targeted link restriction recommended; in-store terminal stays live.', scriptedLabel: 'CONFIRMED_ILLICIT',
    weekly: weeklySeries(BAKERY.events, 'M-SCB-001', 11, 45000, [...ones(12), 1.1, 1.4], [...ones(12), 1.2, 1.6, 2.0, 2.0]),
    coverage: cov({}), verification: null,
    footprint: { supplierPaymentsMonthly: 42000, gstTurnoverMonthly: 200000 },
    sightings: [{ source: 'Telegram', place: 'public channel “IPL Sure Win 24×7” (synthetic)', paymentRef: 'PL-SCB-07', seenAt: '2026-10-21', note: 'Pinned post: “deposit here, instant ID”' }],
    synthetic: '3× UPI collections · ₹500/1,000/2,000 heaping · payers from 9 states · funding before match starts · refunds with no original sale · refunds to different destinations · payment link on a betting deposit page · order and bank data missing',
  }),
  sideline: () => make('sideline', SIDELINE, {
    title: 'Betting on the side', subtitle: 'A real bakery with a second, hidden business on one link',
    blurb: 'Golden Oven is a real, busy bakery. About one payment in six arrives on a second link: round top-ups from the same few distant people. On average it still looks like a bakery. Scored QR by QR, it does not. No crawler or sighting is used.',
    tone: 'illicit', expectedOutcome: 'Case opened on one link. Only that link is proposed for restriction; the counter QR stays live.', scriptedLabel: 'CONFIRMED_ILLICIT',
    weekly: weeklySeries(SIDELINE.events, 'M-GOB-061', 55, 110000, ones(14), ones(16)),
    coverage: PAYMENTS_ONLY, verification: null,
    synthetic: 'about 15% of payments on a second link · round top-ups · the same distant payers · no crawler, calendar or sightings',
  }),
  changed: () => make('changed', CHANGED, {
    title: 'Honest change: midnight delivery', subtitle: 'A business that changed for a valid reason',
    blurb: 'Moonlight Bakes started midnight cake delivery on a new link. Its hours and prices no longer match a bakery. That is a question for the merchant, not a fraud case, and a verified Context Passport answers it.',
    tone: 'benign', expectedOutcome: 'No case and no restriction. The merchant is asked what changed; a verified passport clears it.', scriptedLabel: 'ADJUDICATED_BENIGN',
    weekly: weeklySeries(CHANGED.events, 'M-MOB-112', 66, 64000, ones(14), ones(16)),
    coverage: PAYMENTS_ONLY, verification: null,
    passports: [{
      id: 'CP-DEMO-01', reason: 'Started midnight cake delivery', linkId: 'PL-MOB-NIGHT', from: '2026-10-15',
      document: 'Night menu and delivery-partner agreement (synthetic)', hours: [22, 2], ticketBand: [450, 1150], volumeUplift: 2,
      status: 'SUBMITTED', submittedBy: 'demo analyst',
    }],
    synthetic: 'a new night-delivery link · prices ending in 99 · local customers · no repeat top-ups',
  }),
  rotation: () => make('rotation', ROTATION, {
    title: 'Merchant rotation', subtitle: 'A collection account goes quiet; a replacement picks up the same pattern',
    blurb: 'Gift Galaxy Retail stops transacting on day 8. Nova Gift Emporium, a 19-day-old account, begins two days later with the same payers, similar tickets and a settlement account that matches the predecessor.',
    tone: 'illicit', expectedOutcome: 'Case opened. Rotation hypothesis leads, supported by cohort continuity and lifecycle evidence.', scriptedLabel: 'CONFIRMED_ILLICIT',
    weekly: weeklySeries(ROTATION.events, 'M-NOVA-204', 22, 90000, [null, null, null, null], ones(5), 1).map((w, i) => ({ ...w, week: `W${12 + i}` })),
    coverage: cov({}), verification: null,
    synthetic: 'Predecessor account dormant · successor opens within 2 days · 40 shared payers · same ticket heaping · evening collections outside declared hours · beneficiary changes twice and lands on the predecessor account',
  }),
  fabricated: () => make('fabricated', FABRICATED, {
    title: 'Fabricated commercial substance', subtitle: 'An online store that cannot substantiate its sales',
    blurb: 'Aarav Home Decor Online has a plausible storefront, but fewer than half of payments link to orders, shipment records reuse tracking IDs, catalogue images are shared with other stores, and most sampled purchasers deny buying.',
    tone: 'illicit', expectedOutcome: 'Case opened on four independent families. Adjudication stays unresolved until the merchant responds.', scriptedLabel: 'UNRESOLVED',
    weekly: weeklySeries(FABRICATED.events, 'M-AHD-310', 33, 110000, [...ones(10), 1.1, 1.2, 1.4, 1.9], ones(16)),
    coverage: cov({ orders: 'AVAILABLE', fulfillment: 'AVAILABLE', verification: 'AVAILABLE', calendar: 'MISSING' }), verification: { contacted: 12, confirmed: 3 },
    footprint: { supplierPaymentsMonthly: 31000, gstTurnoverMonthly: 140000 },
    synthetic: '41% of payments match an order · 22% of orders verified delivered · tracking IDs reused · duplicated catalogue imagery · 3 of 12 sampled purchasers confirm buying',
  }),
  diwali: () => make('diwali', DIWALI, {
    title: 'Legitimate Diwali growth', subtitle: 'A real bakery has a real festival peak',
    blurb: 'Anand Sweets & Bakes triples its sales in the Diwali fortnight. Customers are local, baskets fit the menu, orders and deliveries are verified, and settlements reconcile with bank credits.',
    tone: 'benign', expectedOutcome: 'No illicit case opened. The volume alarm is explained; the seasonal profile is refreshed.', scriptedLabel: 'ADJUDICATED_BENIGN',
    weekly: weeklySeries(DIWALI.events, 'M-ANS-045', 44, 36000, [...ones(12), 1.25, 1.8], [...ones(12), 1.2, 1.6, 2.0, 2.0]),
    coverage: cov({ orders: 'AVAILABLE', bank: 'AVAILABLE', fulfillment: 'AVAILABLE', verification: 'AVAILABLE' }), verification: { contacted: 10, confirmed: 10 },
    footprint: { supplierPaymentsMonthly: 220000, gstTurnoverMonthly: 520000 },
    synthetic: '3× festival volume · 96% local customers · menu-fit baskets · 98% of payments match orders · deliveries verified · settlements reconcile to bank credits',
  }),
};

export const SCENARIO_IDS: ScenarioId[] = ['bakery', 'sideline', 'changed', 'diwali', 'rotation', 'fabricated'];
export function getScenario(id: ScenarioId): Scenario {
  if (!cache.has(id)) cache.set(id, builders[id]());
  return cache.get(id)!;
}
