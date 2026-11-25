/**
 * Generates 10,000 unique, structurally fingerprinted `mre-dataset/v1` merchant datasets
 * sharded across 10 JSONL files in `tests/datasets-10k/part-01.jsonl` .. `part-10.jsonl`
 * plus `tests/datasets-10k/manifest.json`.
 *
 * Covers all 15 stress-benchmark dimensions for `mre-bayes-0.3.0`:
 * - 5,000 Illicit Fronts (2,000 standard + 2,500 hard/stealth/red-team + 500 multi-topology rings)
 * - 4,500 Genuine Merchants (2,000 clean diverse + 2,500 hard Indian-commerce/messy-data traps)
 * - 500 Honest Profile Shifts (250 ASK without passport + 250 cleared with verified Context Passport)
 * - All 39 known MCCs (30 LOCAL, 9 NATIONAL) + 10 unknown MCCs
 * - Q1..Q4 temporal drift cohorts + region/size/age/channel fairness tags
 *
 * Run: npx tsx scripts/gen-benchmark-10k.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULES } from '../rules/index';
import { normal, rng } from '../frontend/src/stats/rng';

type D = Record<string, any>;
const OUT_DIR = 'tests/datasets-10k';
const DAY = 86400000;
const HOUR = 3600000;
const MIN = 60000;
const T0 = Date.parse('2026-06-15T12:00:00+05:30');

const KNOWN_MCCS = RULES.categories().map(([code]) => code);
const LOCAL_MCCS = RULES.categories().filter(([, n]) => n.catchment === 'LOCAL').map(([c]) => c);
const UNKNOWN_MCCS = ['5999', '7399', '5967', '5968', '5969', '5993', '5995', '7299', '7311', '8999'];
const ALL_MCCS = [...KNOWN_MCCS, ...UNKNOWN_MCCS];

const METRO_STATES = ['KA', 'MH', 'DL', 'TN', 'GJ', 'WB'];
const NONMETRO_STATES = ['UP', 'RJ', 'PB', 'HR', 'TS', 'AP', 'KL'];
const ALL_STATES = [...METRO_STATES, ...NONMETRO_STATES];

const ist = (ms: number) => new Date(Math.round(ms) + 19800000).toISOString().slice(0, 19) + '+05:30';
const utc = (ms: number) => new Date(Math.round(ms)).toISOString().slice(0, 19) + 'Z';
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const randInt = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

function distantStates(home: string): string[] {
  const local = new Set([home, ...RULES.neighbours(home)]);
  return ALL_STATES.filter(s => !local.has(s));
}

export interface Manifest10k {
  idx: number;
  shard: number;
  merchantId: string;
  mcc: string;
  knownMcc: boolean;
  kind: 'front' | 'genuine' | 'profile_shift';
  expectedVerdict: 'case' | 'ask' | 'clear';
  category: string;
  typology: string;
  difficulty: 'standard' | 'hard' | 'redteam';
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  region: 'metro' | 'nonmetro';
  sizeBand: 'micro' | 'mid' | 'enterprise';
  ageBand: 'new' | 'mid' | 'established';
  channelMix: 'pos' | 'upi' | 'mixed';
  ringClusterId?: string;
  ringTopology?: string;
  hasPassport?: boolean;
  trustPassports?: boolean;
  fingerprint: string;
}

interface BaseOpts {
  nSales?: number;
  ageDays?: number;
  anchorMs?: number;
  hours?: [number, number];
  posFrac?: number;
  discreteMenu?: boolean;
  home?: string;
  weeklyMult?: number;
  extraLinks?: number;
}

function buildBase(idx: number, mcc: string, r: () => number, opts: BaseOpts = {}): { d: D; anchor: number; home: string; n: ReturnType<typeof RULES.mcc> } {
  const n = RULES.mcc(mcc);
  const anchor = opts.anchorMs ?? (T0 + randInt(r, -45, 45) * DAY);
  const home = opts.home ?? pick(r, ALL_STATES);
  const open = opts.hours?.[0] ?? n.open;
  const close = opts.hours?.[1] ?? n.close;
  const id = `M10K-${String(idx).padStart(5, '0')}`;
  const nSales = opts.nSales ?? randInt(r, 34, 95);
  const ageDays = opts.ageDays ?? pick(r, [14, 30, 44, 45, 46, 90, 180, 364, 365, 366, 730, 1400]);
  const menuPrices = opts.discreteMenu
    ? Array.from({ length: randInt(r, 4, 8) }, (_, k) => Math.max(40, Math.round(n.ticket.median * (0.4 + k * 0.25))))
    : null;
  const extraLinks = opts.extraLinks ?? 1;

  const sales: D[] = Array.from({ length: nSales }, (_, i) => {
    const amt = menuPrices
      ? pick(r, menuPrices)
      : Math.max(20, Math.min(5000000, Math.round(n.ticket.median * Math.exp(n.ticket.sigma * normal(r)))));
    const span = open < close ? Math.max(1, close - open) : (24 - open + close);
    const hr = (open + Math.floor(r() * span)) % 24;
    const dayOff = Math.floor(r() * 14);
    const time = `${ist(anchor - dayOff * DAY).slice(0, 10)}T${String(hr).padStart(2, '0')}:${String(randInt(r, 0, 59)).padStart(2, '0')}:${String(randInt(r, 0, 59)).padStart(2, '0')}+05:30`;
    const isPos = r() < (opts.posFrac ?? 0);
    const offArea = r() < n.offAreaShare;
    const payerState = offArea ? pick(r, distantStates(home)) : home;
    const linkId = isPos ? 'TERM-01' : (extraLinks > 1 ? `PL-0${(i % extraLinks) + 1}` : 'PL-01');
    return {
      id: `TX-${idx}-${i}`,
      merchantId: id,
      type: 'SALE',
      amount: amt,
      time,
      settledAt: ist(Date.parse(time) + randInt(r, 6, 24) * HOUR),
      channel: isPos ? 'POS' : 'UPI_LINK',
      paymentLinkId: linkId,
      payerId: `P-${idx}-${i}`,
      payerState,
      ...(isPos ? {} : { orderId: `ORD-${idx}-${i}` }),
    };
  });

  const total14d = sales.reduce((a, s) => a + s.amount, 0);
  const weeklyEst = Math.max(5000, Math.round((total14d / 2) * (opts.weeklyMult ?? 1)));
  const nSet = randInt(r, 4, 7);
  const setAmt = Math.max(1000, Math.round(total14d / nSet));
  const settlements: D[] = Array.from({ length: nSet }, (_, i) => ({
    id: `SET-${idx}-${i}`,
    merchantId: id,
    type: 'SETTLEMENT',
    amount: setAmt,
    time: ist(anchor - (nSet - 1 - i) * 2 * DAY),
    channel: 'BANK',
    beneficiaryAccount: `BEN-${idx}-0`,
  }));

  const weeklySales = Array.from({ length: 12 }, (_, i) => ({
    week: `W${i + 1}`,
    actual: Math.max(1000, Math.round(weeklyEst * (0.9 + 0.2 * r()))),
    seasonalMultiplier: 1,
  }));
  // Keep last 2 weeks reconciled with actual 14d ledger so H1/H2 stay valid unless explicitly broken.
  weeklySales[10].actual = Math.max(1000, Math.round(total14d * 0.48));
  weeklySales[11].actual = Math.max(1000, Math.round(total14d * 0.52));

  const orders = sales.filter(s => s.orderId).map(s => ({
    orderId: s.orderId,
    saleId: s.id,
    status: 'DELIVERED',
    trackingId: `TRK-${idx}-${s.id}`,
  }));
  const bankCredits = settlements.map(s => ({ amount: s.amount, beneficiaryAccount: s.beneficiaryAccount }));

  const d: D = {
    format: 'mre-dataset/v1',
    merchant: {
      id,
      name: `Shop ${id} (${n.name})`,
      city: `City-${home}, ${home}`,
      mcc,
      category: n.name,
      ticketMin: Math.max(10, Math.round(n.ticket.median * 0.15)),
      ticketMax: Math.max(2000, Math.round(n.ticket.median * 8)),
      baselineWeekly: weeklyEst,
      accountAgeDays: ageDays,
      hours: [open, close],
      catchment: n.catchment,
      localStates: [home],
      expectedRoundShare: n.roundShare,
      declaredDomains: [`shop${idx}.in`],
      products: ['Standard Item A', 'Standard Item B'],
    },
    weeklySales,
    transactions: [...sales, ...settlements],
    orders,
    bankCredits,
    website: {
      embeds: [{ id: `EMB-${idx}-0`, merchantId: id, linkId: 'PL-01', host: `shop${idx}.in`, path: '/checkout', category: 'own', pageType: 'checkout', firstSeen: ist(anchor - 14 * DAY) }],
      catalogue: Array.from({ length: 6 }, (_, k) => ({ sku: `SKU-${idx}-${k + 1}`, name: `${n.name} Item ${k + 1}`, price: Math.round(n.ticket.median), inCategory: true, dupImage: false })),
    },
    purchaserVerification: { contacted: 12, confirmed: 11 },
    dataAvailability: {
      acquiring: 'AVAILABLE',
      website: 'AVAILABLE',
      orders: 'AVAILABLE',
      bank: 'AVAILABLE',
      fulfillment: 'AVAILABLE',
      calendar: 'MISSING',
      verification: 'AVAILABLE',
    },
  };
  return { d, anchor, home, n };
}

function ownSales(d: D): D[] {
  return d.transactions.filter((t: D) => t.merchantId === d.merchant.id && t.type === 'SALE');
}
function ownSets(d: D): D[] {
  return d.transactions.filter((t: D) => t.merchantId === d.merchant.id && t.type === 'SETTLEMENT');
}

function reconcileWeekly(d: D): void {
  const s = ownSales(d);
  const tot = s.reduce((a: number, x: D) => a + x.amount, 0);
  if (d.weeklySales.length >= 2 && tot > 0) {
    d.weeklySales[d.weeklySales.length - 2].actual = Math.max(1000, Math.round(tot * 0.49));
    d.weeklySales[d.weeklySales.length - 1].actual = Math.max(1000, Math.round(tot * 0.51));
  }
}

function injectIllicitOnSubset(d: D, sales: D[], r: () => number, home: string, anchor: number, opts: {
  roundAmts?: number[]; offHour?: boolean; distant?: boolean; repeatPayers?: number; linkId?: string;
  risingTopups?: boolean; unmatchOrders?: boolean;
}) {
  const dist = distantStates(home);
  const amts = opts.roundAmts ?? [500, 1000, 2000, 5000];
  const repCount = opts.repeatPayers ?? 0;
  sales.forEach((s, i) => {
    s.amount = pick(r, amts);
    if (opts.offHour) {
      const hr = pick(r, [0, 1, 2, 3, 4]);
      s.time = `${s.time.slice(0, 11)}${String(hr).padStart(2, '0')}:${String(randInt(r, 0, 59)).padStart(2, '0')}:00+05:30`;
    }
    if (opts.distant) s.payerState = pick(r, dist);
    if (repCount > 0) s.payerId = `REP-${d.merchant.id}-${i % repCount}`;
    if (opts.linkId) {
      s.paymentLinkId = opts.linkId;
      s.channel = 'UPI_LINK';
    }
    if (opts.unmatchOrders) delete s.orderId;
  });
  if (opts.risingTopups && sales.length >= 12) {
    const baseMs = anchor - 2 * DAY;
    const runAmts = [300, 600, 1200, 2500];
    for (let g = 0; g < Math.min(6, Math.floor(sales.length / 4)); g++) {
      const pid = `CHASE-${d.merchant.id}-${g}`;
      for (let k = 0; k < 4; k++) {
        const s = sales[g * 4 + k];
        s.payerId = pid;
        s.amount = runAmts[k];
        s.time = ist(baseMs + g * 5 * HOUR + k * 22 * MIN);
        s.payerState = pick(r, dist);
      }
    }
  }
}

function addPayoutSweeps(d: D, r: () => number, countAccounts: number, lagHours: number) {
  const sets = ownSets(d);
  sets.forEach((s: D, i: number) => {
    d.transactions.push({
      id: `TR-${d.merchant.id}-${i}`,
      merchantId: d.merchant.id,
      type: 'TRANSFER',
      amount: Math.round(s.amount * 0.94),
      time: ist(Date.parse(s.time) + lagHours * HOUR),
      channel: 'BANK',
      paidTo: `MULE-${d.merchant.id}-${i % countAccounts}`,
    });
  });
  for (let k = sets.length; k < countAccounts; k++) {
    d.transactions.push({
      id: `TR-EX-${d.merchant.id}-${k}`,
      merchantId: d.merchant.id,
      type: 'TRANSFER',
      amount: randInt(r, 3000, 15000),
      time: ist(Date.parse(sets[0].time) + (k + 1) * HOUR),
      channel: 'BANK',
      paidTo: `MULE-${d.merchant.id}-${k}`,
    });
  }
}

function addDormantPeer(d: D, anchor: number, r: () => number, shareBen: boolean, overlapFrac = 0.8) {
  const sales = ownSales(d);
  const peerId = `PEER-${d.merchant.id}`;
  const lastSaleMs = anchor - 18 * DAY;
  d.peers = [{ id: peerId, name: `Dormant ${peerId}`, mcc: d.merchant.mcc, status: 'DORMANT', lastActive: ist(lastSaleMs) }];
  const nOverlap = Math.max(12, Math.floor(sales.length * overlapFrac));
  for (let i = 0; i < nOverlap; i++) {
    d.transactions.push({
      id: `PTX-${d.merchant.id}-${i}`,
      merchantId: peerId,
      type: 'SALE',
      amount: sales[i].amount,
      time: ist(lastSaleMs - randInt(r, 1, 10) * DAY),
      channel: 'UPI_LINK',
      payerId: sales[i].payerId,
      payerState: sales[i].payerState,
    });
  }
  if (shareBen) {
    const ben = ownSets(d)[0]?.beneficiaryAccount ?? `BEN-${d.merchant.id}-0`;
    d.transactions.push({
      id: `PSET-${d.merchant.id}`,
      merchantId: peerId,
      type: 'SETTLEMENT',
      amount: 45000,
      time: ist(lastSaleMs),
      channel: 'BANK',
      beneficiaryAccount: ben,
    });
  }
}

// ============================================================================
// Allocation plan: exactly 10,000 cases
// ============================================================================
interface Spec {
  count: number;
  kind: 'front' | 'genuine' | 'profile_shift';
  expectedVerdict: 'case' | 'ask' | 'clear';
  category: string;
  typology: string;
  difficulty: 'standard' | 'hard' | 'redteam';
  mccPool?: readonly string[];
  trustPassports?: boolean;
  mutate: (d: D, idx: number, r: () => number, anchor: number, home: string, localIdx: number) => void;
}

const SPECS: Spec[] = [
  // ======================== 1. STANDARD FRONTS (2,000) ========================
  {
    count: 350, kind: 'front', expectedVerdict: 'case', category: 'Betting & Gambling Fronts', typology: 'web-gambling-embed', difficulty: 'standard',
    mutate: (d, _idx, r, anchor, home) => {
      const sales = ownSales(d);
      injectIllicitOnSubset(d, sales.slice(0, Math.floor(sales.length * 0.7)), r, home, anchor, { roundAmts: [500, 1000, 2000, 5000], offHour: true, distant: true, repeatPayers: 6 });
      d.website.embeds.push(
        { id: `EMB-GAMB-${d.merchant.id}-1`, merchantId: d.merchant.id, linkId: 'PL-01', host: 'win365.bet', path: '/deposit', category: 'gambling', pageType: 'deposit', firstSeen: ist(anchor - 10 * DAY) },
        { id: `EMB-GAMB-${d.merchant.id}-2`, merchantId: `OTHER-MER-${d.merchant.id}`, linkId: 'PL-99', host: 'win365.bet', path: '/deposit', category: 'gambling', pageType: 'deposit', firstSeen: ist(anchor - 10 * DAY) },
      );
      d.matchFixtures = [ist(anchor - 2 * DAY), ist(anchor - 5 * DAY), ist(anchor - 9 * DAY)];
      d.dataAvailability.calendar = 'AVAILABLE';
      sales.slice(0, 15).forEach((s, i) => { s.time = ist(Date.parse(d.matchFixtures[i % 3]) - randInt(r, 5, 35) * MIN); });
      reconcileWeekly(d);
    },
  },
  {
    count: 300, kind: 'front', expectedVerdict: 'case', category: 'Betting & Gambling Fronts', typology: 'b8-deposit-conduct', difficulty: 'standard',
    mutate: (d, _idx, r, anchor, home) => {
      const sales = ownSales(d);
      injectIllicitOnSubset(d, sales.slice(0, Math.floor(sales.length * 0.65)), r, home, anchor, { roundAmts: [300, 500, 1000, 2000], distant: true, repeatPayers: 5, risingTopups: true });
      addPayoutSweeps(d, r, 10, 4);
      reconcileWeekly(d);
    },
  },
  {
    count: 300, kind: 'front', expectedVerdict: 'case', category: 'Rotation & Phoenix Fronts', typology: 'rotation-dormant-handoff', difficulty: 'standard',
    mutate: (d, _idx, r, anchor, _home) => {
      d.merchant.accountAgeDays = randInt(r, 10, 38);
      addDormantPeer(d, anchor, r, true, 0.85);
      const sets = ownSets(d);
      sets.forEach((s, i) => { s.beneficiaryAccount = `BEN-ROT-${d.merchant.id}-${i}`; });
    },
  },
  {
    count: 350, kind: 'front', expectedVerdict: 'case', category: 'Fabricated Substance Shells', typology: 'shell-full-fake', difficulty: 'standard',
    mutate: (d, _idx, r, _anchor, _home) => {
      d.orders = d.orders.slice(0, Math.floor(d.orders.length * 0.25));
      d.orders.forEach((o: D) => { o.status = 'NONE'; o.trackingId = 'TRK-REUSED-1'; });
      d.website.catalogue.forEach((c: D) => { c.inCategory = false; c.dupImage = true; });
      d.purchaserVerification = { contacted: 15, confirmed: 2 };
      d.bankCredits = d.bankCredits.slice(0, 1);
    },
  },
  {
    count: 350, kind: 'front', expectedVerdict: 'case', category: 'Mule & Payout Laundering', typology: 'payout-fanout-sweep', difficulty: 'standard',
    mutate: (d, _idx, r, _anchor, _home) => {
      addPayoutSweeps(d, r, randInt(r, 12, 20), randInt(r, 1, 8));
      const sets = ownSets(d);
      sets.forEach((s, i) => { s.beneficiaryAccount = `BEN-HOP-${d.merchant.id}-${i}`; });
      d.bankCredits = d.bankCredits.slice(0, 1);
    },
  },
  {
    count: 350, kind: 'front', expectedVerdict: 'case', category: 'Account Takeovers', typology: 'takeover-3wk-surge', difficulty: 'standard',
    mutate: (d, _idx, r, anchor, home) => {
      const sales = ownSales(d);
      injectIllicitOnSubset(d, sales.slice(0, Math.floor(sales.length * 0.7)), r, home, anchor, { roundAmts: [1000, 2000, 5000], offHour: true, distant: true, repeatPayers: 6 });
      const base = d.merchant.baselineWeekly;
      d.weeklySales.forEach((w: D, i: number) => { w.actual = i >= 9 ? Math.round(base * 4.2) : Math.round(base * (0.95 + 0.1 * r())); });
      d.website.embeds.push(
        { id: `EMB-SHAD-${d.merchant.id}-1`, merchantId: d.merchant.id, linkId: 'PL-01', host: 'shadow-pay-hub.net', path: '/pay', category: 'unknown', pageType: 'checkout', firstSeen: ist(anchor - 7 * DAY) },
        { id: `EMB-SHAD-${d.merchant.id}-2`, merchantId: `OTHER-SH-${d.merchant.id}`, linkId: 'PL-88', host: 'shadow-pay-hub.net', path: '/pay', category: 'unknown', pageType: 'checkout', firstSeen: ist(anchor - 7 * DAY) },
      );
      addPayoutSweeps(d, r, 10, 3);
    },
  },

  // ======================== 2. HARD / STEALTH / RED-TEAM FRONTS (2,500) ========================
  {
    count: 200, kind: 'front', expectedVerdict: 'case', category: 'Low-Intensity Hybrid Fronts', typology: 'hybrid-15pct', difficulty: 'hard',
    mutate: (d, _idx, r, anchor, home) => {
      const sales = ownSales(d);
      injectIllicitOnSubset(d, sales.slice(0, Math.max(8, Math.floor(sales.length * 0.15))), r, home, anchor, { roundAmts: [500, 1000, 2000], offHour: true, distant: true, repeatPayers: 3 });
      reconcileWeekly(d);
    },
  },
  {
    count: 200, kind: 'front', expectedVerdict: 'case', category: 'Low-Intensity Hybrid Fronts', typology: 'hybrid-25pct', difficulty: 'hard',
    mutate: (d, _idx, r, anchor, home) => {
      const sales = ownSales(d);
      injectIllicitOnSubset(d, sales.slice(0, Math.max(12, Math.floor(sales.length * 0.25))), r, home, anchor, { roundAmts: [500, 1000, 2000, 5000], offHour: true, distant: true, repeatPayers: 4 });
      reconcileWeekly(d);
    },
  },
  {
    count: 250, kind: 'front', expectedVerdict: 'case', category: 'Multi-Stream Hiding', typology: 'sub-qr-stream-hide', difficulty: 'hard',
    mutate: (d, _idx, r, anchor, home) => {
      // 70% clean POS/QR sales + 1 hidden illicit payment link with 35 sales (>= streams.minSales=30)
      const hidden: D[] = Array.from({ length: 36 }, (_, i) => {
        const dist = distantStates(home);
        const amt = pick(r, [500, 1000, 2000, 5000]);
        const tm = ist(anchor - Math.floor(i / 3) * DAY - randInt(r, 1, 180) * MIN);
        return {
          id: `HID-${d.merchant.id}-${i}`,
          merchantId: d.merchant.id,
          type: 'SALE',
          amount: amt,
          time: tm,
          settledAt: ist(Date.parse(tm) + 6 * HOUR),
          channel: 'UPI_LINK',
          paymentLinkId: 'PL-HIDDEN-BET',
          payerId: `HBET-${d.merchant.id}-${i % 5}`,
          payerState: pick(r, dist),
        };
      });
      d.transactions.push(...hidden);
      reconcileWeekly(d);
    },
  },
  {
    count: 200, kind: 'front', expectedVerdict: 'case', category: 'Red-Team Adaptive Evasion', typology: 'sub-minsales-shard', difficulty: 'redteam',
    mutate: (d, _idx, r, anchor, home) => {
      // Splits 120 illicit sales across 5 links x 24 sales each (just under streams.minSales=30)
      const dist = distantStates(home);
      for (let l = 0; l < 5; l++) {
        for (let i = 0; i < 24; i++) {
          const tm = ist(anchor - (i % 12) * DAY);
          d.transactions.push({
            id: `SHD-${d.merchant.id}-${l}-${i}`,
            merchantId: d.merchant.id,
            type: 'SALE',
            amount: pick(r, [500, 1000, 2000]),
            time: tm,
            settledAt: ist(Date.parse(tm) + 8 * HOUR),
            channel: 'UPI_LINK',
            paymentLinkId: `PL-SHARD-${l}`,
            payerId: `SHP-${d.merchant.id}-${(l * 3 + (i % 3))}`,
            payerState: pick(r, dist),
          });
        }
      }
      reconcileWeekly(d);
    },
  },
  {
    count: 200, kind: 'front', expectedVerdict: 'case', category: 'Red-Team Adaptive Evasion', typology: 'slow-boil-takeover', difficulty: 'redteam',
    mutate: (d, _idx, r, anchor, home) => {
      const sales = ownSales(d);
      injectIllicitOnSubset(d, sales.slice(0, Math.floor(sales.length * 0.35)), r, home, anchor, { roundAmts: [500, 1000, 2000], distant: true, repeatPayers: 5 });
      const base = d.merchant.baselineWeekly;
      // Gradual 12-week ramp trying to avoid sudden CUSUM changepoint
      d.weeklySales.forEach((w: D, i: number) => { w.actual = Math.round(base * (1 + i * 0.14)); });
      addPayoutSweeps(d, r, 8, 12);
    },
  },
  {
    count: 200, kind: 'front', expectedVerdict: 'case', category: 'Red-Team Adaptive Evasion', typology: 'benign-padding-camouflage', difficulty: 'redteam',
    mutate: (d, _idx, r, anchor, home) => {
      const sales = ownSales(d);
      injectIllicitOnSubset(d, sales.slice(0, 32), r, home, anchor, { roundAmts: [1000, 2000, 5000], offHour: true, distant: true, repeatPayers: 5, linkId: 'PL-REAL-FRONT' });
      // Inject 100 tiny ₹15 local POS sales to dilute global shares
      for (let i = 0; i < 100; i++) {
        const tm = ist(anchor - (i % 13) * DAY);
        d.transactions.push({
          id: `PAD-${d.merchant.id}-${i}`,
          merchantId: d.merchant.id,
          type: 'SALE',
          amount: 15 + (i % 7),
          time: tm,
          channel: 'POS',
          paymentLinkId: 'TERM-PAD',
          payerId: `PADP-${d.merchant.id}-${i}`,
          payerState: home,
        });
      }
      reconcileWeekly(d);
    },
  },
  {
    count: 200, kind: 'front', expectedVerdict: 'case', category: 'Red-Team Adaptive Evasion', typology: 'passport-abuse-front', difficulty: 'redteam', trustPassports: true,
    mutate: (d, _idx, r, anchor, home) => {
      // Fraudster files a VALID verified Context Passport covering hours/states/tickets, BUT has real conduct signals (B8/B10/I3/G6)
      const sales = ownSales(d);
      injectIllicitOnSubset(d, sales.slice(0, Math.floor(sales.length * 0.6)), r, home, anchor, { roundAmts: [500, 1000, 2000], offHour: true, distant: true, repeatPayers: 5, risingTopups: true });
      addPayoutSweeps(d, r, 10, 4);
      d.contextPassports = [{
        id: `PP-ABUSE-${d.merchant.id}`,
        reason: 'Claimed late-night festival catering expansion',
        linkId: 'PL-01',
        from: ist(anchor - 20 * DAY).slice(0, 10),
        until: ist(anchor + 20 * DAY).slice(0, 10),
        document: 'trade-license-2026.pdf',
        status: 'VERIFIED',
        hours: [0, 6],
        states: ['*'],
        ticketBand: [400, 3500],
        volumeUplift: 2.5,
      }];
      reconcileWeekly(d);
    },
  },
  {
    count: 200, kind: 'front', expectedVerdict: 'case', category: 'Mule & Refund Laundering', typology: 'thirdparty-refund-ring', difficulty: 'hard',
    mutate: (d, _idx, r, anchor, _home) => {
      const sales = ownSales(d);
      const nRef = randInt(r, 6, 14);
      for (let i = 0; i < nRef; i++) {
        const s = sales[i % sales.length];
        d.transactions.push({
          id: `REF3P-${d.merchant.id}-${i}`,
          merchantId: d.merchant.id,
          type: 'REFUND',
          amount: randInt(r, 6000, 18000),
          time: ist(anchor - (i % 10) * DAY),
          channel: 'UPI_LINK',
          payerId: s.payerId,
          paidTo: `MULE-DEST-${d.merchant.id}-${i % 4}`,
          refundOfTransactionId: s.id,
        });
      }
      addPayoutSweeps(d, r, 8, 5);
    },
  },
  {
    count: 200, kind: 'front', expectedVerdict: 'case', category: 'Mule & Refund Laundering', typology: 'orphan-refund-ring', difficulty: 'hard',
    mutate: (d, _idx, r, anchor, _home) => {
      const nRef = randInt(r, 6, 14);
      for (let i = 0; i < nRef; i++) {
        d.transactions.push({
          id: `REFORP-${d.merchant.id}-${i}`,
          merchantId: d.merchant.id,
          type: 'REFUND',
          amount: randInt(r, 2500, 12000),
          time: ist(anchor - (i % 10) * DAY),
          channel: 'UPI_LINK',
          payerId: `ORPH-${d.merchant.id}-${i}`,
          paidTo: `MULE-ORPH-${d.merchant.id}-${i % 3}`,
        });
      }
      addPayoutSweeps(d, r, 8, 6);
    },
  },
  {
    count: 150, kind: 'front', expectedVerdict: 'case', category: 'Red-Team Adaptive Evasion', typology: 'threshold-hug-epsilon', difficulty: 'redteam',
    mutate: (d, _idx, r, anchor, home) => {
      // Hugs just below single-detector triggers: 3 deposits/payer (below B8=4), 7/wk (below B7=8), 25h sweep (above I3=24h), ₹495 smurfing
      const sales = ownSales(d);
      const dist = distantStates(home);
      sales.slice(0, 36).forEach((s, i) => {
        s.amount = pick(r, [495, 995, 1995]);
        s.payerId = `HUG-${d.merchant.id}-${Math.floor(i / 3)}`;
        s.payerState = pick(r, dist);
      });
      addPayoutSweeps(d, r, 7, 25);
      d.orders = d.orders.slice(0, Math.floor(d.orders.length * 0.55));
      reconcileWeekly(d);
    },
  },
  {
    count: 200, kind: 'front', expectedVerdict: 'case', category: 'Unknown-MCC Conduct Fronts', typology: 'unknown-mcc-conduct-front', difficulty: 'hard', mccPool: UNKNOWN_MCCS,
    mutate: (d, _idx, r, anchor, home) => {
      const sales = ownSales(d);
      injectIllicitOnSubset(d, sales.slice(0, Math.floor(sales.length * 0.6)), r, home, anchor, { roundAmts: [500, 1000, 2000], distant: true, repeatPayers: 5, risingTopups: true });
      addPayoutSweeps(d, r, 8, 4);
      reconcileWeekly(d);
    },
  },
  {
    count: 150, kind: 'front', expectedVerdict: 'case', category: 'Evasion & Smurfing Fronts', typology: 'telegram-no-web-c6', difficulty: 'hard',
    mutate: (d, _idx, r, anchor, home) => {
      d.website = { embeds: [], catalogue: [] };
      d.dataAvailability.website = 'MISSING';
      d.dataAvailability.orders = 'MISSING';
      d.dataAvailability.fulfillment = 'MISSING';
      d.dataAvailability.verification = 'MISSING';
      d.dataAvailability.bank = 'MISSING';
      d.orders = [];
      d.bankCredits = [];
      d.purchaserVerification = null;
      const sales = ownSales(d);
      injectIllicitOnSubset(d, sales.slice(0, Math.floor(sales.length * 0.65)), r, home, anchor, { roundAmts: [500, 1000, 2000], offHour: true, distant: true, repeatPayers: 5, risingTopups: true });
      reconcileWeekly(d);
    },
  },
  {
    count: 150, kind: 'front', expectedVerdict: 'case', category: 'Evasion & Smurfing Fronts', typology: 'k1-kyc-lie-and-r01', difficulty: 'hard',
    mutate: (d, _idx, r, anchor, home) => {
      // Fraudster inflates own KYC declaration to [0,24], NATIONAL, ticketMax=100000, roundShare=0.8
      d.merchant.hours = [0, 24];
      d.merchant.catchment = 'NATIONAL';
      d.merchant.ticketMax = 100000;
      d.merchant.expectedRoundShare = 0.8;
      const sales = ownSales(d);
      injectIllicitOnSubset(d, sales.slice(0, Math.floor(sales.length * 0.55)), r, home, anchor, { roundAmts: [500, 1000, 5000], offHour: true, distant: true, repeatPayers: 5 });
      d.website.embeds.push({ id: `EMB-R01-${d.merchant.id}`, merchantId: d.merchant.id, linkId: 'PL-01', host: 'win365.bet', path: '/deposit', category: 'gambling', pageType: 'deposit', firstSeen: ist(anchor - 8 * DAY) });
      reconcileWeekly(d);
    },
  },

  // ======================== 3. CROSS-MERCHANT RINGS (500) ========================
  {
    count: 100, kind: 'front', expectedVerdict: 'case', category: 'Cross-Merchant Rings', typology: 'ring-star-ben', difficulty: 'hard',
    mutate: (d, _idx, r, anchor, home, localIdx) => {
      const cluster = Math.floor(localIdx / 10); // 10 stars x 10 merchants
      const sharedBen = `RING-STAR-BEN-${cluster}`;
      ownSets(d).forEach(s => { s.beneficiaryAccount = sharedBen; });
      d.bankCredits.forEach((b: D) => { b.beneficiaryAccount = sharedBen; });
      const sales = ownSales(d);
      injectIllicitOnSubset(d, sales.slice(0, Math.floor(sales.length * 0.5)), r, home, anchor, { roundAmts: [500, 1000, 2000], distant: true, repeatPayers: 5 });
      addPayoutSweeps(d, r, 6, 4);
      reconcileWeekly(d);
    },
  },
  {
    count: 100, kind: 'front', expectedVerdict: 'case', category: 'Cross-Merchant Rings', typology: 'ring-clique-payers', difficulty: 'hard',
    mutate: (d, _idx, r, anchor, home, localIdx) => {
      const cluster = Math.floor(localIdx / 5); // 20 cliques x 5 merchants
      const sales = ownSales(d);
      const nShared = Math.min(24, Math.floor(sales.length * 0.5));
      for (let i = 0; i < nShared; i++) {
        sales[i].payerId = `CLIQUE-P-${cluster}-${i % 8}`;
        sales[i].amount = pick(r, [500, 1000, 2000]);
        sales[i].payerState = pick(r, distantStates(home));
      }
      addPayoutSweeps(d, r, 6, 6);
      reconcileWeekly(d);
    },
  },
  {
    count: 100, kind: 'front', expectedVerdict: 'case', category: 'Cross-Merchant Rings', typology: 'ring-phoenix-chain', difficulty: 'hard',
    mutate: (d, _idx, r, anchor, _home, localIdx) => {
      const cluster = Math.floor(localIdx / 4); // 25 chains x 4 generations
      const gen = localIdx % 4;
      d.merchant.accountAgeDays = 12 + gen * 8;
      const sharedBen = `PHOENIX-BEN-${cluster}`;
      ownSets(d).forEach(s => { s.beneficiaryAccount = sharedBen; });
      d.bankCredits.forEach((b: D) => { b.beneficiaryAccount = sharedBen; });
      const sales = ownSales(d);
      for (let i = 0; i < Math.min(18, sales.length); i++) sales[i].payerId = `PHX-P-${cluster}-${i}`;
      addDormantPeer(d, anchor, r, true, 0.8);
    },
  },
  {
    count: 100, kind: 'front', expectedVerdict: 'case', category: 'Cross-Merchant Rings', typology: 'ring-bipartite-hub', difficulty: 'hard',
    mutate: (d, _idx, r, anchor, home, localIdx) => {
      const cluster = Math.floor(localIdx / 8); // 12-13 clusters x 8 merchants
      const hubA = `BIP-HUB-${cluster}-A`;
      const hubB = `BIP-HUB-${cluster}-B`;
      ownSets(d).forEach((s, i) => { s.beneficiaryAccount = i % 2 === 0 ? hubA : hubB; });
      d.bankCredits = ownSets(d).map(s => ({ amount: s.amount, beneficiaryAccount: s.beneficiaryAccount }));
      const sales = ownSales(d);
      injectIllicitOnSubset(d, sales.slice(0, Math.floor(sales.length * 0.45)), r, home, anchor, { roundAmts: [500, 1000, 2000], distant: true, repeatPayers: 4 });
      reconcileWeekly(d);
    },
  },
  {
    count: 100, kind: 'front', expectedVerdict: 'case', category: 'Cross-Merchant Rings', typology: 'ring-quiet-individual', difficulty: 'redteam',
    mutate: (d, _idx, r, _anchor, _home, localIdx) => {
      // Individually quiet merchants (no single-shop blasting), linked across cluster by shared beneficiary + 6 shared payers
      const cluster = Math.floor(localIdx / 5);
      const sharedBen = `QUIET-RING-BEN-${cluster}`;
      ownSets(d).forEach(s => { s.beneficiaryAccount = sharedBen; });
      d.bankCredits.forEach((b: D) => { b.beneficiaryAccount = sharedBen; });
      const sales = ownSales(d);
      for (let i = 0; i < Math.min(6, sales.length); i++) sales[i].payerId = `QUIET-P-${cluster}-${i}`;
    },
  },

  // ======================== 4. CLEAN GENUINE BASELINE (2,000) ========================
  {
    count: 1700, kind: 'genuine', expectedVerdict: 'clear', category: 'Clean Diverse Shops', typology: 'clean-known-mcc', difficulty: 'standard', mccPool: KNOWN_MCCS,
    mutate: () => { /* clean baseline */ },
  },
  {
    count: 300, kind: 'genuine', expectedVerdict: 'clear', category: 'Clean Diverse Shops', typology: 'clean-unknown-mcc', difficulty: 'standard', mccPool: UNKNOWN_MCCS,
    mutate: () => { /* clean baseline on unknown MCC */ },
  },

  // ======================== 5. HARD GENUINE TRAPS & INDIAN COMMERCE (2,500) ========================
  {
    count: 200, kind: 'genuine', expectedVerdict: 'clear', category: 'Indian Commerce Traps', typology: 'indian-salary-fee-spike', difficulty: 'hard', mccPool: ['8299', '8220', '7011', '7997', '8398', '8661'],
    mutate: (d, _idx, r, anchor) => {
      const sales = ownSales(d);
      // 1st-5th of month round fee payments by DISTINCT local students/donors (no repeat deposit abuse)
      sales.slice(0, Math.floor(sales.length * 0.45)).forEach((s, i) => {
        s.amount = pick(r, [1000, 2000, 5000, 10000]);
        s.time = `${ist(anchor - (i % 5) * DAY).slice(0, 10)}T11:${String(randInt(r, 0, 59)).padStart(2, '0')}:00+05:30`;
      });
      reconcileWeekly(d);
    },
  },
  {
    count: 200, kind: 'genuine', expectedVerdict: 'clear', category: 'Indian Commerce Traps', typology: 'indian-recurring-emi-tiffin', difficulty: 'hard', mccPool: ['5814', '5411', '5451', '7997'],
    mutate: (d, _idx, r) => {
      // Honest local regulars paying ₹120 / ₹150 / ₹180 (non-₹100-multiple or <₹200) 5-7x in 14d
      const sales = ownSales(d);
      sales.slice(0, Math.floor(sales.length * 0.4)).forEach((s, i) => {
        s.amount = pick(r, [80, 120, 150, 180, 240, 350]);
        s.payerId = `TIFFIN-${d.merchant.id}-${i % 8}`;
      });
      reconcileWeekly(d);
    },
  },
  {
    count: 200, kind: 'genuine', expectedVerdict: 'clear', category: 'Indian Commerce Traps', typology: 'indian-airport-pilgrim-hub', difficulty: 'hard', mccPool: ['5812', '5462', '5947', '4121'],
    mutate: (d, _idx, r, _anchor, home) => {
      // High out-of-state travellers (one-off distinct payers, no repeat conduct)
      const dist = distantStates(home);
      const sales = ownSales(d);
      sales.slice(0, Math.floor(sales.length * 0.65)).forEach(s => { s.payerState = pick(r, dist); });
    },
  },
  {
    count: 200, kind: 'genuine', expectedVerdict: 'clear', category: 'Indian Commerce Traps', typology: 'indian-b2b-wholesale', difficulty: 'hard', mccPool: ['5045', '5251', '5122', '5712'],
    mutate: (d, _idx, r) => {
      const sales = ownSales(d);
      sales.forEach(s => { s.amount = Math.round(randInt(r, 8000, 120000) / 100) * 100 + 50; });
      reconcileWeekly(d);
    },
  },
  {
    count: 100, kind: 'genuine', expectedVerdict: 'clear', category: 'Indian Commerce Traps', typology: 'indian-franchise-shared-ben', difficulty: 'hard',
    mutate: (d, _idx, _r, _anchor, _home, localIdx) => {
      const franchise = Math.floor(localIdx / 4); // 25 franchises x 4 honest outlets sharing parent bank account
      const ben = `FRANCHISE-CORP-${franchise}`;
      ownSets(d).forEach(s => { s.beneficiaryAccount = ben; });
      d.bankCredits.forEach((b: D) => { b.beneficiaryAccount = ben; });
    },
  },
  {
    count: 100, kind: 'genuine', expectedVerdict: 'clear', category: 'Indian Commerce Traps', typology: 'indian-techpark-shared-payers', difficulty: 'hard',
    mutate: (d, _idx, _r, _anchor, _home, localIdx) => {
      const park = Math.floor(localIdx / 2); // 50 honest pairs sharing 6 office-lunch payers
      const sales = ownSales(d);
      for (let i = 0; i < Math.min(6, sales.length); i++) sales[i].payerId = `TECHPARK-LUNCH-${park}-${i}`;
    },
  },
  {
    count: 150, kind: 'genuine', expectedVerdict: 'clear', category: 'Genuine Timing & Calendar Traps', typology: 'sports-bar-local-match', difficulty: 'hard', mccPool: ['5812', '5813', '5814'],
    mutate: (d, _idx, r, anchor, home) => {
      // Busy pre-match crowd of LOCAL payers (C5 fires as profile, B6 stays benign -> must NOT open case!)
      d.matchFixtures = [ist(anchor - 2 * DAY), ist(anchor - 5 * DAY), ist(anchor - 9 * DAY)];
      d.dataAvailability.calendar = 'AVAILABLE';
      const sales = ownSales(d);
      sales.forEach(s => { s.payerState = home; });
      sales.slice(0, 18).forEach((s, i) => { s.time = ist(Date.parse(d.matchFixtures[i % 3]) - randInt(r, 5, 35) * MIN); });
    },
  },
  {
    count: 150, kind: 'genuine', expectedVerdict: 'clear', category: 'Genuine Festival & Local Surges', typology: 'calendar-festival-surge', difficulty: 'hard',
    mutate: (d, _idx, r) => {
      const base = d.merchant.baselineWeekly;
      d.weeklySales.forEach((w: D, i: number) => {
        if (i >= 9) { w.actual = Math.round(base * 2.8); w.seasonalMultiplier = 2.7; }
        else { w.actual = Math.round(base * (0.95 + 0.1 * r())); }
      });
    },
  },
  {
    count: 150, kind: 'genuine', expectedVerdict: 'clear', category: 'Genuine Festival & Local Surges', typology: 'unlisted-local-fair', difficulty: 'hard',
    mutate: (d, _idx, r) => {
      const base = d.merchant.baselineWeekly;
      d.weeklySales.forEach((w: D, i: number) => { w.actual = i >= 10 ? Math.round(base * 2.4) : Math.round(base * (0.95 + 0.1 * r())); });
    },
  },
  {
    count: 150, kind: 'genuine', expectedVerdict: 'clear', category: 'Genuine Geo & Repeat Edge Cases', typology: 'border-neighbours', difficulty: 'hard', mccPool: LOCAL_MCCS,
    mutate: (d, _idx, r, _anchor, home) => {
      const nbrs = RULES.neighbours(home);
      if (nbrs.length) ownSales(d).slice(0, 35).forEach(s => { s.payerState = pick(r, nbrs); });
    },
  },
  {
    count: 150, kind: 'genuine', expectedVerdict: 'clear', category: 'Genuine Pricing & POS Traps', typology: 'discrete-menu-99-pos', difficulty: 'hard',
    mutate: (d, _idx, r) => {
      const prices = [99, 199, 299, 499, 799];
      ownSales(d).forEach(s => {
        s.amount = pick(r, prices);
        s.channel = 'POS';
        s.paymentLinkId = 'TERM-01';
        delete s.orderId;
      });
      d.orders = [];
      d.dataAvailability.orders = 'MISSING';
      d.dataAvailability.fulfillment = 'MISSING';
      reconcileWeekly(d);
    },
  },
  {
    count: 150, kind: 'genuine', expectedVerdict: 'clear', category: 'Genuine Operational Edge Cases', typology: 'mobile-self-refunds-bank-switch', difficulty: 'hard',
    mutate: (d, _idx, r, anchor) => {
      const sales = ownSales(d);
      for (let i = 0; i < 6; i++) {
        const s = sales[i];
        s.payerMobile = `98000${i}0001`;
        d.transactions.push({
          id: `SELFREF-${d.merchant.id}-${i}`,
          merchantId: d.merchant.id,
          type: 'REFUND',
          amount: s.amount,
          time: ist(anchor - i * DAY),
          channel: 'UPI_LINK',
          payerId: s.payerId,
          payerMobile: s.payerMobile,
          paidTo: `ALT-ACC-${i}`,
          destHolder: s.payerMobile,
          refundOfTransactionId: s.id,
        });
      }
      // Single benign bank switch (1 change -> UNKNOWN, not ILLICIT)
      const sets = ownSets(d);
      if (sets.length >= 2) sets[sets.length - 1].beneficiaryAccount = `BEN-NEW-${d.merchant.id}`;
      d.bankCredits = sets.map(s => ({ amount: s.amount, beneficiaryAccount: s.beneficiaryAccount }));
    },
  },
  {
    count: 150, kind: 'genuine', expectedVerdict: 'clear', category: 'Genuine Operational Edge Cases', typology: 'acquirer-only-and-partial', difficulty: 'hard',
    mutate: (d, _idx, r) => {
      const fullMissing = r() < 0.5;
      if (fullMissing) {
        d.website = { embeds: [], catalogue: [] };
        d.orders = [];
        d.bankCredits = [];
        d.purchaserVerification = null;
        d.dataAvailability = { acquiring: 'AVAILABLE', website: 'MISSING', orders: 'MISSING', bank: 'MISSING', fulfillment: 'MISSING', calendar: 'MISSING', verification: 'MISSING' };
      } else {
        d.dataAvailability.website = 'PARTIAL';
        d.dataAvailability.orders = 'PARTIAL';
        d.dataAvailability.bank = 'PARTIAL';
        d.dataAvailability.fulfillment = 'PARTIAL';
      }
    },
  },
  {
    count: 150, kind: 'genuine', expectedVerdict: 'clear', category: 'Genuine Operational Edge Cases', typology: 'small-n-under-minN', difficulty: 'hard',
    mutate: (d, _idx, r) => {
      const keep = randInt(r, 12, 26);
      const sets = ownSets(d);
      const sales = ownSales(d).slice(0, keep);
      d.transactions = [...sales, ...sets];
      d.orders = d.orders.slice(0, keep);
      reconcileWeekly(d);
    },
  },
  {
    count: 150, kind: 'genuine', expectedVerdict: 'clear', category: 'Genuine Operational Edge Cases', typology: 'monsoon-delay-and-overnight', difficulty: 'hard', mccPool: ['5812', '5814', '5462'],
    mutate: (d, _idx, r) => {
      // 12% delayed (still <20% shortfall vs 90% norm) + overnight kitchen hours
      d.orders.forEach((o: D, i: number) => { if (i % 8 === 0) o.status = 'SHIPPED'; });
      d.merchant.hours = [18, 4];
      ownSales(d).slice(0, 12).forEach(s => {
        const hr = pick(r, [23, 0, 1, 2]);
        s.time = `${s.time.slice(0, 11)}${String(hr).padStart(2, '0')}:15:00+05:30`;
      });
    },
  },
  {
    count: 150, kind: 'genuine', expectedVerdict: 'clear', category: 'Messy Real-World Data', typology: 'messy-tz-paise-dups-anon', difficulty: 'hard',
    mutate: (d, _idx, r) => {
      const sales = ownSales(d);
      // Mixed UTC + IST timestamps, decimal paise amounts, anonymous POS ('—'), out-of-order array, exact duplicate dropped cleanly
      sales.forEach((s, i) => {
        if (i % 3 === 0) s.amount = Number((s.amount + 0.5).toFixed(2));
        if (i % 4 === 0) s.time = utc(Date.parse(s.time));
        if (i % 5 === 0) { delete s.payerId; s.channel = 'POS'; delete s.orderId; }
      });
      if (sales.length > 2 && sales[1].payerId) {
        d.transactions.push({ ...sales[1], id: `DUP-${d.merchant.id}` });
      }
      d.transactions.reverse();
    },
  },

  // ======================== 6. HONEST PROFILE SHIFTS: ASK & PASSPORT (500) ========================
  {
    count: 250, kind: 'profile_shift', expectedVerdict: 'ask', category: 'Honest Profile Shifts (ASK)', typology: 'ask-profile-shift-no-passport', difficulty: 'hard', mccPool: LOCAL_MCCS,
    mutate: (d, _idx, r, anchor, home) => {
      // Honest expansion: new late-night hours + shifted larger ticket band + out-of-area shipping, ZERO conduct signals (distinct payers, delivered orders, reconciled bank)
      const dist = distantStates(home);
      const sales = ownSales(d);
      sales.slice(0, Math.floor(sales.length * 0.55)).forEach(s => {
        s.amount = Math.round(d.merchant.ticketMax * 0.45) + randInt(r, 13, 89); // non-round larger ticket
        s.payerState = pick(r, dist);
        const hr = pick(r, [1, 2, 3]);
        s.time = `${s.time.slice(0, 11)}${String(hr).padStart(2, '0')}:25:00+05:30`;
      });
      reconcileWeekly(d);
    },
  },
  {
    count: 250, kind: 'profile_shift', expectedVerdict: 'clear', category: 'Honest Profile Shifts (Passport)', typology: 'genuine-with-valid-passport', difficulty: 'hard', mccPool: LOCAL_MCCS, trustPassports: true,
    mutate: (d, _idx, r, anchor, home) => {
      const dist = distantStates(home);
      const sales = ownSales(d);
      const bigLo = Math.round(d.merchant.ticketMax * 0.35);
      const bigHi = Math.round(d.merchant.ticketMax * 0.85);
      sales.slice(0, Math.floor(sales.length * 0.55)).forEach(s => {
        s.amount = randInt(r, bigLo, bigHi) + 17;
        s.payerState = pick(r, dist);
        const hr = pick(r, [1, 2, 3]);
        s.time = `${s.time.slice(0, 11)}${String(hr).padStart(2, '0')}:25:00+05:30`;
      });
      d.contextPassports = [{
        id: `PP-VALID-${d.merchant.id}`,
        reason: 'Verified late-night delivery & regional gift hamper line',
        linkId: 'PL-01',
        from: ist(anchor - 20 * DAY).slice(0, 10),
        until: ist(anchor + 20 * DAY).slice(0, 10),
        document: 'gst-amendment-2026.pdf',
        status: 'VERIFIED',
        hours: [0, 6],
        states: ['*'],
        ticketBand: [Math.max(100, Math.floor(bigLo * 0.8)), Math.min(bigLo * 8, bigHi + 500)],
        volumeUplift: 2.5,
      }];
      reconcileWeekly(d);
    },
  },
];

// Verify exact total = 10,000
const TOTAL = SPECS.reduce((a, s) => a + s.count, 0);
if (TOTAL !== 10000) throw new Error(`Expected 10,000 specs, got ${TOTAL}`);

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const r = rng(20261125);
const fingerprints = new Set<string>();
const manifest: Manifest10k[] = [];
const shards: string[][] = Array.from({ length: 10 }, () => []);

let idx = 0;
for (const spec of SPECS) {
  const pool = spec.mccPool ?? ALL_MCCS;
  for (let localIdx = 0; localIdx < spec.count; localIdx++) {
    idx++;
    const shard = Math.floor((idx - 1) / 1000) + 1;
    const mcc = pool[(idx + localIdx) % pool.length];
    // Assign chronological quarter so Q3/Q4 have heavier hard/redteam drift
    const quarter: Manifest10k['quarter'] =
      spec.difficulty === 'redteam'
        ? (r() < 0.75 ? (r() < 0.5 ? 'Q3' : 'Q4') : (r() < 0.5 ? 'Q1' : 'Q2'))
        : (['Q1', 'Q2', 'Q3', 'Q4'][idx % 4] as Manifest10k['quarter']);
    const qOffset = { Q1: -90, Q2: -45, Q3: 0, Q4: 45 }[quarter];
    const anchorMs = T0 + (qOffset + randInt(r, -18, 18)) * DAY;
    const home = ALL_STATES[(idx * 7 + localIdx) % ALL_STATES.length];
    const posFrac = spec.typology === 'discrete-menu-99-pos' ? 1 : (r() < 0.15 ? 0.8 : r() < 0.35 ? 0.35 : 0);

    const { d, anchor } = buildBase(idx, mcc, r, { anchorMs, home, posFrac });
    spec.mutate(d, idx, r, anchor, home, localIdx);

    const sales = ownSales(d);
    const total14d = sales.reduce((a, s) => a + s.amount, 0);
    const weekly = total14d / 2;
    const sizeBand: Manifest10k['sizeBand'] = weekly < 50000 ? 'micro' : weekly > 500000 ? 'enterprise' : 'mid';
    const age = d.merchant.accountAgeDays;
    const ageBand: Manifest10k['ageBand'] = age < 45 ? 'new' : age > 365 ? 'established' : 'mid';
    const posShare = sales.length ? sales.filter(s => s.channel === 'POS').length / sales.length : 0;
    const channelMix: Manifest10k['channelMix'] = posShare > 0.8 ? 'pos' : posShare < 0.1 ? 'upi' : 'mixed';

    const fp = createHash('sha256')
      .update(JSON.stringify([
        mcc, spec.typology, home, age, Math.round(anchor / HOUR),
        sales.length, sales.slice(0, 6).map(s => [s.amount, s.payerState, s.paymentLinkId]),
      ]))
      .digest('hex')
      .slice(0, 16);
    if (fingerprints.has(fp)) {
      // Add deterministic salt on the rare chance of collision
      d.transactions[0].amount = Number((d.transactions[0].amount + 1).toFixed(2));
    }
    fingerprints.add(fp);

    const ringClusterId = spec.typology.startsWith('ring-')
      ? `${spec.typology}-${Math.floor(localIdx / (spec.typology === 'ring-star-ben' ? 10 : spec.typology === 'ring-phoenix-chain' ? 4 : spec.typology === 'ring-bipartite-hub' ? 8 : 5))}`
      : spec.typology === 'indian-franchise-shared-ben'
        ? `benign-franchise-${Math.floor(localIdx / 4)}`
        : spec.typology === 'indian-techpark-shared-payers'
          ? `benign-techpark-${Math.floor(localIdx / 2)}`
          : undefined;

    shards[shard - 1].push(JSON.stringify(d));
    manifest.push({
      idx,
      shard,
      merchantId: d.merchant.id,
      mcc,
      knownMcc: RULES.knowsCategory(mcc),
      kind: spec.kind,
      expectedVerdict: spec.expectedVerdict,
      category: spec.category,
      typology: spec.typology,
      difficulty: spec.difficulty,
      quarter,
      region: METRO_STATES.includes(home) ? 'metro' : 'nonmetro',
      sizeBand,
      ageBand,
      channelMix,
      ...(ringClusterId ? { ringClusterId, ringTopology: spec.typology } : {}),
      ...(d.contextPassports?.length ? { hasPassport: true } : {}),
      ...(spec.trustPassports ? { trustPassports: true } : {}),
      fingerprint: fp,
    });
  }
}

for (let s = 0; s < shards.length; s++) {
  writeFileSync(join(OUT_DIR, `part-${String(s + 1).padStart(2, '0')}.jsonl`), shards[s].join('\n') + '\n');
}
writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest));

const byKind = manifest.reduce((m, x) => ({ ...m, [x.kind]: (m[x.kind] ?? 0) + 1 }), {} as Record<string, number>);
const byVerdict = manifest.reduce((m, x) => ({ ...m, [x.expectedVerdict]: (m[x.expectedVerdict] ?? 0) + 1 }), {} as Record<string, number>);
console.log(`Generated ${manifest.length} datasets (${fingerprints.size} unique fingerprints) across 10 JSONL shards in ${OUT_DIR}/`);
console.log('By kind:', byKind, 'By expectedVerdict:', byVerdict);
console.log(`Distinct MCCs: ${new Set(manifest.map(x => x.mcc)).size} (${KNOWN_MCCS.length} known + ${UNKNOWN_MCCS.length} unknown)`);
