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
