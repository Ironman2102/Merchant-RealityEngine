/**
 * Synthetic merchants for the benchmark, red team, rule backtests and model training.
 *
 * Anti-leak rules, enforced by tests/engine/leakage.test.ts:
 *  - account age, available feeds, ledger format and volume are drawn the same way for both labels;
 *  - no merchant is a copy of another, and none is derived from the demo samples;
 *  - honest merchants include changes (night delivery, national gifting, catering, outlets) and awkward categories;
 *  - fronts include the hard ones (small side-streams, same QR, camouflage categories, mimics).
 * Parameters are written here by hand and are NOT read from rules/*.json. Everything is still synthetic.
 */
import type { MreDataset, DatasetTransaction } from '../frontend/src/data/dataset';
import type { CatalogueItem, EmbedRecord, OrderRecord } from '../frontend/src/types/merchant';
import { toIst } from '../frontend/src/data/dataset';
import { mulberry32, type Rng } from '../frontend/src/utils/prng';

type Amount = (r: Rng) => number;
type Hour = (r: Rng) => number;
interface Flow { amount: Amount; hour: Hour; far: number; pool: number; link?: string }
interface Kind { name: string; mcc: string; perDay: [number, number]; flow: Flow; side?: Flow & { share: [number, number] }; national?: boolean }

const DAY = 86400000, WEEKS = 12, LEDGER_DAYS = 28;
const END = Date.parse('2026-10-01T00:00:00+05:30');
const normal = (r: Rng) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const spread = (median: number, sigma: number): Amount => r => Math.max(8, Math.round(median * Math.exp(sigma * normal(r))));
const of = (...xs: number[]): Amount => r => xs[Math.floor(r() * xs.length)];
const either = (p: number, a: (r: Rng) => number, b: (r: Rng) => number) => (r: Rng) => (r() < p ? a(r) : b(r));
const between = (a: number, b: number): Hour => r => a + r() * (b - a);
const around = (h: number, s: number): Hour => r => (((h + s * normal(r)) % 24) + 24) % 24;
const within = (r: Rng, [a, b]: [number, number]) => a + r() * (b - a);

const SHOP: Flow = { amount: either(0.07, of(500, 1000), spread(520, 0.58)), hour: either(0.45, around(10.5, 1.6), around(18.5, 1.4)), far: 0.04, pool: 800, link: 'QR-MAIN' };
const GROCER: Flow = { amount: either(0.08, of(200, 500), spread(340, 0.85)), hour: around(14.5, 3.4), far: 0.03, pool: 420, link: 'QR-MAIN' };
const DEPOSITS: Flow = { amount: either(0.88, of(200, 300, 500, 500, 1000, 1000, 2000, 2500, 5000), spread(1100, 0.5)), hour: either(0.55, around(19.1, 0.9), between(0, 24)), far: 0.72, pool: 85, link: 'LINK-9' };
const ODD_DEPOSITS: Flow = { amount: spread(1250, 0.7), hour: either(0.5, around(20.5, 1.7), between(7, 24)), far: 0.68, pool: 75, link: 'LINK-9' };

export const HONEST: Kind[] = [
  { name: 'steady bakery', mcc: '5462', perDay: [12, 38], flow: SHOP },
  { name: 'bakery festival surge', mcc: '5462', perDay: [14, 30], flow: SHOP, side: { ...SHOP, share: [0.3, 0.6] } },
  { name: 'bakery midnight delivery', mcc: '5462', perDay: [14, 30], flow: SHOP, side: { amount: either(0.5, of(499, 649, 799, 999), spread(800, 0.3)), hour: either(0.85, between(22, 24), between(0, 1.5)), far: 0.04, pool: 1200, link: 'LINK-2', share: [0.2, 0.45] } },
  { name: 'bakery national gifting', mcc: '5462', perDay: [14, 30], flow: SHOP, side: { amount: spread(1100, 0.35), hour: between(8, 24), far: 0.85, pool: 2200, link: 'LINK-2', share: [0.2, 0.45] } },
  { name: 'bakery catering advances', mcc: '5462', perDay: [14, 30], flow: SHOP, side: { amount: of(1500, 2000, 3000, 4000, 5000), hour: between(9, 21), far: 0.05, pool: 260, link: 'LINK-2', share: [0.12, 0.3] } },
  { name: 'grocer with regulars', mcc: '5411', perDay: [20, 45], flow: GROCER },
  { name: 'wholesale grocer', mcc: '5411', perDay: [10, 20], flow: { ...GROCER, amount: either(0.3, of(1000, 2000, 5000), spread(900, 0.8)), pool: 260 } },
  { name: 'tea stall', mcc: '5814', perDay: [25, 55], flow: { amount: of(10, 15, 20, 25, 30, 40, 60, 120), hour: between(6, 22), far: 0.03, pool: 260, link: 'QR-MAIN' } },
  { name: 'restaurant', mcc: '5812', perDay: [10, 30], flow: { amount: spread(820, 0.65), hour: either(0.4, around(13.2, 1), around(20.8, 1.5)), far: 0.18, pool: 1600, link: 'QR-MAIN' } },
  { name: 'fuel station', mcc: '5541', perDay: [25, 55], flow: { amount: either(0.75, of(100, 200, 500, 500, 1000, 1500, 2000), spread(750, 0.6)), hour: between(0, 24), far: 0.3, pool: 3200, link: 'QR-MAIN' } },
  { name: 'temple trust', mcc: '8661', perDay: [12, 30], flow: { amount: of(101, 201, 501, 500, 1000, 1001, 1100, 2100), hour: either(0.5, around(8, 1.4), around(18.8, 1.4)), far: 0.4, pool: 2600, link: 'QR-MAIN' } },
  { name: 'charity', mcc: '8398', perDay: [8, 22], national: true, flow: { amount: of(100, 300, 500, 1000, 2500, 5000), hour: between(6, 24), far: 0.8, pool: 4000, link: 'QR-MAIN' } },
  { name: 'online apparel', mcc: '5651', perDay: [10, 30], national: true, flow: { amount: of(449, 599, 799, 999, 1499, 1999), hour: between(7, 24), far: 0.82, pool: 4500, link: 'QR-MAIN' } },
  { name: 'coaching fees', mcc: '8299', perDay: [3, 9], flow: { amount: of(2000, 3000, 5000, 8000, 10000, 15000), hour: between(8, 22), far: 0.3, pool: 380, link: 'QR-MAIN' } },
  { name: 'chemist', mcc: '5912', perDay: [18, 40], flow: { amount: spread(360, 0.85), hour: between(0, 24), far: 0.06, pool: 1500, link: 'QR-MAIN' } },
  { name: 'salon', mcc: '7230', perDay: [6, 16], flow: { amount: of(250, 350, 450, 500, 750, 1000), hour: between(10, 21), far: 0.03, pool: 520, link: 'QR-MAIN' } },
  { name: 'hotel', mcc: '7011', perDay: [4, 10], flow: { amount: spread(2700, 0.55), hour: between(6, 24), far: 0.72, pool: 1500, link: 'QR-MAIN' } },
  { name: 'uncatalogued category', mcc: '5992', perDay: [8, 20], flow: { amount: either(0.2, of(500, 1000), spread(700, 0.7)), hour: between(9, 21), far: 0.05, pool: 600, link: 'QR-MAIN' } },
];

export const FRONTS: Kind[] = [
  { name: 'obvious deposits', mcc: '5462', perDay: [10, 30], flow: DEPOSITS },
  { name: 'small side-stream', mcc: '5462', perDay: [18, 38], flow: SHOP, side: { ...DEPOSITS, share: [0.1, 0.2] } },
  { name: 'large side-stream', mcc: '5462', perDay: [18, 38], flow: SHOP, side: { ...DEPOSITS, share: [0.3, 0.55] } },
  { name: 'grocer side-stream', mcc: '5411', perDay: [20, 40], flow: GROCER, side: { ...DEPOSITS, share: [0.15, 0.35] } },
  { name: 'same-QR blend', mcc: '5462', perDay: [18, 38], flow: SHOP, side: { ...DEPOSITS, link: 'QR-MAIN', share: [0.15, 0.5] } },
  { name: 'non-round deposits', mcc: '5462', perDay: [10, 30], flow: ODD_DEPOSITS },
  { name: 'camouflage: fuel', mcc: '5541', perDay: [12, 30], flow: DEPOSITS },
  { name: 'camouflage: charity', mcc: '8398', perDay: [10, 22], national: true, flow: DEPOSITS },
  { name: 'camouflage: furniture', mcc: '5712', perDay: [10, 22], national: true, flow: DEPOSITS },
  { name: 'uncatalogued category front', mcc: '5992', perDay: [10, 22], flow: DEPOSITS },
  { name: 'low-volume split', mcc: '5462', perDay: [0.7, 2], flow: DEPOSITS },
  { name: 'perfect mimic', mcc: '5462', perDay: [16, 30], flow: SHOP, side: { ...SHOP, link: 'LINK-9', pool: 600, share: [0.2, 0.4] } },
];

const HOMES: [string, string][] = [['Bengaluru, India', 'KA'], ['Pune, India', 'MH'], ['Jaipur, India', 'RJ'], ['Chennai, India', 'TN'], ['Lucknow, India', 'UP'], ['Kolkata, India', 'WB']];
const FAR: Record<string, string[]> = { KA: ['DL', 'UP', 'GJ', 'WB', 'PB', 'RJ'], MH: ['DL', 'UP', 'WB', 'PB', 'TN', 'BR'], RJ: ['KA', 'TN', 'WB', 'BR', 'TS', 'KL'], TN: ['DL', 'UP', 'GJ', 'WB', 'MH', 'RJ'], UP: ['KA', 'TN', 'WB', 'GJ', 'KL', 'PB'], WB: ['KA', 'TN', 'DL', 'GJ', 'PB', 'MH'] };

export interface SyntheticMerchant { label: 0 | 1; kind: string; dataset: MreDataset }
export interface MakeOptions { id: string; seed: number; geo?: boolean; volume?: number }

/** One merchant. Links are neutral names: "LINK-2" vs "LINK-9" must never matter, and no feature reads them. */
export function makeMerchant(kind: Kind, label: 0 | 1, o: MakeOptions): SyntheticMerchant {
  const r = mulberry32(o.seed);
  // Drawn before anything depends on the label or the kind.
  const age = 30 + Math.floor(Math.pow(r(), 1.5) * 2400), [city, home] = HOMES[Math.floor(r() * HOMES.length)];
  const geo = o.geo ?? r() < 0.6, hasCalendar = r() < 0.4, refundRate = 0.005 + r() * 0.02;
  const scale = 0.85 + r() * 0.3, perDay = within(r, kind.perDay) * (o.volume ?? 1), share = kind.side ? within(r, kind.side.share) : 0;
  const matchDays = Array.from({ length: WEEKS * 7 }, () => r() < 0.4);

  const transactions: DatasetTransaction[] = [], weekly = Array<number>(WEEKS).fill(0), fixtures: string[] = [];
  let seq = 0;
  for (let d = 0; d < WEEKS * 7; d++) {
    const day = END - (WEEKS * 7 - d) * DAY, inLedger = d >= WEEKS * 7 - LEDGER_DAYS;
    if (inLedger && hasCalendar && matchDays[d]) fixtures.push(toIst(day + 19.5 * 3600000));
    const flows: [Flow, number, string][] = [[kind.flow, perDay, 'a']];
    if (kind.side && inLedger) flows.push([kind.side, perDay * share / (1 - share), 'b']);
    let dayTotal = 0;
    for (const [flow, rate, prefix] of flows) {
      const n = Math.floor(rate * (0.8 + r() * 0.4) + r());
      for (let i = 0; i < n; i++) {
        const raw = flow.amount(r), amount = raw % 50 === 0 ? raw : Math.max(8, Math.round(raw * scale));
        weekly[Math.floor(d / 7)] += amount;
        if (!inLedger) continue;
        dayTotal += amount;
        const payer = Math.floor(flow.pool * Math.pow(r(), 1.2)), away = ((payer * 2654435761) % 1000) / 1000 < flow.far;
        const t: DatasetTransaction = { id: `${o.id}-S${++seq}`, merchantId: o.id, type: 'SALE', amount, time: toIst(day + flow.hour(r) * 3600000), payerId: `${prefix}${payer}`, channel: 'UPI_LINK', paymentLinkId: flow.link };
        if (geo) t.payerState = away ? FAR[home][payer % FAR[home].length] : home;
        transactions.push(t);
        if (r() < refundRate) transactions.push({ ...t, id: `${o.id}-R${seq}`, type: 'REFUND', time: toIst(Date.parse(t.time) + 3600000), refundOfTransactionId: t.id });
      }
    }
    if (dayTotal) transactions.push({ id: `${o.id}-T${d}`, merchantId: o.id, type: 'SETTLEMENT', amount: dayTotal, time: toIst(day + DAY + 11 * 3600000), channel: 'BANK', beneficiaryAccount: `${o.id}-KYC` });
  }
  // A ledger can be empty at very low volume; one sale keeps the file valid for both labels.
  if (!transactions.some(t => t.type === 'SALE')) transactions.push({ id: `${o.id}-S0`, merchantId: o.id, type: 'SALE', amount: 250, time: toIst(END - 12 * 3600000), channel: 'UPI_LINK' });
  return {
    label, kind: kind.name,
    dataset: {
      format: 'mre-dataset/v1',
      merchant: {
        id: o.id, name: `Merchant ${o.id}`, city, mcc: kind.mcc, category: `MCC ${kind.mcc}`, products: [], ticketMin: 10, ticketMax: 2000, hours: [8, 22],
        catchment: kind.national ? 'NATIONAL' : 'LOCAL', localStates: [home], expectedRoundShare: 0.06, seasonalPeak: 1, baselineWeekly: weekly[0] || 10000,
        accountAgeDays: age, declaredDomains: [], declaredChannels: [], declaredActivity: [],
        undeclared: ['ticketMax', 'hours', 'catchment', 'expectedRoundShare'],
      },
      transactions,
      weeklySales: weekly.map((actual, i) => ({ week: toIst(END - (WEEKS - 1 - i) * 7 * DAY).slice(0, 10), actual, seasonalMultiplier: 1 })),
      matchFixtures: fixtures,
      dataAvailability: { acquiring: 'AVAILABLE', website: 'MISSING', orders: 'MISSING', bank: 'MISSING', fulfillment: 'MISSING', calendar: hasCalendar ? 'AVAILABLE' : 'MISSING', verification: 'MISSING' },
    },
  };
}

export function makePortfolio(n: number, seed: number, frontRate = 0.08, opts: { prefix?: string; volume?: number; geo?: boolean } = {}): SyntheticMerchant[] {
  const r = mulberry32(seed);
  return Array.from({ length: n }, (_, i) => {
    const front = r() < frontRate, kinds = front ? FRONTS : HONEST, kind = kinds[Math.floor(r() * kinds.length)];
    return makeMerchant(kind, front ? 1 : 0, { id: `${opts.prefix ?? 'M-PF-'}${String(i + 1).padStart(4, '0')}`, seed: Math.floor(r() * 2 ** 31), volume: opts.volume, geo: opts.geo });
  });
}

/** The same number of every kind: for suites where each kind must be seen. */
export function makeSuite(perKind: number, seed: number, opts: { volume?: number; geo?: boolean } = {}): SyntheticMerchant[] {
  const r = mulberry32(seed), out: SyntheticMerchant[] = [];
  for (const [kinds, label] of [[HONEST, 0], [FRONTS, 1]] as const)
    for (const kind of kinds) for (let i = 0; i < perKind; i++)
      out.push(makeMerchant(kind, label, { id: `M-SU-${seed}-${out.length}`, seed: Math.floor(r() * 2 ** 31), volume: opts.volume, geo: opts.geo }));
  return out;
}

/* ---------- Context feeds, for model training only ----------
 * makeMerchant() never has a website crawl, orders, deliveries or purchaser checks, so a model trained on it cannot use
 * the detectors that read them (B9, D10, F7, G2, G6). makeContextPortfolio() adds those feeds. The benchmark and red team
 * keep using makePortfolio()/makeSuite() unchanged.
 * Anti-leak: every merchant gets the feeds with the same probability whatever its label; honest merchants include messy
 * but legitimate records; betting hosts are generic synthetic names, never the demo's host. Not derived from the samples.
 */
const ONLINE_STORE: Flow = { amount: either(0.15, of(899, 1299, 1999, 2999), spread(1700, 0.6)), hour: between(8, 24), far: 0.78, pool: 2600, link: 'LINK-2' };
const FABRICATED_SALES: Flow = { amount: either(0.3, of(1499, 2399, 3299, 4999), spread(2400, 0.55)), hour: between(9, 23), far: 0.7, pool: 700, link: 'LINK-2' };

export const CONTEXT_HONEST: Kind[] = [
  ...HONEST,
  { name: 'online decor store', mcc: '5712', perDay: [6, 18], national: true, flow: ONLINE_STORE },
  { name: 'online gifting store', mcc: '5947', perDay: [6, 18], national: true, flow: { ...ONLINE_STORE, amount: spread(1100, 0.5) } },
  // Honest late-night trade, so off-hours sales alone do not read as a front.
  { name: 'cloud kitchen, night delivery', mcc: '5814', perDay: [12, 30], flow: { amount: spread(420, 0.45), hour: either(0.7, between(20, 24), between(0, 2.5)), far: 0.04, pool: 1400, link: 'LINK-2' } },
  { name: 'bakery adds night link', mcc: '5462', perDay: [14, 30], flow: SHOP, side: { amount: spread(700, 0.35), hour: either(0.8, between(21.5, 24), between(0, 2)), far: 0.04, pool: 1100, link: 'LINK-2', share: [0.25, 0.45] } },
];
export const CONTEXT_FRONTS: Kind[] = [
  ...FRONTS,
  { name: 'fabricated online store', mcc: '5712', perDay: [5, 14], national: true, flow: FABRICATED_SALES },
  { name: 'fabricated gifting store', mcc: '5947', perDay: [5, 14], national: true, flow: { ...FABRICATED_SALES, amount: spread(1900, 0.5) } },
];
type ContextMode = 'clean' | 'messy' | 'fabricated' | 'betting-embed';
const BET_HOSTS = ['luckyplay.example', 'wincircle.example', 'matchpot.example', 'oddsbay.example', 'rummyhub.example'];

/** Add whichever of a crawl, orders with deliveries, and a purchaser sample `feeds` selects, in place. */
function addContext(m: SyntheticMerchant, mode: ContextMode, feeds: { web: boolean; orders: boolean; panel: boolean }, r: Rng): void {
  const d = m.dataset, id = d.merchant.id, domain = `${id.toLowerCase()}.example`;
  const sales = d.transactions.filter(t => t.type === 'SALE');
  const links = [...new Set(sales.map(t => t.paymentLinkId).filter(Boolean))] as string[];
  const first = toIst(END - 200 * DAY).slice(0, 10);
  d.merchant.declaredDomains = [domain];
  const embeds: EmbedRecord[] = links.map((l, i) => ({ id: `${id}-E${i}`, merchantId: id, linkId: l, host: domain, path: '/checkout', category: 'own', pageType: 'checkout', firstSeen: first }));
  if (mode === 'betting-embed') {
    // The deposit link (the side flow or the only flow) is found on a betting page.
    const bet = links.find(l => l !== 'QR-MAIN') ?? links[0];
    if (bet) embeds.push({ id: `${id}-EB`, merchantId: id, linkId: bet, host: BET_HOSTS[Math.floor(r() * BET_HOSTS.length)], path: '/wallet/deposit', category: 'gambling', pageType: 'deposit page', firstSeen: toIst(END - 20 * DAY).slice(0, 10) });
  }
  if (mode === 'messy' && links[0] && r() < 0.5) embeds.push({ id: `${id}-EM`, merchantId: id, linkId: links[0], host: 'bigmarket.example', path: `/store/${id.toLowerCase()}`, category: 'marketplace', pageType: 'listing', firstSeen: first });

  // Catalogue: off-category or reused-image share by mode.
  const off = mode === 'fabricated' ? 0.4 + r() * 0.35 : mode === 'messy' ? r() * 0.08 : r() * 0.03;
  const catalogue: CatalogueItem[] = Array.from({ length: 12 + Math.floor(r() * 12) }, (_, i) => {
    const bad = r() < off;
    return { sku: `${id}-K${i}`, name: bad ? 'Unrelated item' : 'Category item', price: Math.round(200 + r() * 4000), inCategory: !(bad && r() < 0.6), dupImage: bad && r() < 0.7 };
  });

  // Orders: share of online sales with an order, delivered share, reused tracking.
  const matched = mode === 'fabricated' ? 0.3 + r() * 0.3 : mode === 'messy' ? 0.86 + r() * 0.08 : 0.96 + r() * 0.04;
  const delivered = mode === 'fabricated' ? 0.35 + r() * 0.3 : mode === 'messy' ? 0.84 + r() * 0.08 : 0.93 + r() * 0.07;
  const reuse = mode === 'fabricated' ? 0.25 + r() * 0.3 : 0;
  const orders: OrderRecord[] = [];
  for (const t of sales) {
    if (r() < matched) {
      const n = orders.length, ok = r() < delivered;
      const trackingId = reuse && n > 3 && r() < reuse ? orders[Math.floor(r() * n)].trackingId : `${id}-TRK${n}`;
      orders.push({ orderId: `${id}-O${n}`, saleId: t.id, status: ok ? 'DELIVERED' : r() < 0.5 ? 'SHIPPED' : 'NONE', trackingId });
      t.orderId = `${id}-O${n}`;
    } else t.orderId = null;
  }

  // Purchaser panel: confirmation rate by mode.
  const contacted = 8 + Math.floor(r() * 9);
  const rate = mode === 'fabricated' ? 0.1 + r() * 0.35 : mode === 'messy' ? 0.78 + r() * 0.17 : mode === 'betting-embed' ? 0.3 + r() * 0.4 : 0.85 + r() * 0.15;

  // A PA rarely has every feed: each one is attached on its own, and only those are marked available.
  if (feeds.web) { d.website = { embeds, catalogue }; d.dataAvailability = { ...d.dataAvailability, website: 'AVAILABLE' }; } else d.merchant.declaredDomains = [];
  if (feeds.orders) { d.orders = orders; d.dataAvailability = { ...d.dataAvailability, orders: 'AVAILABLE', fulfillment: 'AVAILABLE' }; } else sales.forEach(t => { delete t.orderId; });
  if (feeds.panel) { d.purchaserVerification = { contacted, confirmed: Math.min(contacted, Math.round(contacted * rate)) }; d.dataAvailability = { ...d.dataAvailability, verification: 'AVAILABLE' }; }
}

/**
 * Betting conduct that makeMerchant() never produces: deposits bunched in the 45 minutes before a match on match days
 * (detector C5), and refunds paid out to mule accounts, some with no original sale (D7, D9). Applied to some betting
 * fronts only, because these are conduct, not changes of business.
 */
function addBettingConduct(m: SyntheticMerchant, kind: Kind, r: Rng): void {
  const d = m.dataset, id = d.merchant.id;
  const depositPrefix = kind.flow === DEPOSITS || kind.flow === ODD_DEPOSITS ? 'a' : kind.side?.far === DEPOSITS.far ? 'b' : null;
  if (!depositPrefix) return;
  const deposits = d.transactions.filter(t => t.type === 'SALE' && t.payerId?.startsWith(depositPrefix));
  const starts = (d.matchFixtures ?? []).map(f => Date.parse(f));
  if (starts.length && r() < 0.6) {
    const byDay = new Map(starts.map(s => [toIst(s).slice(0, 10), s]));
    for (const t of deposits) {
      const start = byDay.get(t.time.slice(0, 10));
      if (start !== undefined && r() < 0.7) t.time = toIst(start - (5 + r() * 40) * 60000);
    }
  }
  if (r() < 0.45) {
    const mules = 2 + Math.floor(r() * 3);
    deposits.slice(0, 6 + Math.floor(r() * 8)).forEach((t, i) => {
      d.transactions.push({ id: `${id}-MR${i}`, merchantId: id, type: 'REFUND', amount: t.amount, time: toIst(Date.parse(t.time) + 2 * 3600000), channel: 'UPI_LINK', paidTo: `${id}-MULE${i % mules}`,
        ...(r() < 0.5 ? { refundOfTransactionId: t.id, payerId: t.payerId } : {}) });
    });
  }
}

/** One merchant whose website crawl, orders and purchaser panel are each attached independently of its label. */
function contextMerchant(kind: Kind, label: 0 | 1, id: string, r: Rng): SyntheticMerchant {
  const feeds = { web: r() < 0.5, orders: r() < 0.5, panel: r() < 0.4 }, modeDraw = r(), contextSeed = Math.floor(r() * 2 ** 31);
  const m = makeMerchant(kind, label, { id, seed: Math.floor(r() * 2 ** 31) });
  if (label) addBettingConduct(m, kind, mulberry32(contextSeed ^ 0x9e3779b9));
  if (feeds.web || feeds.orders || feeds.panel) {
    const mode: ContextMode = !label ? (modeDraw < 0.25 ? 'messy' : 'clean')
      : kind.name.startsWith('fabricated') ? 'fabricated'
      : modeDraw < 0.6 ? 'betting-embed' : 'clean'; // the crawler does not always find the deposit page
    addContext(m, mode, feeds, mulberry32(contextSeed));
  }
  return m;
}

/** A training portfolio where half the merchants, chosen independently of the label, carry context feeds. */
export function makeContextPortfolio(n: number, seed: number, frontRate = 0.3): SyntheticMerchant[] {
  const r = mulberry32(seed);
  return Array.from({ length: n }, (_, i) => {
    const front = r() < frontRate, kinds = front ? CONTEXT_FRONTS : CONTEXT_HONEST, kind = kinds[Math.floor(r() * kinds.length)];
    return contextMerchant(kind, front ? 1 : 0, `M-CX-${String(i + 1).padStart(4, '0')}`, r);
  });
}

/** The same number of every honest and front kind, each with context feeds half the time. */
export function makeContextSuite(perKind: number, seed: number): SyntheticMerchant[] {
  const r = mulberry32(seed), out: SyntheticMerchant[] = [];
  for (const [kinds, label] of [[CONTEXT_HONEST, 0], [CONTEXT_FRONTS, 1]] as const)
    for (const kind of kinds) for (let i = 0; i < perKind; i++) out.push(contextMerchant(kind, label, `M-CS-${seed}-${out.length}`, r));
  return out;
}
