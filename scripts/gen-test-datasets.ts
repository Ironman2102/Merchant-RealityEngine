/**
 * Generates 100 diverse `mre-dataset/v1` test datasets in `tests/datasets/`:
 * - 60 distinct front typologies / operational modes / evasion tactics across all 8 MCCs & all 4 mechanisms
 * - 40 diverse genuine shop counterparts across all 8 MCCs, festivals, geographies, ages, and edge cases
 * - `tests/datasets/manifest.json` with ground-truth expectations
 *
 * Run: npx tsx scripts/gen-test-datasets.ts
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULES } from '../rules/index';

type D = Record<string, any>;
const OUT_DIR = 'tests/datasets';
const DAY = 86400000;
const HOUR = 3600000;
const MIN = 60000;
const T0 = Date.parse('2026-06-15T12:00:00+05:30');

function ist(ms: number): string {
  return new Date(Math.round(ms) + 19800000).toISOString().slice(0, 19) + '+05:30';
}

interface ShopSpec {
  file: string;
  kind: 'front' | 'genuine';
  category: string;
  expectedDecision: 'OPEN_CASE' | 'NO_CASE';
  expectedMechanism?: 'TRANSACTION_LAUNDERING' | 'ROTATION' | 'FABRICATED_SUBSTANCE' | 'OTHER_ABUSE';
  typology: string;
  mcc: string;
  ageDays?: number;
  anchorMs?: number;
  hours?: [number, number];
  catchment?: 'LOCAL' | 'NATIONAL';
  localStates?: string[];
  declaredDomains?: string[];
  expectedRoundShare?: number;
  ticketMax?: number;
  nSales?: number;
  mutate?: (d: D, anchor: number) => void;
}

const ownSales = (d: D) => d.transactions.filter((t: D) => t.merchantId === d.merchant.id && t.type === 'SALE');
const ownSets = (d: D) => d.transactions.filter((t: D) => t.merchantId === d.merchant.id && t.type === 'SETTLEMENT');

function baseDataset(spec: ShopSpec): D {
  const n = RULES.mcc(spec.mcc);
  const anchor = spec.anchorMs ?? T0;
  const open = spec.hours?.[0] ?? n.open;
  const close = spec.hours?.[1] ?? n.close;
  const id = `M-${spec.file.replace(/\.json$/, '').toUpperCase().slice(0, 28)}`;
  const home = (spec.localStates ?? ['KA'])[0];
  const nSales = spec.nSales ?? 60;

  const sales: D[] = Array.from({ length: nSales }, (_, i) => {
    const mult = [0.65, 0.85, 1.0, 1.15, 1.45][i % 5];
    const amt = Math.max(20, Math.round(n.ticket.median * mult));
    const hr = open < close
      ? open + (i % Math.max(1, close - open))
      : (open + (i % (24 - open + close))) % 24;
    const dayMs = anchor - (i % 14) * DAY;
    const time = `${ist(dayMs).slice(0, 10)}T${String(hr).padStart(2, '0')}:${String((i * 7) % 55).padStart(2, '0')}:00+05:30`;
    return {
      id: `TX-${spec.mcc}-${i}`,
      merchantId: id,
      type: 'SALE',
      amount: amt,
      time,
      settledAt: ist(Date.parse(time) + 12 * HOUR),
      channel: 'UPI_LINK',
      paymentLinkId: 'PL-01',
      payerId: `CUST-${spec.mcc}-${i}`,
      payerState: home,
      orderId: `ORD-${i}`,
    };
  });

  const settlements: D[] = Array.from({ length: 4 }, (_, i) => ({
    id: `SET-${spec.mcc}-${i}`,
    merchantId: id,
    type: 'SETTLEMENT',
    amount: 25000 + i * 50,
    time: ist(anchor - (3 - i) * 3 * DAY),
    channel: 'BANK',
    beneficiaryAccount: 'BEN-PRIMARY-01',
  }));

  const weeklySales = Array.from({ length: 12 }, (_, i) => ({
    week: `W${i + 1}`,
    actual: 100000 + ((i % 3) - 1) * 2500,
    seasonalMultiplier: 1,
  }));

  const d: D = {
    format: 'mre-dataset/v1',
    title: spec.typology,
    description: `${spec.category}: ${spec.typology}`,
    merchant: {
      id,
      name: `${spec.typology} (${spec.mcc})`,
      city: `Bengaluru, ${home}`,
      mcc: spec.mcc,
      category: n.name,
      products: ['Standard item A', 'Standard item B'],
      ticketMin: 20,
      ticketMax: spec.ticketMax ?? Math.round(n.ticket.median * 5),
      hours: spec.hours ?? [n.open, n.close],
      catchment: spec.catchment ?? n.catchment,
      localStates: spec.localStates ?? [home],
      expectedRoundShare: spec.expectedRoundShare ?? n.roundShare,
      seasonalPeak: 1,
      baselineWeekly: 100000,
      accountAgeDays: spec.ageDays ?? 450,
      declaredDomains: spec.declaredDomains ?? ['clean-shop.example'],
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
      embeds: [{ id: 'EMB-1', merchantId: id, linkId: 'PL-01', host: (spec.declaredDomains ?? ['clean-shop.example'])[0], path: '/checkout', category: 'own', pageType: 'checkout', firstSeen: '2026-05-01' }],
      catalogue: Array.from({ length: 8 }, (_, i) => ({
        sku: `SKU-${i}`, name: `Item ${i}`, price: Math.round(n.ticket.median * (0.7 + i * 0.1)), inCategory: true, dupImage: false,
      })),
    },
    orders: sales.map((s, i) => ({ orderId: `ORD-${i}`, saleId: s.id, status: 'DELIVERED', trackingId: `TRK-${spec.mcc}-${i}` })),
    bankCredits: settlements.map(s => ({ amount: s.amount, beneficiaryAccount: s.beneficiaryAccount })),
    purchaserVerification: { contacted: 12, confirmed: 11 },
  };
  if (spec.mutate) spec.mutate(d, anchor);
  return d;
}

/* ---------- Composable Front & Genuine Helpers ---------- */
const stripOptFeeds = (d: D, keep: string[] = []) => {
  const all = ['website', 'orders', 'bank', 'fulfillment', 'calendar', 'verification'];
  for (const k of all) {
    if (!keep.includes(k)) d.dataAvailability[k] = 'MISSING';
  }
  if (!keep.includes('website')) delete d.website;
  if (!keep.includes('orders')) d.orders = [];
  if (!keep.includes('bank')) d.bankCredits = [];
  if (!keep.includes('verification')) d.purchaserVerification = null;
  if (!keep.includes('calendar')) d.matchFixtures = [];
};

const applyBettingPattern = (d: D, anchor: number, opts: {
  roundAmts?: number[];
  states?: string[];
  nightHour?: string;
  repeatPool?: number;
  unmatchedOrders?: boolean;
  preMatch?: boolean;
  shareFrac?: number;
} = {}) => {
  const sales = ownSales(d);
  const count = Math.round(sales.length * (opts.shareFrac ?? 1));
  const amts = opts.roundAmts ?? [500, 1000, 2000, 5000];
  const states = opts.states ?? ['DL', 'UP', 'RJ', 'WB'];
  const baseWeek = Math.floor(anchor / (7 * DAY)) * 7 * DAY + HOUR;
  let fixtures: number[] = [];
  if (opts.preMatch) {
    fixtures = [1, 3, 5, 7, 9, 11].map(day => anchor - day * DAY + 7.5 * HOUR);
    d.matchFixtures = fixtures.map(ist);
    d.dataAvailability.calendar = 'AVAILABLE';
  }
  sales.slice(0, count).forEach((s: D, i: number) => {
    s.amount = amts[i % amts.length];
    s.payerState = states[i % states.length];
    if (opts.unmatchedOrders) s.orderId = null;
    if (opts.repeatPool) {
      s.payerId = `REP-${i % opts.repeatPool}`;
      s.time = ist(baseWeek + (i % 3) * DAY + 23 * HOUR + (i % 10) * MIN);
    } else if (opts.preMatch) {
      if (i % 3 !== 0) {
        const f = fixtures[i % fixtures.length];
        s.time = ist(f - 15 * MIN + (i % 5) * MIN);
      } else {
        // Non-match control days at noon across 7 distinct even days so C5 permutation test has >=14 total days
        s.time = `${ist(anchor - (i % 7) * 2 * DAY).slice(0, 10)}T12:00:00+05:30`;
      }
    } else if (opts.nightHour) {
      s.time = `${ist(anchor - (i % 10) * DAY).slice(0, 10)}T${opts.nightHour}+05:30`;
    }
  });
};

const addPayoutSweep = (d: D, nBeneficiaries: number, delayHours = 1) => {
  const sets = ownSets(d);
  for (let i = 0; i < Math.max(sets.length, nBeneficiaries); i++) {
    const s = sets[i % sets.length];
    d.transactions.push({
      id: `PAYOUT-${i}`, merchantId: d.merchant.id, type: 'TRANSFER',
      amount: Math.round(s.amount * 0.8),
      time: ist(Date.parse(s.time) + delayHours * HOUR),
      channel: 'PAYOUT', beneficiaryAccount: `EXT-ACC-${i % nBeneficiaries}`,
    });
  }
};

const addRotationPeer = (d: D, anchor: number, opts: { gapDays: number; peerAge?: number; sharedBen?: boolean; peerCount?: number }) => {
  const peerId = 'M-PEER-DORMANT';
  d.peers = [{ id: peerId, name: 'Dormant Peer Shop', status: 'DORMANT', accountAgeDays: opts.peerAge ?? 420 }];
  const own = ownSales(d);
  own.forEach((s: D, i: number) => {
    s.amount = [500, 1000, 1500, 2000][i % 4];
    s.payerId = `COHORT-P-${i % 15}`;
    s.payerState = ['DL', 'UP', 'MH'][i % 3];
    s.time = `${ist(anchor - (9 - (i % 9)) * DAY).slice(0, 10)}T23:10:00+05:30`;
  });
  const peerEnd = anchor - (9 + opts.gapDays) * DAY;
  for (let i = 0; i < (opts.peerCount ?? 30); i++) {
    d.transactions.push({
      id: `PEER-S-${i}`, merchantId: peerId, type: 'SALE',
      amount: [500, 1000, 1500, 2000][i % 4],
      time: `${ist(peerEnd - (i % 10) * DAY).slice(0, 10)}T23:10:00+05:30`,
      channel: 'UPI_LINK', payerId: `COHORT-P-${i % 15}`, payerState: ['DL', 'UP', 'MH'][i % 3],
    });
  }
  for (let i = 0; i < 40; i++) {
    d.transactions.push({
      id: `BG-S-${i}`, merchantId: 'M-BG-POOL', type: 'SALE', amount: 400,
      time: ist(anchor - 15 * DAY), channel: 'UPI_LINK', payerId: `BG-POOL-${i}`, payerState: 'KA',
    });
  }
  if (opts.sharedBen) {
    d.transactions.push({
      id: 'PEER-SET-1', merchantId: peerId, type: 'SETTLEMENT', amount: 30000,
      time: ist(peerEnd), channel: 'BANK', beneficiaryAccount: 'BEN-PRIMARY-01',
    });
  }
};

const pad = (n: number) => String(n).padStart(3, '0');
const SPECS: ShopSpec[] = [];
let idx = 0;
const pushSpec = (s: Omit<ShopSpec, 'file'> & { slug: string }) => {
  idx++;
  SPECS.push({ ...s, file: `${pad(idx)}-${s.kind}-${s.slug}.json` });
};

// ==================== 1. ONLINE GAMBLING / BETTING FRONTS (10) ====================
for (const [slug, mcc, opt] of [
  ['gambling-host-bakery', '5462', 'knownHost'],
  ['gambling-host-cafe', '5812', 'knownHost'],
  ['undeclared-bet-host-kirana', '5411', 'extHost'],
  ['shared-hub-5-merchants', '5999', 'shared5'],
  ['telegram-vip-tiffin', '5814', 'telegram'],
  ['whatsapp-bet-stationery', '5943', 'telegram'],
  ['discord-upi-collect-gifts', '5947', 'collect'],
  ['inplay-cricket-prematch-rest', '5812', 'prematch'],
  ['bonus-tiers-fantasy-kirana', '5411', 'tiers'],
  ['loss-chasing-20x-repeat-bakery', '5462', 'repeat20'],
] as const) {
  pushSpec({
    slug, kind: 'front', category: 'Gambling & Betting Fronts',
    expectedDecision: 'OPEN_CASE', expectedMechanism: 'TRANSACTION_LAUNDERING',
    typology: slug.replace(/-/g, ' '), mcc,
    mutate: (d, anchor) => {
      if (opt === 'knownHost') {
        applyBettingPattern(d, anchor, { preMatch: true });
        ownSales(d).forEach((s: D, i: number) => { if (i % 2 === 0) { s.paymentLinkId = 'PL-BET'; s.settledAt = undefined; } });
        d.website.embeds.push({ id: 'E-GAM', merchantId: d.merchant.id, linkId: 'PL-BET', host: 'stakearena.example', path: '/dep', category: 'gambling', pageType: 'deposit', firstSeen: '2026-06-01' });
      } else if (opt === 'extHost') {
        applyBettingPattern(d, anchor, { nightHour: '23:30:00', unmatchedOrders: true });
        d.website.embeds.push(
          { id: 'E-EXT', merchantId: d.merchant.id, linkId: 'PL-01', host: 'playwin-portal.example', path: '/pay', category: 'unknown', pageType: 'checkout', firstSeen: '2026-06-01' },
          { id: 'E-P2', merchantId: 'M-CO-1', linkId: 'PL-C1', host: 'playwin-portal.example', path: '/pay', category: 'unknown', pageType: 'checkout', firstSeen: '2026-06-01' },
        );
      } else if (opt === 'shared5') {
        applyBettingPattern(d, anchor, { unmatchedOrders: true });
        d.website.embeds.push({ id: 'E-HUB', merchantId: d.merchant.id, linkId: 'PL-01', host: 'multi-checkout.example', path: '/p', category: 'unknown', pageType: 'checkout', firstSeen: '2026-06-01' });
        for (let k = 1; k <= 4; k++) d.website.embeds.push({ id: `E-H-${k}`, merchantId: `M-HUB-${k}`, linkId: `PL-H${k}`, host: 'multi-checkout.example', path: '/p', category: 'unknown', pageType: 'checkout', firstSeen: '2026-06-01' });
      } else if (opt === 'telegram') {
        stripOptFeeds(d);
        applyBettingPattern(d, anchor, { repeatPool: 4, nightHour: '23:20:00' });
        d.externalSightings = [{ source: 'channel', place: 't.me/vip_bet_links', paymentRef: 'PL-01', seenAt: '2026-06-12', note: 'Advertised deposit link' }];
      } else if (opt === 'collect') {
        stripOptFeeds(d, ['orders']);
        ownSales(d).forEach((s: D) => { s.channel = 'UPI_COLLECT'; });
        applyBettingPattern(d, anchor, { repeatPool: 4, unmatchedOrders: true, roundAmts: [500, 1000, 2500] });
      } else if (opt === 'prematch') {
        stripOptFeeds(d, ['calendar']);
        applyBettingPattern(d, anchor, { preMatch: true, roundAmts: [500, 1000, 3000] });
        addPayoutSweep(d, 4, 1);
      } else if (opt === 'tiers') {
        stripOptFeeds(d, ['calendar', 'website']);
        applyBettingPattern(d, anchor, { preMatch: true, roundAmts: [99, 199, 299, 499, 999, 1999, 4999] });
      } else if (opt === 'repeat20') {
        stripOptFeeds(d);
        applyBettingPattern(d, anchor, { repeatPool: 2, roundAmts: [500, 1000, 2000] });
      }
    },
  });
}

// ==================== 2. STEALTH & EVASION LAUNDERERS (10) ====================
for (const [slug, mcc, mode] of [
  ['stealth-threshold-hug-495', '5462', 'hug495'],
  ['stealth-daytime-21h-shift', '5411', 'day21'],
  ['stealth-split-payers-under-8', '5812', 'splitPayers'],
  ['stealth-acquirer-only-no-opt', '5814', 'acqOnly'],
  ['stealth-kyc-shield-national', '5411', 'kycShield'],
  ['stealth-seasonal-mult-inflate', '5462', 'seasMult'],
  ['stealth-hybrid-70-30-rest', '5812', 'hybrid70'],
  ['stealth-hybrid-80-20-kirana', '5411', 'hybrid80'],
  ['stealth-partial-feeds-dups', '5462', 'partialDups'],
  ['stealth-quiet-no-refund-payout', '5947', 'quiet'],
] as const) {
  pushSpec({
    slug, kind: 'front', category: 'Stealth & Evasion Launderers',
    expectedDecision: 'OPEN_CASE',
    expectedMechanism: (mode === 'hug495' || mode === 'partialDups') ? 'FABRICATED_SUBSTANCE' : 'TRANSACTION_LAUNDERING',
    typology: slug.replace(/-/g, ' '), mcc,
    ...(mode === 'kycShield' ? { hours: [0, 24] as [number, number], catchment: 'NATIONAL' as const, ticketMax: 100000, expectedRoundShare: 0.5 } : {}),
    mutate: (d, anchor) => {
      if (mode === 'hug495') {
        stripOptFeeds(d, ['orders', 'verification']);
        applyBettingPattern(d, anchor, { roundAmts: [495, 496, 497, 1985, 3490], nightHour: '23:45:00', unmatchedOrders: true });
        d.purchaserVerification = { contacted: 15, confirmed: 3 };
      } else if (mode === 'day21') {
        applyBettingPattern(d, anchor, { nightHour: '21:10:00', unmatchedOrders: true });
        d.website.embeds.push({ id: 'E-D21', merchantId: d.merchant.id, linkId: 'PL-01', host: 'stakearena.example', path: '/d', category: 'gambling', pageType: 'deposit', firstSeen: '2026-06-01' });
      } else if (mode === 'splitPayers') {
        stripOptFeeds(d, ['bank']);
        applyBettingPattern(d, anchor, { nightHour: '23:30:00' });
        addPayoutSweep(d, 5, 1);
      } else if (mode === 'acqOnly') {
        stripOptFeeds(d);
        applyBettingPattern(d, anchor, { repeatPool: 4, nightHour: '23:30:00' });
        addPayoutSweep(d, 6, 1);
      } else if (mode === 'kycShield') {
        stripOptFeeds(d);
        applyBettingPattern(d, anchor, { nightHour: '01:15:00' });
        addPayoutSweep(d, 4, 1);
      } else if (mode === 'seasMult') {
        stripOptFeeds(d, ['orders', 'bank']);
        d.weeklySales.forEach((w: D, i: number) => { w.actual = i >= 9 ? 350000 : 100000; w.seasonalMultiplier = w.actual / 100000; });
        applyBettingPattern(d, anchor, { nightHour: '23:30:00', unmatchedOrders: true });
        addPayoutSweep(d, 5, 1);
      } else if (mode === 'hybrid70') {
        stripOptFeeds(d);
        applyBettingPattern(d, anchor, { nightHour: '02:05:00', shareFrac: 0.3 });
        addPayoutSweep(d, 4, 2);
      } else if (mode === 'hybrid80') {
        stripOptFeeds(d, ['orders']);
        applyBettingPattern(d, anchor, { nightHour: '01:50:00', shareFrac: 0.25, unmatchedOrders: true });
        addPayoutSweep(d, 4, 1);
      } else if (mode === 'partialDups') {
        d.dataAvailability = { acquiring: 'PARTIAL', website: 'PARTIAL', orders: 'PARTIAL', bank: 'PARTIAL', fulfillment: 'PARTIAL', calendar: 'MISSING', verification: 'PARTIAL' };
        applyBettingPattern(d, anchor, { nightHour: '23:50:00', unmatchedOrders: true });
        d.purchaserVerification = { contacted: 10, confirmed: 2 };
        const s0 = ownSales(d)[0];
        for (let i = 0; i < 4; i++) d.transactions.push({ ...s0, id: `DUP-14-${i}` });
      } else if (mode === 'quiet') {
        stripOptFeeds(d, ['verification']);
        applyBettingPattern(d, anchor, { nightHour: '23:30:00' });
        d.purchaserVerification = { contacted: 12, confirmed: 2 };
      }
    },
  });
}

// ==================== 3. MERCHANT ROTATION & PHOENIX FRONTS (8) ====================
for (const [slug, mcc, gapDays, ageDays, sharedBen] of [
  ['rotation-phoenix-1d-gap', '5462', 1, 12, true],
  ['rotation-phoenix-3d-gap', '5411', 3, 20, true],
  ['rotation-phoenix-7d-boundary', '5812', 7, 30, true],
  ['rotation-no-shared-ben-44d', '5814', 2, 44, false],
  ['rotation-cross-city-gifts', '5947', 2, 15, true],
  ['rotation-stationery-shell', '5943', 4, 22, true],
  ['rotation-retail-otc', '5999', 1, 18, true],
  ['rotation-multi-hop-chain', '5462', 2, 14, true],
] as const) {
  pushSpec({
    slug, kind: 'front', category: 'Merchant Rotation & Phoenix',
    expectedDecision: 'OPEN_CASE', expectedMechanism: 'ROTATION',
    typology: slug.replace(/-/g, ' '), mcc, ageDays,
    mutate: (d, anchor) => {
      stripOptFeeds(d, ['website']);
      addRotationPeer(d, anchor, { gapDays, sharedBen });
      if (slug === 'rotation-multi-hop-chain') {
        d.peers.push({ id: 'M-PEER-OLD-2', name: 'Earlier Shop', status: 'DORMANT', accountAgeDays: 700 });
      }
    },
  });
}

// ==================== 4. MULE RINGS, PAYOUT FAN-OUT & REFUND LAUNDERING (10) ====================
for (const [slug, mcc, mech, mode] of [
  ['mule-5-ben-hops-12-payouts', '5943', 'TRANSACTION_LAUNDERING', 'hops'],
  ['mule-8-ben-hops-sweep-1h', '5999', 'TRANSACTION_LAUNDERING', 'hops8'],
  ['payout-fanout-20-accounts', '5411', 'TRANSACTION_LAUNDERING', 'fan20'],
  ['rapid-sweep-all-settlements', '5814', 'TRANSACTION_LAUNDERING', 'sweep'],
  ['shadow-settlement-100pct-gap', '5943', 'TRANSACTION_LAUNDERING', 'shadow'],
  ['shadow-settlement-partial-gap', '5947', 'TRANSACTION_LAUNDERING', 'shadowPart'],
  ['orphan-refund-factory', '5947', 'TRANSACTION_LAUNDERING', 'orphanRef'],
  ['third-party-refund-diversion', '5462', 'TRANSACTION_LAUNDERING', 'thirdRef'],
  ['combined-refund-and-mule-ring', '5812', 'TRANSACTION_LAUNDERING', 'comboRef'],
  ['p2p-otc-liquidity-desk', '5999', 'TRANSACTION_LAUNDERING', 'otc'],
] as const) {
  pushSpec({
    slug, kind: 'front', category: 'Mule Rings & Payout Laundering',
    expectedDecision: 'OPEN_CASE', expectedMechanism: mech,
    typology: slug.replace(/-/g, ' '), mcc,
    mutate: (d, anchor) => {
      stripOptFeeds(d, ['bank', 'orders']);
      const sets = ownSets(d);
      const sales = ownSales(d);
      if (mode === 'hops' || mode === 'hops8') {
        sets.forEach((s: D, i: number) => { s.beneficiaryAccount = `MULE-${i}`; });
        addPayoutSweep(d, mode === 'hops8' ? 16 : 12, 1);
        d.weeklySales = Array.from({ length: 12 }, (_, i) => ({ week: `W${i + 1}`, actual: i < 9 ? 100000 : 400000, seasonalMultiplier: 1 }));
      } else if (mode === 'fan20') {
        addPayoutSweep(d, 20, 2);
        d.bankCredits = [];
      } else if (mode === 'sweep') {
        addPayoutSweep(d, 8, 1);
        applyBettingPattern(d, anchor, { roundAmts: [1000, 2000], unmatchedOrders: true, shareFrac: 0.5 });
      } else if (mode === 'shadow' || mode === 'shadowPart') {
        d.bankCredits = mode === 'shadow' ? [] : d.bankCredits.slice(0, 1);
        sets.forEach((s: D, i: number) => { s.beneficiaryAccount = `SHD-${i}`; });
        addPayoutSweep(d, 6, 1);
        sales.slice(0, 35).forEach((s: D) => { s.orderId = null; });
      } else if (mode === 'orphanRef') {
        for (let i = 0; i < 12; i++) d.transactions.push({ id: `OR-${i}`, merchantId: d.merchant.id, type: 'REFUND', amount: 1500, time: ist(anchor - i * HOUR), channel: 'UPI_LINK', payerId: `ORP-${i}` });
        sales.slice(0, 25).forEach((s: D) => { s.orderId = null; });
        addPayoutSweep(d, 12, 1);
      } else if (mode === 'thirdRef') {
        for (let i = 0; i < 10; i++) d.transactions.push({ id: `TR3-${i}`, merchantId: d.merchant.id, type: 'REFUND', amount: 2500, time: ist(anchor - i * HOUR), channel: 'UPI_LINK', payerId: sales[i].payerId, refundOfTransactionId: sales[i].id, paidTo: `EXT-3P-${i}`, destHolder: `OTHER-${i}` });
        sales.slice(0, 25).forEach((s: D) => { s.orderId = null; });
        addPayoutSweep(d, 12, 1);
      } else if (mode === 'comboRef') {
        for (let i = 0; i < 8; i++) d.transactions.push({ id: `OR-${i}`, merchantId: d.merchant.id, type: 'REFUND', amount: 1500, time: ist(anchor - i * HOUR), channel: 'UPI_LINK', payerId: `ORP-${i}` });
        for (let i = 0; i < 8; i++) d.transactions.push({ id: `TR3-${i}`, merchantId: d.merchant.id, type: 'REFUND', amount: 2500, time: ist(anchor - i * HOUR), channel: 'UPI_LINK', payerId: sales[i].payerId, refundOfTransactionId: sales[i].id, paidTo: `EXT-3P-${i}`, destHolder: `OTHER-${i}` });
        sales.slice(0, 25).forEach((s: D) => { s.orderId = null; });
        addPayoutSweep(d, 12, 1);
      } else if (mode === 'otc') {
        applyBettingPattern(d, anchor, { repeatPool: 4, roundAmts: [2000, 5000, 10000], unmatchedOrders: true });
        addPayoutSweep(d, 12, 1);
      }
    },
  });
}

// ==================== 5. FABRICATED COMMERCIAL SUBSTANCE / SHELLS (10) ====================
for (const [slug, mcc, orderMissFrac, verifConfirm] of [
  ['shell-furniture-total-fake', '5712', 0.8, 2],
  ['shell-stationery-reused-trk', '5943', 0.7, 1],
  ['shell-gifts-dup-catalogue', '5947', 0.6, 3],
  ['shell-bakery-zero-confirm', '5462', 0.75, 0],
  ['shell-kirana-undelivered', '5411', 0.85, 2],
  ['shell-restaurant-fake-online', '5812', 0.65, 2],
  ['shell-tiffin-no-fulfillment', '5814', 0.9, 1],
  ['shell-retail-high-ticket', '5999', 0.8, 2],
  ['shell-online-channel-only', '5712', 0.7, 1],
  ['shell-sudden-volume-fake', '5947', 0.75, 2],
] as const) {
  pushSpec({
    slug, kind: 'front', category: 'Fabricated Substance Shells',
    expectedDecision: 'OPEN_CASE', expectedMechanism: 'FABRICATED_SUBSTANCE',
    typology: slug.replace(/-/g, ' '), mcc,
    mutate: d => {
      const sales = ownSales(d);
      const missN = Math.round(sales.length * orderMissFrac);
      sales.forEach((s: D, i: number) => {
        s.amount = RULES.mcc(mcc).ticket.median * 4;
        if (slug === 'shell-online-channel-only') s.channel = 'ONLINE';
        if (i < missN) s.orderId = null;
      });
      d.orders = d.orders.slice(0, 15).map((o: D) => ({ ...o, status: slug.includes('undelivered') ? 'NONE' : 'SHIPPED', trackingId: 'DUP-TRK-999' }));
      d.website.catalogue = d.website.catalogue.map((c: D) => ({ ...c, inCategory: false, dupImage: true }));
      d.purchaserVerification = { contacted: 15, confirmed: verifConfirm };
      d.weeklySales = Array.from({ length: 12 }, (_, i) => ({ week: `W${i + 1}`, actual: i < 9 ? 100000 : 340000, seasonalMultiplier: 1 }));
    },
  });
}

// ==================== 6. ACCOUNT TAKEOVER, DRIFT & CROSS-MCC ABUSE (12) ====================
for (const [slug, mcc, anchorDate, surgeMult] of [
  ['takeover-bakery-3wk-surge', '5462', '2026-06-15', 4.5],
  ['takeover-kirana-3wk-surge', '5411', '2026-06-15', 4.0],
  ['takeover-restaurant-night-shift', '5812', '2026-06-15', 4.2],
  ['takeover-tiffin-geo-explosion', '5814', '2026-06-15', 4.8],
  ['takeover-gifts-gradual-drift', '5947', '2026-06-15', 3.8],
  ['takeover-stationery-round-shift', '5943', '2026-06-15', 4.5],
  ['takeover-retail-payout-drift', '5999', '2026-06-15', 4.0],
  ['takeover-diwali-camouflaged-surge', '5462', '2025-10-20', 9.0],
  ['takeover-xmas-camouflaged-gifts', '5947', '2026-12-25', 6.0],
  ['takeover-eid-camouflaged-food', '5812', '2026-03-21', 5.5],
  ['takeover-furniture-payout-ring', '5712', '2026-06-15', 4.5],
  ['takeover-multi-signal-late-ramp', '5411', '2026-06-15', 5.0],
] as const) {
  pushSpec({
    slug, kind: 'front', category: 'Account Takeover & Drift',
    expectedDecision: 'OPEN_CASE', expectedMechanism: 'TRANSACTION_LAUNDERING',
    typology: slug.replace(/-/g, ' '), mcc,
    anchorMs: Date.parse(`${anchorDate}T12:00:00+05:30`),
    mutate: (d, anchor) => {
      stripOptFeeds(d, ['bank']);
      d.weeklySales = Array.from({ length: 12 }, (_, i) => ({
        week: `W${i + 1}`,
        actual: i < 9 ? 100000 + ((i % 2) * 1500 - 750) : Math.round(100000 * surgeMult),
        seasonalMultiplier: 1,
      }));
      applyBettingPattern(d, anchor, { nightHour: '02:15:00', shareFrac: 0.75 });
      addPayoutSweep(d, 5, 1);
    },
  });
}

// ==================== 7. GENUINE SHOPS ACROSS ALL 8 MCCs & EDGE CASES (40) ====================
// 7a. Festival surges across sectors (8)
for (const [slug, mcc, date, w11, w10, w9] of [
  ['bakery-diwali-3x', '5462', '2025-10-20', 300000, 260000, 200000],
  ['bakery-holi-16x', '5462', '2026-03-04', 160000, 120000, 100000],
  ['kirana-diwali-16x', '5411', '2026-11-08', 160000, 150000, 130000],
  ['gifts-diwali-25x', '5947', '2026-11-08', 250000, 220000, 170000],
  ['gifts-rakhi-18x', '5947', '2026-08-28', 180000, 130000, 100000],
  ['gifts-christmas-16x', '5947', '2026-12-25', 160000, 130000, 100000],
  ['restaurant-eid-13x', '5812', '2026-03-21', 130000, 110000, 100000],
  ['furniture-diwali-15x', '5712', '2026-11-08', 150000, 140000, 130000],
] as const) {
  pushSpec({
    slug, kind: 'genuine', category: 'Genuine Festival Surges',
    expectedDecision: 'NO_CASE', typology: slug.replace(/-/g, ' '), mcc,
    anchorMs: Date.parse(`${date}T16:00:00+05:30`),
    mutate: d => {
      d.weeklySales = Array.from({ length: 12 }, (_, i) => ({
        week: `W${i + 1}`, actual: i === 11 ? w11 : i === 10 ? w10 : i === 9 ? w9 : 100000, seasonalMultiplier: 1,
      }));
    },
  });
}

// 7b. Geographic & Cohort Edge Cases (6)
for (const [slug, mcc, custom] of [
  ['kirana-border-neighbours', '5411', (d: D) => ownSales(d).forEach((s: D, i: number) => { s.payerState = ['KA', 'MH', 'TN', 'KL'][i % 4]; })],
  ['bakery-college-outofstate', '5462', (d: D) => ownSales(d).forEach((s: D, i: number) => { if (i % 3 === 0) s.payerState = ['MH', 'TN', 'DL', 'UP', 'WB'][i % 5]; })],
  ['furniture-national-wide-geo', '5712', (d: D) => ownSales(d).forEach((s: D, i: number) => { s.payerState = ['DL', 'MH', 'KA', 'TN', 'WB'][i % 5]; })],
  ['kirana-daily-regulars-5x', '5411', (d: D) => ownSales(d).forEach((s: D, i: number) => { s.payerId = `REG-${i % 12}`; })],
  ['stationery-repeat-b2b-4x', '5943', (d: D) => ownSales(d).forEach((s: D, i: number) => { s.payerId = `CORP-${i % 16}`; })],
  ['tiffin-border-regulars', '5814', (d: D) => ownSales(d).forEach((s: D, i: number) => { s.payerState = ['KA', 'AP', 'TS'][i % 3]; s.payerId = `TIFF-${i % 12}`; })],
] as const) {
  pushSpec({
    slug, kind: 'genuine', category: 'Genuine Geo & Repeat Edge Cases',
    expectedDecision: 'NO_CASE', typology: slug.replace(/-/g, ' '), mcc, mutate: custom,
  });
}

// 7c. Pricing, Refund & Single-Signal Traps (8)
for (const [slug, mcc, fn] of [
  ['gifts-catalogue-499-999', '5947', (d: D) => {
    d.website.catalogue.push({ sku: 'G-499', name: 'Box S', price: 499, inCategory: true, dupImage: false }, { sku: 'G-999', name: 'Box L', price: 999, inCategory: true, dupImage: false });
    ownSales(d).forEach((s: D, i: number) => { if (i % 4 === 0) s.amount = i % 8 === 0 ? 499 : 999; });
  }],
  ['bakery-giftbox-500-1000', '5462', (d: D) => ownSales(d).forEach((s: D, i: number) => { if (i % 3 === 0) s.amount = i % 2 ? 500 : 1000; })],
  ['stationery-mobile-self-refunds', '5943', (d: D, anchor: number) => {
    ownSales(d).slice(0, 8).forEach((s: D, i: number) => {
      s.payerMobile = `9900000${String(i).padStart(3, '0')}`;
      d.transactions.push({ id: `SR-${i}`, merchantId: d.merchant.id, type: 'REFUND', amount: 1500, time: ist(anchor - i * HOUR), channel: 'UPI_LINK', payerId: s.payerId, refundOfTransactionId: s.id, paidTo: `ALT-${i}`, destHolder: s.payerMobile });
    });
  }],
  ['bakery-small-3p-refund-under-5k', '5462', (d: D, anchor: number) => {
    ownSales(d).slice(0, 4).forEach((s: D, i: number) => {
      d.transactions.push({ id: `SM3-${i}`, merchantId: d.merchant.id, type: 'REFUND', amount: 1000, time: ist(anchor - i * HOUR), channel: 'UPI_LINK', payerId: s.payerId, refundOfTransactionId: s.id, paidTo: `WLT-${i}` });
    });
  }],
  ['restaurant-single-bank-switch', '5812', (d: D) => {
    const sets = ownSets(d);
    sets.forEach((s: D, i: number) => { if (i >= 2) s.beneficiaryAccount = 'BEN-NEW-2'; });
    d.bankCredits = sets.map((s: D) => ({ amount: s.amount, beneficiaryAccount: s.beneficiaryAccount }));
  }],
  ['kirana-own-account-sweeps', '5411', (d: D) => {
    ownSets(d).forEach((s: D, i: number) => d.transactions.push({ id: `OWN-${i}`, merchantId: d.merchant.id, type: 'TRANSFER', amount: 22000, time: ist(Date.parse(s.time) + 2 * HOUR), channel: 'PAYOUT', beneficiaryAccount: 'OWN-CA-01' }));
  }],
  ['bakery-wide-kyc-honest-tx', '5462', (d: D) => Object.assign(d.merchant, { catchment: 'NATIONAL', hours: [0, 24], ticketMax: 100000 })],
  ['retail-80pct-exact-verification', '5999', (d: D) => { d.purchaserVerification = { contacted: 10, confirmed: 8 }; }],
] as const) {
  pushSpec({
    slug, kind: 'genuine', category: 'Genuine Single-Signal & Exemption Traps',
    expectedDecision: 'NO_CASE', typology: slug.replace(/-/g, ' '), mcc, mutate: fn,
  });
}

// 7d. Overnight, Young Accounts, Acquirer-Only, Partial & Structural Edge Cases (18)
for (const mcc of ['5812', '5814'] as const) {
  pushSpec({
    slug: `overnight-honest-${mcc}`, kind: 'genuine', category: 'Genuine Overnight & Delivery',
    expectedDecision: 'NO_CASE', typology: `Genuine overnight ${RULES.mcc(mcc).name}`, mcc, hours: [20, 4],
  });
}
pushSpec({
  slug: 'bakery-late-night-delivery-2230', kind: 'genuine', category: 'Genuine Overnight & Delivery',
  expectedDecision: 'NO_CASE', typology: 'Genuine late-night delivery 22:30', mcc: '5462',
  mutate: (d, anchor) => ownSales(d).forEach((s: D, i: number) => { if (i % 3 === 0) s.time = `${ist(anchor - (i % 7) * DAY).slice(0, 10)}T22:30:00+05:30`; }),
});

for (const [slug, mcc, age] of [
  ['young-cafe-15d-clean', '5812', 15],
  ['young-kirana-45d-clean', '5411', 45],
  ['young-gifts-90d-clean', '5947', 90],
  ['young-retail-180d-clean', '5999', 180],
] as const) {
  pushSpec({
    slug, kind: 'genuine', category: 'Genuine Young Onboarding Shops',
    expectedDecision: 'NO_CASE', typology: `Clean young ${age}d shop`, mcc, ageDays: age,
  });
}

for (const mcc of ['5462', '5411', '5812', '5814', '5947', '5712', '5943', '5999']) {
  pushSpec({
    slug: `acquirer-only-clean-${mcc}`, kind: 'genuine', category: 'Genuine Acquirer-Only (Missing Optional Feeds)',
    expectedDecision: 'NO_CASE', typology: `Clean acquirer-only ${RULES.mcc(mcc).name}`, mcc,
    mutate: d => stripOptFeeds(d),
  });
}

pushSpec({
  slug: 'partial-feeds-clean-bakery', kind: 'genuine', category: 'Genuine Structural Edge Cases',
  expectedDecision: 'NO_CASE', typology: 'Clean bakery with PARTIAL feeds', mcc: '5462',
  mutate: d => { d.dataAvailability = { acquiring: 'PARTIAL', website: 'PARTIAL', orders: 'PARTIAL', bank: 'PARTIAL', fulfillment: 'PARTIAL', calendar: 'MISSING', verification: 'PARTIAL' }; },
});
pushSpec({
  slug: 'all-weekly-null-clean-kirana', kind: 'genuine', category: 'Genuine Structural Edge Cases',
  expectedDecision: 'NO_CASE', typology: 'Clean kirana with all weeklySales null', mcc: '5411',
  mutate: d => d.weeklySales.forEach((w: D) => { w.actual = null; }),
});
pushSpec({
  slug: 'anonymous-pos-1sale-minimum', kind: 'genuine', category: 'Genuine Structural Edge Cases',
  expectedDecision: 'NO_CASE', typology: 'Clean single-sale anonymous shop', mcc: '5814', nSales: 1,
  mutate: d => { delete ownSales(d)[0].payerId; stripOptFeeds(d); },
});

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const manifest = SPECS.map(spec => {
  const dataset = baseDataset(spec);
  writeFileSync(join(OUT_DIR, spec.file), JSON.stringify(dataset, null, 2) + '\n');
  return {
    file: spec.file,
    merchantId: dataset.merchant.id,
    mcc: spec.mcc,
    kind: spec.kind,
    category: spec.category,
    typology: spec.typology,
    expectedDecision: spec.expectedDecision,
    expectedMechanism: spec.expectedMechanism ?? null,
  };
});

writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Generated ${manifest.length} datasets (${manifest.filter(m => m.kind === 'front').length} fronts, ${manifest.filter(m => m.kind === 'genuine').length} genuine) in ${OUT_DIR}/`);
