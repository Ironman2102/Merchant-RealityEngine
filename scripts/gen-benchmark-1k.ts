/**
 * Generates 1,200 realistic, randomized (seeded) `mre-dataset/v1` merchant datasets in `tests/datasets-1k/`:
 * - 600 diverse fronts across 6 major typology groups (including low-intensity hybrids, subtle evasions,
 *   delayed sweeps, smurfing, offline bonus-tiers, discrete-menu deposits, rotations, mule rings, shells, takeovers)
 * - 600 diverse genuine shops across all 8 MCCs + unknown MCCs (including messy/borderline real-world cases:
 *   unlisted local events, border towns, discrete menus, POS-only, overnight kitchens, high regulars, delivery delays)
 * - `tests/datasets-1k/manifest.json` with ground-truth labels and categories.
 *
 * Run: npx tsx scripts/gen-benchmark-1k.ts
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULES } from '../rules/index';
import { normal, rng } from '../frontend/src/stats/rng';

type D = Record<string, any>;
const OUT_DIR = 'tests/datasets-1k';
const DAY = 86400000;
const HOUR = 3600000;
const MIN = 60000;
const T0 = Date.parse('2026-06-15T12:00:00+05:30');
const KNOWN_MCCS = ['5462', '5411', '5812', '5814', '5947', '5712', '5943'];
const ALL_MCCS = [...KNOWN_MCCS, '5999', '5691', '5912', '7399'];
const STATES = ['KA', 'MH', 'TN', 'DL', 'UP', 'WB', 'RJ', 'GJ', 'PB', 'HR', 'TS', 'AP', 'KL'];

const ist = (ms: number) => new Date(Math.round(ms) + 19800000).toISOString().slice(0, 19) + '+05:30';
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const randInt = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

function distantStates(home: string): string[] {
  const local = new Set([home, ...RULES.neighbours(home)]);
  return STATES.filter(s => !local.has(s));
}

function buildBase(idx: number, kind: 'front' | 'genuine', category: string, typology: string, mcc: string, r: () => number, opts: {
  nSales?: number; ageDays?: number; anchorMs?: number; hours?: [number, number]; posFrac?: number; discreteMenu?: boolean;
} = {}): { d: D; anchor: number; home: string } {
  const n = RULES.mcc(mcc);
  const anchor = opts.anchorMs ?? (T0 + randInt(r, -25, 25) * DAY);
  const home = pick(r, ['KA', 'MH', 'TN', 'DL', 'WB', 'GJ']);
  const open = opts.hours?.[0] ?? n.open;
  const close = opts.hours?.[1] ?? n.close;
  const id = `M1K-${String(idx).padStart(4, '0')}`;
  const nSales = opts.nSales ?? randInt(r, 35, 110);
  const ageDays = opts.ageDays ?? randInt(r, 60, 1800);
  const menuPrices = opts.discreteMenu
    ? Array.from({ length: randInt(r, 4, 9) }, (_, k) => Math.max(40, Math.round(n.ticket.median * (0.4 + k * 0.25))))
    : null;

  const sales: D[] = Array.from({ length: nSales }, (_, i) => {
    const amt = menuPrices
      ? pick(r, menuPrices)
      : Math.max(20, Math.min(900000, Math.round(n.ticket.median * Math.exp(n.ticket.sigma * normal(r)))));
    const span = open < close ? Math.max(1, close - open) : (24 - open + close);
    const hr = (open + Math.floor(r() * span)) % 24;
    const dayOff = Math.floor(r() * 14);
    const time = `${ist(anchor - dayOff * DAY).slice(0, 10)}T${String(hr).padStart(2, '0')}:${String(randInt(r, 0, 59)).padStart(2, '0')}:00+05:30`;
    const isPos = r() < (opts.posFrac ?? 0);
    const offArea = r() < n.offAreaShare;
    const payerState = offArea ? pick(r, distantStates(home)) : home;
    return {
      id: `TX-${idx}-${i}`,
      merchantId: id,
      type: 'SALE',
      amount: amt,
      time,
      settledAt: ist(Date.parse(time) + randInt(r, 6, 24) * HOUR),
      channel: isPos ? 'POS' : 'UPI_LINK',
      paymentLinkId: isPos ? 'TERM-01' : 'PL-01',
      payerId: `P-${idx}-${i}`,
      payerState,
      ...(isPos ? {} : { orderId: `ORD-${idx}-${i}` }),
    };
  });

  const nSet = randInt(r, 4, 8);
  const settlements: D[] = Array.from({ length: nSet }, (_, i) => ({
    id: `SET-${idx}-${i}`,
    merchantId: id,
    type: 'SETTLEMENT',
    amount: Math.round(n.ticket.median * (nSales / nSet) * (0.85 + r() * 0.3)),
    time: ist(anchor - (nSet - 1 - i) * 2 * DAY),
    channel: 'BANK',
    beneficiaryAccount: `BEN-${idx}-0`,
  }));

  const baseW = Math.max(20000, Math.round(n.ticket.median * nSales * 0.5));
  const weeklySales = Array.from({ length: 12 }, (_, i) => ({
    week: `W${i + 1}`,
    actual: Math.round(baseW * (0.85 + r() * 0.3)),
    seasonalMultiplier: 1,
  }));

  const d: D = {
    format: 'mre-dataset/v1',
    title: `${typology} (${mcc})`,
    description: `${kind} · ${category} · ${typology}`,
    merchant: {
      id,
      name: `Shop ${idx} ${typology}`,
      city: `City, ${home}`,
      mcc,
      category: n.name,
      products: ['Item A', 'Item B'],
      ticketMin: 20,
      ticketMax: Math.round(n.ticket.median * 5),
      hours: [open, close],
      catchment: n.catchment,
      localStates: [home],
      expectedRoundShare: n.roundShare,
      seasonalPeak: 1,
      baselineWeekly: baseW,
      accountAgeDays: ageDays,
      declaredDomains: [`shop${idx}.example`],
      declaredChannels: ['UPI_LINK'],
      declaredActivity: [n.name],
    },
    weeklySales,
    transactions: [...sales, ...settlements],
    matchFixtures: [],
    dataAvailability: {
      acquiring: 'AVAILABLE', website: 'AVAILABLE', orders: 'AVAILABLE',
      bank: 'AVAILABLE', fulfillment: 'AVAILABLE', calendar: 'MISSING', verification: 'AVAILABLE',
    },
    website: {
      embeds: [{ id: `EMB-${idx}`, merchantId: id, linkId: 'PL-01', host: `shop${idx}.example`, path: '/pay', category: 'own', pageType: 'checkout', firstSeen: '2026-05-01' }],
      catalogue: Array.from({ length: 8 }, (_, i) => ({ sku: `SKU-${i}`, name: `Prod ${i}`, price: Math.round(n.ticket.median * (0.6 + i * 0.15)), inCategory: true, dupImage: false })),
    },
    orders: sales.filter(s => s.orderId).map((s, i) => ({ orderId: s.orderId, saleId: s.id, status: r() < 0.95 ? 'DELIVERED' : 'SHIPPED', trackingId: `TRK-${idx}-${i}` })),
    bankCredits: settlements.map(s => ({ amount: s.amount, beneficiaryAccount: s.beneficiaryAccount })),
    purchaserVerification: { contacted: 12, confirmed: randInt(r, 10, 12) },
  };
  return { d, anchor, home };
}

const ownSales = (d: D) => d.transactions.filter((t: D) => t.merchantId === d.merchant.id && t.type === 'SALE');
const ownSets = (d: D) => d.transactions.filter((t: D) => t.merchantId === d.merchant.id && t.type === 'SETTLEMENT');

function stripOpt(d: D, keep: string[] = []) {
  for (const k of ['website', 'orders', 'bank', 'fulfillment', 'calendar', 'verification']) {
    if (!keep.includes(k)) d.dataAvailability[k] = 'MISSING';
  }
  if (!keep.includes('website')) delete d.website;
  if (!keep.includes('orders')) d.orders = [];
  if (!keep.includes('bank')) d.bankCredits = [];
  if (!keep.includes('verification')) d.purchaserVerification = null;
  if (!keep.includes('calendar')) d.matchFixtures = [];
}

function injectIllicitOverlay(d: D, anchor: number, home: string, r: () => number, opts: {
  frac: number; amts: readonly number[]; night?: boolean; preMatch?: boolean; repeatPool?: number; unmatchedOrders?: boolean;
}) {
  const sales = ownSales(d);
  const dist = distantStates(home);
  const k = Math.max(1, Math.round(sales.length * opts.frac));
  const baseWeek = Math.floor(anchor / (7 * DAY)) * 7 * DAY + HOUR;
  let fixtures: number[] = [];
  if (opts.preMatch) {
    fixtures = [1, 3, 5, 7, 9, 11, 13].map(day => anchor - day * DAY + 7.5 * HOUR);
    d.matchFixtures = fixtures.map(ist);
    d.dataAvailability.calendar = 'AVAILABLE';
  }
  sales.slice(0, k).forEach((s: D, i: number) => {
    s.amount = pick(r, opts.amts);
    s.payerState = pick(r, dist);
    if (opts.unmatchedOrders) s.orderId = null;
    if (opts.repeatPool) {
      s.payerId = `REP-${i % opts.repeatPool}`;
      s.time = ist(baseWeek + (i % 3) * DAY + 23 * HOUR + (i % 15) * MIN);
    } else if (opts.preMatch) {
      if (i % 4 !== 0) s.time = ist(fixtures[i % fixtures.length] - randInt(r, 5, 35) * MIN);
      else s.time = `${ist(anchor - (i % 7) * 2 * DAY).slice(0, 10)}T12:15:00+05:30`;
    } else if (opts.night) {
      const hr = pick(r, [23, 0, 1, 2, 3]);
      s.time = `${ist(anchor - (i % 12) * DAY).slice(0, 10)}T${String(hr).padStart(2, '0')}:${String(randInt(r, 0, 59)).padStart(2, '0')}:00+05:30`;
    }
  });
}

function addSweeps(d: D, r: () => number, nBen: number, delayHours: number) {
  const sets = ownSets(d);
  for (let i = 0; i < Math.max(sets.length, nBen); i++) {
    const s = sets[i % sets.length];
    d.transactions.push({
      id: `SW-${i}`, merchantId: d.merchant.id, type: 'TRANSFER',
      amount: Math.round(s.amount * (0.7 + r() * 0.25)),
      time: ist(Date.parse(s.time) + delayHours * HOUR),
      channel: 'PAYOUT', beneficiaryAccount: `EXT-BEN-${i % nBen}`,
    });
  }
}

const r = rng(20261124);
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const manifest: { file: string; merchantId: string; mcc: string; kind: 'front' | 'genuine'; category: string; typology: string; difficulty: 'standard' | 'hard' }[] = [];
let idCounter = 0;

function saveCase(kind: 'front' | 'genuine', category: string, typology: string, difficulty: 'standard' | 'hard', mcc: string, buildOpts: Parameters<typeof buildBase>[6], mutate?: (d: D, anchor: number, home: string) => void) {
  idCounter++;
  const file = `${String(idCounter).padStart(4, '0')}-${kind}-${typology.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
  const { d, anchor, home } = buildBase(idCounter, kind, category, typology, mcc, r, buildOpts);
  if (mutate) mutate(d, anchor, home);
  writeFileSync(join(OUT_DIR, file), JSON.stringify(d));
  manifest.push({ file, merchantId: d.merchant.id, mcc, kind, category, typology, difficulty });
}

// ==================== 600 DIVERSE FRONTS ====================

// 1. Blatant & multi-signal gambling/betting fronts (100)
for (let i = 0; i < 100; i++) {
  const mcc = ALL_MCCS[i % ALL_MCCS.length];
  const sub = i % 5;
  const typ = ['web-gambling-embed', 'telegram-no-web', 'shared-hub-multi', 'inplay-prematch', 'upi-collect-repeat'][sub];
  saveCase('front', 'Betting & Gambling Fronts', typ, sub === 1 ? 'hard' : 'standard', mcc, {}, (d, anchor, home) => {
    if (sub === 0) {
      injectIllicitOverlay(d, anchor, home, r, { frac: 0.7 + r() * 0.3, amts: [500, 1000, 2000, 5000], preMatch: true });
      d.website.embeds.push({ id: `EB-${i}`, merchantId: d.merchant.id, linkId: 'PL-01', host: 'stakearena.example', path: '/dep', category: 'gambling', pageType: 'deposit', firstSeen: '2026-06-01' });
    } else if (sub === 1) {
      stripOpt(d);
      injectIllicitOverlay(d, anchor, home, r, { frac: 0.8, amts: [500, 1000, 2000], repeatPool: randInt(r, 3, 5), night: true });
      d.externalSightings = [{ source: 'telegram', place: 't.me/bet_front', paymentRef: 'PL-01', seenAt: '2026-06-10' }];
    } else if (sub === 2) {
      injectIllicitOverlay(d, anchor, home, r, { frac: 0.65, amts: [500, 1000, 2500], night: true, unmatchedOrders: true });
      d.website.embeds.push({ id: `EH-${i}`, merchantId: d.merchant.id, linkId: 'PL-01', host: `hub${i % 10}.example`, path: '/pay', category: 'unknown', pageType: 'checkout', firstSeen: '2026-06-01' });
      for (let p = 0; p < 3; p++) d.website.embeds.push({ id: `EHP-${i}-${p}`, merchantId: `M-PEER-${p}`, linkId: `PL-P${p}`, host: `hub${i % 10}.example`, path: '/pay', category: 'unknown', pageType: 'checkout', firstSeen: '2026-06-01' });
    } else if (sub === 3) {
      stripOpt(d, ['calendar']);
      injectIllicitOverlay(d, anchor, home, r, { frac: 0.75, amts: [500, 1000, 2000], preMatch: true });
      addSweeps(d, r, randInt(r, 4, 8), 1);
    } else {
      stripOpt(d, ['orders']);
      ownSales(d).forEach((s: D) => { s.channel = 'UPI_COLLECT'; });
      injectIllicitOverlay(d, anchor, home, r, { frac: 0.75, amts: [500, 1000, 2000], repeatPool: 4, unmatchedOrders: true });
    }
  });
}

// 2. Low-intensity & subtle hybrid fronts: 15-40% illicit mixed into real shop (100)
for (let i = 0; i < 100; i++) {
  const mcc = ALL_MCCS[i % ALL_MCCS.length];
  const frac = 0.15 + (i % 5) * 0.06; // 15%..39%
  const hasOpt = i % 2 === 0;
  saveCase('front', 'Low-Intensity Hybrid Fronts', `hybrid-${Math.round(frac * 100)}pct`, 'hard', mcc, { nSales: randInt(r, 50, 120) }, (d, anchor, home) => {
    if (!hasOpt) stripOpt(d);
    else stripOpt(d, ['orders', 'bank']);
    injectIllicitOverlay(d, anchor, home, r, { frac, amts: [500, 1000, 2000], night: true, unmatchedOrders: hasOpt });
    if (i % 3 === 0) addSweeps(d, r, randInt(r, 4, 8), randInt(r, 1, 18));
  });
}

// 3. Sophisticated evasions & smurfing (120)
for (let i = 0; i < 120; i++) {
  const mcc = ALL_MCCS[i % ALL_MCCS.length];
  const sub = i % 6;
  const typ = ['smurf-495-hug', 'daytime-shift-evasion', 'split-payer-7wk', 'delayed-sweep-30h', 'offline-99-tiers', 'discrete-bet-tiers'][sub];
  saveCase('front', 'Evasion & Smurfing Fronts', typ, 'hard', mcc, {}, (d, anchor, home) => {
    if (sub === 0) {
      stripOpt(d, ['orders', 'verification']);
      injectIllicitOverlay(d, anchor, home, r, { frac: 0.7, amts: [492, 495, 497, 985, 1985], night: true, unmatchedOrders: true });
      d.purchaserVerification = { contacted: 12, confirmed: randInt(r, 2, 4) };
    } else if (sub === 1) {
      stripOpt(d, ['website', 'orders']);
      injectIllicitOverlay(d, anchor, home, r, { frac: 0.75, amts: [500, 1000, 2000], unmatchedOrders: true });
      ownSales(d).forEach((s: D) => { s.time = `${s.time.slice(0, 10)}T20:${String(randInt(r, 10, 55)).padStart(2, '0')}:00+05:30`; });
      d.website.embeds.push({ id: `ED-${i}`, merchantId: d.merchant.id, linkId: 'PL-01', host: 'stakearena.example', path: '/d', category: 'gambling', pageType: 'deposit', firstSeen: '2026-06-01' });
    } else if (sub === 2) {
      stripOpt(d, ['bank']);
      injectIllicitOverlay(d, anchor, home, r, { frac: 0.75, amts: [500, 1000, 2000], night: true });
      // Split across payers at 6-7/wk (below heavyRepeatPerWeek=8)
      const baseWeek = Math.floor(anchor / (7 * DAY)) * 7 * DAY + HOUR;
      ownSales(d).forEach((s: D, k: number) => { s.payerId = `SPLIT-${Math.floor(k / 7)}`; s.time = ist(baseWeek + (k % 7) * 6 * HOUR); });
      addSweeps(d, r, randInt(r, 4, 8), 2);
    } else if (sub === 3) {
      stripOpt(d);
      injectIllicitOverlay(d, anchor, home, r, { frac: 0.6, amts: [500, 1000, 2000], night: true });
      addSweeps(d, r, randInt(r, 6, 12), randInt(r, 26, 40)); // outside 24h sweep window!
    } else if (sub === 4) {
      // Offline 99-ending betting tiers with website MISSING
      stripOpt(d, ['calendar']);
      injectIllicitOverlay(d, anchor, home, r, { frac: 0.8, amts: [99, 199, 299, 499, 999, 1999], preMatch: true });
    } else {
      // Discrete menu-like 8 fixed deposit tiers
      stripOpt(d);
      injectIllicitOverlay(d, anchor, home, r, { frac: 0.9, amts: [250, 450, 750, 1250, 1750, 2250, 3250, 4250], night: true });
    }
  });
}

// 4. Merchant rotation & phoenix accounts (80)
for (let i = 0; i < 80; i++) {
  const mcc = ALL_MCCS[i % ALL_MCCS.length];
  const gapDays = i % 8; // 0..7 days
  const ageDays = i < 60 ? randInt(r, 5, 44) : randInt(r, 46, 80); // 20 borderline >45d
  const sharedBen = i % 3 !== 0;
  saveCase('front', 'Rotation & Phoenix Fronts', ageDays >= 45 ? 'rotation-borderline-age' : 'rotation-dormant-handoff', ageDays >= 45 ? 'hard' : 'standard', mcc, { ageDays }, (d, anchor, home) => {
    stripOpt(d, ['website']);
    const peerId = `M-PEER-${i}`;
    d.peers = [{ id: peerId, name: `Dormant Peer ${i}`, status: 'DORMANT', accountAgeDays: randInt(r, 250, 900) }];
    const own = ownSales(d);
    const peerEnd = anchor - (9 + gapDays) * DAY;
    own.forEach((s: D, k: number) => {
      s.amount = [500, 1000, 1500, 2000][k % 4];
      s.payerId = `COHORT-${i}-${k % 14}`;
      s.payerState = pick(r, distantStates(home));
      s.time = `${ist(anchor - (8 - (k % 8)) * DAY).slice(0, 10)}T23:${String(k % 50).padStart(2, '0')}:00+05:30`;
    });
    for (let k = 0; k < 28; k++) {
      d.transactions.push({
        id: `PR-${i}-${k}`, merchantId: peerId, type: 'SALE', amount: [500, 1000, 1500, 2000][k % 4],
        time: `${ist(peerEnd - (k % 10) * DAY).slice(0, 10)}T23:${String(k % 50).padStart(2, '0')}:00+05:30`,
        channel: 'UPI_LINK', payerId: `COHORT-${i}-${k % 14}`, payerState: home,
      });
    }
    for (let k = 0; k < 35; k++) {
      d.transactions.push({
        id: `BG-${i}-${k}`, merchantId: `M-BG-${i}`, type: 'SALE', amount: 400,
        time: ist(anchor - 15 * DAY), channel: 'UPI_LINK', payerId: `BG-${i}-${k}`, payerState: home,
      });
    }
    if (sharedBen) {
      d.transactions.push({ id: `PSET-${i}`, merchantId: peerId, type: 'SETTLEMENT', amount: 25000, time: ist(peerEnd), channel: 'BANK', beneficiaryAccount: ownSets(d)[0].beneficiaryAccount });
    }
  });
}

// 5. Mule rings, shadow settlements & refund laundering (100)
for (let i = 0; i < 100; i++) {
  const mcc = ALL_MCCS[i % ALL_MCCS.length];
  const sub = i % 5;
  const typ = ['mule-ben-hopping', 'payout-fanout', 'shadow-bank-gap', 'orphan-refund-ring', 'thirdparty-refund-ring'][sub];
  saveCase('front', 'Mule & Refund Laundering', typ, sub >= 3 ? 'hard' : 'standard', mcc, {}, (d, anchor) => {
    stripOpt(d, ['bank', 'orders']);
    const sets = ownSets(d);
    const sales = ownSales(d);
    if (sub === 0) {
      sets.forEach((s: D, k: number) => { s.beneficiaryAccount = `MULE-${i}-${k}`; });
      addSweeps(d, r, randInt(r, 10, 18), 1);
      d.bankCredits = sets.slice(0, 1).map((s: D) => ({ amount: s.amount, beneficiaryAccount: s.beneficiaryAccount }));
      d.weeklySales.slice(-3).forEach((w: D) => { w.actual = d.merchant.baselineWeekly * 4; });
    } else if (sub === 1) {
      addSweeps(d, r, randInt(r, 12, 24), 1);
      d.bankCredits = [];
      sales.slice(0, Math.round(sales.length * 0.5)).forEach((s: D) => { s.orderId = null; });
    } else if (sub === 2) {
      d.bankCredits = [];
      sets.forEach((s: D, k: number) => { s.beneficiaryAccount = `SHD-${i}-${k}`; });
      sales.slice(0, Math.round(sales.length * 0.6)).forEach((s: D) => { s.orderId = null; });
      addSweeps(d, r, 6, 1);
    } else if (sub === 3) {
      for (let k = 0; k < 10; k++) d.transactions.push({ id: `OR-${i}-${k}`, merchantId: d.merchant.id, type: 'REFUND', amount: 1500, time: ist(anchor - k * HOUR), channel: 'UPI_LINK', payerId: `ORP-${i}-${k}` });
      if (i % 2 === 0) {
        sales.slice(0, Math.round(sales.length * 0.4)).forEach((s: D) => { s.orderId = null; });
        addSweeps(d, r, 10, 1);
      } else {
        // Pure refund+sweep without order/fanout extras (tests governance gate boundary)
        addSweeps(d, r, 3, 1);
      }
    } else {
      for (let k = 0; k < 10; k++) d.transactions.push({ id: `TR-${i}-${k}`, merchantId: d.merchant.id, type: 'REFUND', amount: 2000, time: ist(anchor - k * HOUR), channel: 'UPI_LINK', payerId: sales[k].payerId, refundOfTransactionId: sales[k].id, paidTo: `EXT-${i}-${k}`, destHolder: `OTHER-${i}-${k}` });
      if (i % 2 === 0) {
        sales.slice(0, Math.round(sales.length * 0.4)).forEach((s: D) => { s.orderId = null; });
        addSweeps(d, r, 10, 1);
      } else {
        addSweeps(d, r, 3, 1);
      }
    }
  });
}

// 6. Fabricated substance shells & account takeovers (100)
for (let i = 0; i < 100; i++) {
  const mcc = ALL_MCCS[i % ALL_MCCS.length];
  const isShell = i < 50;
  const typ = isShell ? (i % 2 === 0 ? 'shell-full-fake' : 'shell-partial-fake') : (i % 2 === 0 ? 'takeover-3wk-surge' : 'takeover-2wk-ramp');
  saveCase('front', isShell ? 'Fabricated Substance Shells' : 'Account Takeovers', typ, isShell && i % 2 === 1 ? 'hard' : 'standard', mcc, {}, (d, anchor, home) => {
    if (isShell) {
      const sales = ownSales(d);
      const missFrac = i % 2 === 0 ? 0.75 : 0.40;
      sales.forEach((s: D, k: number) => { if (k < Math.round(sales.length * missFrac)) s.orderId = null; });
      d.orders = d.orders.slice(0, 15).map((o: D, k: number) => ({ ...o, status: i % 2 === 0 ? 'NONE' : (k < 10 ? 'SHIPPED' : 'DELIVERED'), trackingId: 'DUP-TRK' }));
      d.website.catalogue = d.website.catalogue.map((c: D, k: number) => ({ ...c, inCategory: k < (i % 2 === 0 ? 1 : 4) ? false : true, dupImage: k < (i % 2 === 0 ? 8 : 5) }));
      d.purchaserVerification = { contacted: 14, confirmed: i % 2 === 0 ? randInt(r, 0, 3) : randInt(r, 4, 6) };
    } else {
      stripOpt(d, ['bank']);
      const surgeWeeks = i % 2 === 0 ? 3 : 2;
      d.weeklySales.slice(-surgeWeeks).forEach((w: D) => { w.actual = Math.round(d.merchant.baselineWeekly * (3.2 + r() * 2)); });
      injectIllicitOverlay(d, anchor, home, r, { frac: 0.65, amts: [500, 1000, 2000], night: true });
      addSweeps(d, r, randInt(r, 4, 9), 2);
    }
  });
}

// ==================== 600 DIVERSE GENUINE SHOPS ====================

// 7. Clean baseline genuine shops across all MCCs (220)
for (let i = 0; i < 220; i++) {
  const mcc = ALL_MCCS[i % ALL_MCCS.length];
  saveCase('genuine', 'Clean Diverse Shops', 'clean-standard', 'standard', mcc, { ageDays: randInt(r, 46, 2200) });
}

// 8. Genuine festival & unlisted local-event surges (80)
for (let i = 0; i < 80; i++) {
  const fests = [
    ['5462', '2025-10-20', 2.8], ['5411', '2026-11-08', 1.6], ['5947', '2026-11-08', 2.4],
    ['5947', '2026-12-25', 1.6], ['5812', '2026-03-21', 1.3], ['5712', '2026-11-08', 1.5],
  ] as const;
  const pickF = fests[i % fests.length];
  const isUnlistedLocal = i >= 60;
  saveCase('genuine', isUnlistedLocal ? 'Genuine Unlisted Local Event' : 'Genuine Festival Surges',
    isUnlistedLocal ? 'local-wedding-fair-25x' : 'calendar-festival-surge', isUnlistedLocal ? 'hard' : 'standard',
    pickF[0], { anchorMs: isUnlistedLocal ? T0 : Date.parse(`${pickF[1]}T16:00:00+05:30`) }, d => {
      const m = isUnlistedLocal ? 2.5 : pickF[2];
      d.weeklySales[11].actual = Math.round(d.merchant.baselineWeekly * m);
      d.weeklySales[10].actual = Math.round(d.merchant.baselineWeekly * Math.max(1, m * 0.8));
    });
}

// 9. Geo, border, college-town & repeat-regular genuine shops (80)
for (let i = 0; i < 80; i++) {
  const mcc = KNOWN_MCCS[i % KNOWN_MCCS.length];
  const sub = i % 4;
  const typ = ['border-neighbours', 'college-30pct-outofstate', 'regulars-5-7wk', 'vip-regulars-9wk'][sub];
  saveCase('genuine', 'Genuine Geo & Repeat Edge Cases', typ, sub === 3 ? 'hard' : 'standard', mcc, {}, (d, anchor, home) => {
    const nbrs = [home, ...RULES.neighbours(home)];
    const dist = distantStates(home);
    const sales = ownSales(d);
    if (sub === 0) sales.forEach((s: D) => { s.payerState = pick(r, nbrs); });
    else if (sub === 1) sales.forEach((s: D, k: number) => { if (k % 3 === 0) s.payerState = pick(r, dist); });
    else if (sub === 2) {
      const baseWeek = Math.floor(anchor / (7 * DAY)) * 7 * DAY + HOUR;
      sales.forEach((s: D, k: number) => { s.payerId = `REG-${Math.floor(k / 6)}`; s.time = ist(baseWeek + (k % 6) * 4 * HOUR); });
    } else {
      // 9x/wk regulars (crosses B7=8 threshold legitimately!)
      const baseWeek = Math.floor(anchor / (7 * DAY)) * 7 * DAY + HOUR;
      sales.forEach((s: D, k: number) => { s.payerId = `VIP-${Math.floor(k / 9)}`; s.time = ist(baseWeek + (k % 9) * 3 * HOUR); });
    }
  });
}

// 10. Discrete menus, POS-only, gift 99-prices, self-refunds, single-signal traps (120)
for (let i = 0; i < 120; i++) {
  const sub = i % 6;
  const mcc = sub === 0 ? pick(r, ['5812', '5814', '5943']) : sub === 1 ? pick(r, ['5411', '5814']) : sub === 2 ? '5947' : KNOWN_MCCS[i % KNOWN_MCCS.length];
  const typ = ['discrete-menu', 'pos-counter-sales', 'offline-gift-99prices', 'mobile-self-refunds', 'single-bank-switch', 'own-ca-sweep-single'][sub];
  saveCase('genuine', 'Genuine Pricing, POS & Single-Signal Traps', typ, 'hard', mcc, {
    discreteMenu: sub === 0,
    posFrac: sub === 1 ? 1.0 : 0,
  }, (d, anchor) => {
    if (sub === 2) {
      stripOpt(d);
      ownSales(d).forEach((s: D, k: number) => { s.amount = [199, 299, 499, 999, 750][k % 5]; });
    } else if (sub === 3) {
      ownSales(d).slice(0, 8).forEach((s: D, k: number) => {
        s.payerMobile = `980000${String(k).padStart(4, '0')}`;
        d.transactions.push({ id: `SR-${i}-${k}`, merchantId: d.merchant.id, type: 'REFUND', amount: 1500, time: ist(anchor - k * HOUR), channel: 'UPI_LINK', payerId: s.payerId, refundOfTransactionId: s.id, paidTo: `ALT-${k}`, destHolder: s.payerMobile });
      });
    } else if (sub === 4) {
      const sets = ownSets(d);
      sets.forEach((s: D, k: number) => { if (k >= sets.length / 2) s.beneficiaryAccount = `BEN-${i}-NEW`; });
      d.bankCredits = sets.map((s: D) => ({ amount: s.amount, beneficiaryAccount: s.beneficiaryAccount }));
    } else if (sub === 5) {
      ownSets(d).forEach((s: D, k: number) => d.transactions.push({ id: `OWN-${i}-${k}`, merchantId: d.merchant.id, type: 'TRANSFER', amount: Math.round(s.amount * 0.9), time: ist(Date.parse(s.time) + 2 * HOUR), channel: 'PAYOUT', beneficiaryAccount: 'OWN-CA' }));
    }
  });
}

// 11. Messy real-world genuine: overnight kitchens, acquirer-only, partial, sparse, small-N (100)
for (let i = 0; i < 100; i++) {
  const sub = i % 5;
  const mcc = sub === 0 ? pick(r, ['5812', '5814']) : ALL_MCCS[i % ALL_MCCS.length];
  const typ = ['overnight-kitchen', 'acquirer-only-missing', 'partial-feeds', 'small-n-under-minN', 'monsoon-delivery-delay'][sub];
  saveCase('genuine', 'Genuine Messy & Edge Operations', typ, sub === 0 || sub === 4 ? 'hard' : 'standard', mcc, {
    ...(sub === 0 ? { hours: [20, 4] as [number, number] } : {}),
    ...(sub === 3 ? { nSales: randInt(r, 8, 25) } : {}),
  }, d => {
    if (sub === 1) stripOpt(d);
    else if (sub === 2) {
      for (const k of Object.keys(d.dataAvailability)) if (d.dataAvailability[k] === 'AVAILABLE') d.dataAvailability[k] = 'PARTIAL';
    } else if (sub === 4) {
      // 25% delayed/shipped (within normal noisy delivery, should not open case alone)
      d.orders.forEach((o: D, k: number) => { if (k % 4 === 0) o.status = 'SHIPPED'; });
    }
  });
}

writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Generated ${manifest.length} datasets (${manifest.filter(m => m.kind === 'front').length} fronts, ${manifest.filter(m => m.kind === 'genuine').length} genuine) in ${OUT_DIR}/`);
