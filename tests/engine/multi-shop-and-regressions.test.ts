/**
 * Multi-shop coverage (all 8 MCC categories) + regression tests for edge-case bugs
 * discovered in the current engine implementation.
 *
 * NOTE: Regression tests marked [BUG-REG] intentionally fail on the current unpatched engine
 * and will pass once the corresponding model/engine fixes are applied.
 * Returns the number of failed assertions.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { analyze } from '../../engine/index';
import { bocpdRecentChange } from '../../frontend/src/stats/changepoint';
import { RULES } from '../../rules/index';

type D = Record<string, any>;
const DAY = 86400000;
const T0 = Date.parse('2026-06-01T12:00:00+05:30');

function buildShopDataset(
  mcc: string,
  opts: {
    front?: boolean;
    overnight?: boolean;
    missingOpt?: boolean;
    date?: string;
    festMult?: number;
    posOnly?: boolean;
    salesOverride?: (i: number) => Record<string, unknown>;
  } = {},
): D {
  const n = RULES.mcc(mcc);
  const anchor = Date.parse((opts.date ?? '2026-06-01') + 'T12:00:00+05:30');
  const open = opts.overnight ? 20 : n.open;
  const close = opts.overnight ? 4 : n.close;

  const sales = Array.from({ length: 60 }, (_, i) => {
    const offHr = i < Math.round(60 * (opts.front ? 0.35 : n.offHoursShare));
    let hr = open < close
      ? open + (i % Math.max(1, close - open))
      : (open + (i % (24 - open + close))) % 24;
    if (offHr) hr = open < close ? (close + 1) % 24 : (close + 2) % 24;

    const istDate = new Date(anchor - (i % 14) * DAY + 19800000).toISOString().slice(0, 10);
    const time = `${istDate}T${String(hr).padStart(2, '0')}:15:00+05:30`;
    const isOffArea = i < Math.round(60 * (opts.front ? 0.45 : n.offAreaShare));
    // Deterministic spread around category median
    const mult = [0.65, 0.85, 1.0, 1.15, 1.45][i % 5];
    const amt = opts.front && i % 2 === 0 ? 1000 : Math.max(20, Math.round(n.ticket.median * mult));

    const base: Record<string, unknown> = {
      id: `S-${mcc}-${i}`,
      merchantId: `M-${mcc}`,
      type: 'SALE',
      amount: amt,
      time,
      channel: opts.posOnly ? 'POS' : 'UPI_LINK',
      payerId: opts.front ? `DEP-${i % 4}` : `CUST-${i}`,
      payerState: isOffArea ? 'DL' : 'KA',
      ...(opts.posOnly ? {} : { orderId: opts.front ? null : `ORD-${i}` }),
    };
    return opts.salesOverride ? { ...base, ...opts.salesOverride(i) } : base;
  });

  const settlements = Array.from({ length: 4 }, (_, i) => ({
    id: `SET-${mcc}-${i}`,
    merchantId: `M-${mcc}`,
    type: 'SETTLEMENT',
    amount: 25000,
    time: new Date(anchor - (3 - i) * 3 * DAY).toISOString(),
    channel: 'BANK',
    beneficiaryAccount: 'BEN-1',
  }));

  const ledgerSum = sales.reduce((s, t) => s + Number(t.amount), 0);
  const weeklyBase = Math.max(1000, Math.round(ledgerSum / 2));
  const weeklySales = Array.from({ length: 12 }, (_, i) => ({
    week: `W${i + 1}`,
    actual: i === 11 && opts.festMult ? Math.round(weeklyBase * opts.festMult) : weeklyBase + ((i % 3) - 1) * Math.round(weeklyBase * 0.03),
    seasonalMultiplier: 1,
  }));

  const d: D = {
    format: 'mre-dataset/v1',
    merchant: {
      id: `M-${mcc}`,
      name: `Shop ${mcc}`,
      city: 'Bengaluru, KA',
      mcc,
      category: n.name,
      ticketMin: 20,
      ticketMax: Math.round(n.ticket.median * 5),
      baselineWeekly: weeklyBase,
      accountAgeDays: 400,
      hours: [open, close],
      catchment: n.catchment,
      localStates: ['KA'],
      declaredDomains: ['shop.example'],
    },
    weeklySales,
    transactions: [...sales, ...settlements],
    dataAvailability: opts.missingOpt
      ? { acquiring: 'AVAILABLE', website: 'MISSING', orders: 'MISSING', bank: 'MISSING', fulfillment: 'MISSING', calendar: 'MISSING', verification: 'MISSING' }
      : { acquiring: 'AVAILABLE', website: 'AVAILABLE', orders: 'AVAILABLE', bank: 'AVAILABLE', fulfillment: 'AVAILABLE', calendar: 'MISSING', verification: 'AVAILABLE' },
  };

  if (!opts.missingOpt) {
    d.website = {
      embeds: [{ id: 'E1', merchantId: `M-${mcc}`, linkId: 'L1', host: 'shop.example', path: '/pay', category: 'own', pageType: 'checkout', firstSeen: '2026-05-01' }],
      catalogue: Array.from({ length: 6 }, (_, i) => ({ sku: `K${i}`, name: 'Item', price: n.ticket.median, inCategory: true, dupImage: false })),
    };
    d.orders = sales.map((s, i) => ({ orderId: `ORD-${i}`, saleId: s.id, status: 'DELIVERED', trackingId: `TRK-${i}` }));
    d.bankCredits = settlements.map(s => ({ amount: s.amount, beneficiaryAccount: 'BEN-1' }));
    d.purchaserVerification = { contacted: 10, confirmed: 9 };
  }
  return d;
}

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); }
    else console.log(`  ✓ ${name}`);
  };

  // ==================== 1. MULTI-SHOP MATRIX (ALL 8 MCCs) ====================
  const allMccs = ['5462', '5411', '5812', '5814', '5947', '5712', '5943', '5999'];
  for (const mcc of allMccs) {
    const label = `${mcc} (${RULES.mcc(mcc).name})`;

    const rFull = analyze(buildShopDataset(mcc));
    check(`multi-shop genuine full feeds ${label} -> NO_CASE`,
      rFull.ok && rFull.result.fusion.decision === 'NO_CASE',
      rFull.ok ? `${rFull.result.fusion.decision} P=${rFull.result.fusion.posterior.toFixed(5)}` : rFull.errors.join(', '));

    const rAcq = analyze(buildShopDataset(mcc, { missingOpt: true }));
    check(`multi-shop genuine acquirer-only ${label} -> NO_CASE`,
      rAcq.ok && rAcq.result.fusion.decision === 'NO_CASE',
      rAcq.ok ? `${rAcq.result.fusion.decision} P=${rAcq.result.fusion.posterior.toFixed(5)}` : '');

    // Disguised front across each MCC (no website & no purchaser verification)
    const dFront = buildShopDataset(mcc, { front: true });
    dFront.dataAvailability.website = 'MISSING';
    dFront.dataAvailability.verification = 'MISSING';
    delete dFront.website;
    dFront.purchaserVerification = null;
    const rFront = analyze(dFront);
    check(`multi-shop disguised front ${label} -> OPEN_CASE`,
      rFront.ok && rFront.result.fusion.decision === 'OPEN_CASE',
      rFront.ok ? `${rFront.result.fusion.decision} P=${rFront.result.fusion.posterior.toFixed(4)}` : '');
  }

  // Overnight restaurants & fast food
  for (const mcc of ['5812', '5814']) {
    const rNight = analyze(buildShopDataset(mcc, { overnight: true }));
    check(`multi-shop overnight ${mcc} [20,4] -> NO_CASE`,
      rNight.ok && rNight.result.fusion.decision === 'NO_CASE',
      rNight.ok ? `${rNight.result.fusion.decision} P=${rNight.result.fusion.posterior.toFixed(5)}` : '');
  }

  // Festival calendar checks across non-bakery sectors
  const festChecks: [string, string, string, number][] = [
    ['5947 Gifts @ Christmas (1.6x)', '5947', '2026-12-25', 1.6],
    ['5812 Restaurant @ Eid (1.3x)', '5812', '2026-03-21', 1.3],
    ['5712 Furniture @ Diwali (1.5x)', '5712', '2026-11-08', 1.5],
    ['5411 Kirana @ Diwali (1.6x)', '5411', '2026-11-08', 1.6],
  ];
  for (const [label, mcc, date, festMult] of festChecks) {
    const r = analyze(buildShopDataset(mcc, { date, festMult, missingOpt: true }));
    check(`festival ${label} -> H1 BENIGN & NO_CASE`,
      r.ok && r.result.evidence.find(e => e.id === 'H1')!.status === 'BENIGN' && r.result.fusion.decision === 'NO_CASE');
  }

  // ==================== 2. REGRESSION TESTS FOR DISCOVERED MODEL BUGS ====================

  // [BUG-REG #2] Monte-Carlo 90% CI must always contain the point posterior: lo <= posterior <= hi
  const sampleFiles = readdirSync('frontend/public/samples').filter(f => /^0[1-9]-/.test(f)).sort();
  for (const f of sampleFiles) {
    const r = analyze(JSON.parse(readFileSync(`frontend/public/samples/${f}`, 'utf8')));
    if (!r.ok) { check(`[BUG-REG #2] ${f} parses`, false); continue; }
    const { posterior, posteriorCi: [lo, hi] } = r.result.fusion;
    check(`[BUG-REG #2] ${f}: 90% CI contains posterior (lo <= P <= hi)`,
      lo <= posterior + 1e-12 && posterior <= hi + 1e-12,
      `P=${posterior} CI=[${lo}, ${hi}]`);
  }

  // [BUG-REG #3] bocpdRecentChange & H2 must detect a sustained shift starting 4 weeks ago (matching H2 description)
  {
    const z4 = Array.from({ length: 12 }, (_, i) => (i < 8 ? 0 : 4.0));
    const pc4 = bocpdRecentChange(z4);
    check('[BUG-REG #3a] bocpdRecentChange detects shift starting 4 weeks ago (>= 0.7)',
      pc4 >= 0.7, `got pc=${pc4.toFixed(4)}`);

    const dH2 = buildShopDataset('5411', { missingOpt: true });
    const baseW = dH2.merchant.baselineWeekly as number;
    dH2.weeklySales = Array.from({ length: 12 }, (_, i) => ({
      week: `W${i + 1}`,
      actual: i < 8 ? Math.round(baseW * 0.22) + ((i % 2) * 200 - 100) : baseW,
      seasonalMultiplier: 1,
    }));
    const rH2 = analyze(dH2);
    const h2 = rH2.ok ? rH2.result.evidence.find(e => e.id === 'H2')! : null;
    check('[BUG-REG #3b] H2 fires on 4-week volume regime shift',
      !!h2 && h2.status === 'ILLICIT',
      h2 ? `status=${h2.status} effect=${h2.effect}` : 'parse failed');
  }

  // [BUG-REG #4] Discrete fixed-menu genuine shops (5812 Restaurant, 5814 Fast Food, 5943 Stationery) must not trigger A1
  const menuCases: [string, number[]][] = [
    ['5814', [80, 150, 220, 350]],
    ['5812', [250, 450, 650, 900]],
    ['5943', [20, 50, 120, 350]],
  ];
  for (const [mcc, menu] of menuCases) {
    const d = buildShopDataset(mcc, { salesOverride: i => ({ amount: menu[i % menu.length] }) });
    const r = analyze(d);
    const a1 = r.ok ? r.result.evidence.find(e => e.id === 'A1')! : null;
    check(`[BUG-REG #4] discrete-menu ${mcc} does not false-fire A1`,
      !!a1 && a1.status !== 'ILLICIT',
      a1 ? `A1=${a1.status} D=${a1.effect?.toFixed(3)} p=${a1.p?.toExponential(2)}` : '');
  }

  // [BUG-REG #5] Brick-and-mortar POS shops (5411 Kirana, 5814 Tiffin) without orderId on POS sales must not fire D10
  for (const mcc of ['5411', '5814']) {
    const d = buildShopDataset(mcc, { posOnly: true, missingOpt: true });
    d.dataAvailability.orders = 'AVAILABLE';
    const r = analyze(d);
    const d10 = r.ok ? r.result.evidence.find(e => e.id === 'D10')! : null;
    check(`[BUG-REG #5] POS-only ${mcc} with orders=AVAILABLE does not fire D10`,
      !!d10 && d10.status !== 'ILLICIT',
      d10 ? `D10=${d10.status} P=${r.ok ? r.result.fusion.posterior.toFixed(4) : ''}` : '');
  }

  // [BUG-REG #6] Offline Gift Shop (5947) with 99-ending retail prices (199/299/499/999) and website=MISSING must not fire A5
  {
    const d = buildShopDataset('5947', {
      missingOpt: true,
      salesOverride: i => ({ amount: [199, 299, 499, 999, 850][i % 5] }),
    });
    const r = analyze(d);
    const a5 = r.ok ? r.result.evidence.find(e => e.id === 'A5')! : null;
    check('[BUG-REG #6] offline Gift Shop 5947 99-ending prices do not fire A5',
      !!a5 && a5.status !== 'ILLICIT',
      a5 ? `A5=${a5.status} P=${r.ok ? r.result.fusion.posterior.toFixed(4) : ''}` : '');
  }

  // [BUG-REG #7] G6 domain matching must be case-insensitive and ignore leading www.
  {
    const d = buildShopDataset('5812');
    d.merchant.declaredDomains = ['MyShop.example', 'www.altshop.example'];
    d.website.embeds = [
      { id: 'E1', merchantId: 'M-5812', linkId: 'L1', host: 'myshop.example', path: '/pay', category: 'own', pageType: 'checkout', firstSeen: '2026-05-01' },
      { id: 'E2', merchantId: 'M-5812', linkId: 'L1', host: 'altshop.example', path: '/pay', category: 'own', pageType: 'checkout', firstSeen: '2026-05-01' },
    ];
    const r = analyze(d);
    const g6 = r.ok ? r.result.evidence.find(e => e.id === 'G6')! : null;
    check('[BUG-REG #7] G6 normalizes case and www. on declaredDomains',
      !!g6 && g6.status === 'BENIGN',
      g6 ? `G6=${g6.status} (${g6.observed})` : '');
  }

  // [BUG-REG #8] Empty website: { embeds: [], catalogue: [] } without dataAvailability must stay MISSING (E1 UNKNOWN, not BENIGN credit)
  {
    const d = buildShopDataset('5411');
    delete d.dataAvailability;
    d.website = { embeds: [], catalogue: [] };
    d.orders = [];
    d.bankCredits = [];
    d.purchaserVerification = null;
    const r = analyze(d);
    const e1 = r.ok ? r.result.evidence.find(e => e.id === 'E1')! : null;
    check('[BUG-REG #8] empty website {} keeps coverage.website=MISSING and E1=UNKNOWN',
      r.ok && r.result.scenario.coverage.website === 'MISSING' && !!e1 && e1.status === 'UNKNOWN',
      r.ok && e1 ? `cov=${r.result.scenario.coverage.website} E1=${e1.status} llr=${e1.llr.toFixed(3)}` : '');
  }

  // [BUG-REG #9] B7 must catch 8 payments in 6 hours even when straddling Thursday 00:00 UTC
  {
    const wed = Date.parse('2026-06-03T20:00:00Z');
    const thu = Date.parse('2026-06-04T02:00:00Z');
    const d = buildShopDataset('5814', {
      salesOverride: i => ({
        payerId: `BURST-${Math.floor(i / 8)}`,
        time: new Date((i % 8 < 4 ? wed : thu) + (i % 4) * 60000).toISOString(),
      }),
    });
    const r = analyze(d);
    const b7 = r.ok ? r.result.evidence.find(e => e.id === 'B7')! : null;
    check('[BUG-REG #9] B7 catches 8 payments in 6 hours straddling Thu UTC',
      !!b7 && b7.status === 'ILLICIT',
      b7 ? `B7=${b7.status} (${b7.observed})` : '');
  }

  // [BUG-REG #10] C5 must catch pre-match funding at 23:45 IST before a 00:15 IST match
  {
    const d = buildShopDataset('5812', {
      salesOverride: i => {
        const day = i % 10;
        const dayStr = `2026-06-${String(10 + day).padStart(2, '0')}`;
        return { time: `${dayStr}${day % 2 === 0 ? 'T23:45:00+05:30' : 'T12:00:00+05:30'}` };
      },
    });
    d.dataAvailability.calendar = 'AVAILABLE';
    d.matchFixtures = [0, 2, 4, 6, 8].map(day => `2026-06-${String(11 + day).padStart(2, '0')}T00:15:00+05:30`);
    const r = analyze(d);
    const c5 = r.ok ? r.result.evidence.find(e => e.id === 'C5')! : null;
    check('[BUG-REG #10] C5 catches 23:45 IST funding for 00:15 IST match',
      !!c5 && c5.status === 'ILLICIT',
      c5 ? `C5=${c5.status} (${c5.observed})` : '');
  }

  return bad;
}
