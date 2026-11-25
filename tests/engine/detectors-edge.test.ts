/**
 * Exhaustive boundary, coverage, minN, and edge-case tests for all 25 statistical/deterministic detectors
 * in `frontend/src/engines/detectors.ts`.
 * Returns the number of failed assertions.
 */
import { DETECTORS, runDetectors, outsideHours } from '../../frontend/src/engines/detectors';
import { volumeModel } from '../../frontend/src/engines/residualEngine';
import { cusum } from '../../frontend/src/engines/cusumEngine';
import { cohortContinuity } from '../../frontend/src/engines/cohortContinuity';
import { RULES } from '../../rules/index';
import type { EvidenceItem } from '../../frontend/src/types/evidence';
import type { CoverageKey, CoverageState, Scenario } from '../../frontend/src/types/merchant';
import type { PaymentEvent } from '../../frontend/src/types/payment';

const DAY = 86400000;
const HOUR = 3600000;
const MIN = 60000;
// Base timestamp: 2026-06-01T12:00:00+05:30 (noon IST, far from any festival in rules/calendar.json)
const T0 = Date.parse('2026-06-01T12:00:00+05:30');

function mkSale(i: number, overrides: Partial<PaymentEvent> = {}): PaymentEvent {
  const amt = [510, 560, 610, 640, 710][i % 5];
  return {
    id: `S-${i}`,
    merchantId: 'M-TEST',
    type: 'SALE',
    amount: amt,
    eventTime: T0 - (i % 14) * DAY + (i % 6) * 600000,
    ingestTime: T0,
    payerRef: `P-${i}`,
    payerHash: `HP-${i}`,
    destHash: `HP-${i}`,
    payerState: 'KA',
    channel: 'UPI_LINK',
    linkId: 'LNK-1',
    orderId: `ORD-${i}`,
    source: 'acquirer.upi',
    ...overrides,
  };
}

function mkBaseScenario(overrides: Partial<Scenario> = {}): Scenario {
  const sales = Array.from({ length: 40 }, (_, i) => mkSale(i));
  const settlements: PaymentEvent[] = Array.from({ length: 4 }, (_, i) => ({
    id: `SET-${i}`,
    merchantId: 'M-TEST',
    type: 'SETTLEMENT',
    amount: 5000 + i * 10,
    eventTime: T0 - (3 - i) * 3 * DAY,
    settleTime: T0 - (3 - i) * 3 * DAY,
    ingestTime: T0,
    payerRef: '—',
    payerHash: '—',
    destHash: 'BEN-1',
    beneficiaryHash: 'BEN-1',
    payerState: '—',
    channel: 'BANK',
    source: 'settlement.ledger',
  }));
  const weekly = Array.from({ length: 12 }, (_, i) => ({
    week: `W${i + 1}`,
    actual: 50000 + ((i % 3) - 1) * 1500,
    seasonalMult: 1,
  }));
  const orders = sales.map((s, i) => ({
    orderId: `ORD-${i}`,
    saleId: s.id,
    status: 'DELIVERED' as const,
    trackingId: `TRK-${i}`,
  }));
  const bankCredits = settlements.map(s => ({ amount: s.amount, beneficiaryHash: 'BEN-1' }));

  return {
    id: 'custom',
    title: 'Edge Test Merchant',
    subtitle: 'Synthetic',
    blurb: 'Edge test',
    tone: 'benign',
    expectedOutcome: 'NO_CASE',
    scriptedLabel: 'ADJUDICATED_BENIGN',
    primaryMerchantId: 'M-TEST',
    profile: {
      id: 'M-TEST',
      name: 'Test Sweets',
      city: 'Bengaluru, KA',
      mcc: '5462',
      category: 'Bakeries and sweet shops',
      products: ['Ladoo'],
      ticketMin: 100,
      ticketMax: 1500,
      hours: [7, 22],
      catchment: 'LOCAL',
      localStates: ['KA'],
      expectedRoundShare: 0.06,
      seasonalPeak: 1,
      baselineWeekly: 50000,
      accountAgeDays: 500,
      declaredDomains: ['testsweets.example'],
      declaredChannels: ['UPI_LINK'],
      declaredActivity: ['Retail sweets'],
    },
    peers: [],
    events: [...sales, ...settlements],
    weekly,
    fixtures: [],
    coverage: {
      acquiring: 'AVAILABLE',
      website: 'AVAILABLE',
      orders: 'AVAILABLE',
      bank: 'AVAILABLE',
      fulfillment: 'AVAILABLE',
      calendar: 'AVAILABLE',
      verification: 'AVAILABLE',
    },
    web: {
      embeds: [{ id: 'E-1', merchantId: 'M-TEST', linkId: 'LNK-1', host: 'testsweets.example', path: '/pay', category: 'own', pageType: 'checkout', firstSeen: '2026-05-01' }],
      catalogue: Array.from({ length: 8 }, (_, i) => ({ sku: `SKU-${i}`, name: `Sweet ${i}`, price: 300 + i * 50, inCategory: true, dupImage: false })),
    },
    orders,
    verification: { contacted: 10, confirmed: 9 },
    bankCredits,
    graph: { nodes: [], edges: [] },
    synthetic: '',
    ...overrides,
  };
}

function evalDetectors(sc: Scenario): Map<string, EvidenceItem> {
  const events = sc.events.filter(e => e.merchantId === sc.primaryMerchantId);
  const vol = volumeModel(sc);
  const cs = cusum(vol.rows, vol.z);
  const cohort = cohortContinuity(sc);
  const ev = runDetectors({
    sc,
    p: sc.profile,
    norm: RULES.mcc(sc.profile.mcc),
    vol,
    all: events,
    sales: events.filter(e => e.type === 'SALE'),
    refunds: events.filter(e => e.type === 'REFUND'),
    settlements: events.filter(e => e.type === 'SETTLEMENT'),
    transfers: events.filter(e => e.type === 'TRANSFER'),
    rows: vol.rows,
    cusum: cs,
    cohort,
    scope: 'account',
    covered: () => false,
  });
  return new Map(ev.map(e => [e.id, e]));
}

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); }
    else console.log(`  ✓ ${name}`);
  };

  // 1. Coverage gating across all detectors: MISSING -> UNKNOWN & LLR=0; PARTIAL -> 0.7× LLR
  const baseEv = evalDetectors(mkBaseScenario());
  check(`all ${DETECTORS.length} detectors emitted`, baseEv.size === DETECTORS.length, `got ${baseEv.size}`);

  const covKeys: CoverageKey[] = ['acquiring', 'website', 'orders', 'bank', 'fulfillment', 'calendar', 'verification'];
  for (const key of covKeys) {
    const scMiss = mkBaseScenario();
    scMiss.coverage[key] = 'MISSING' as CoverageState;
    const missEv = evalDetectors(scMiss);
    for (const [id, item] of missEv) {
      if (item.requires.includes(key)) {
        check(`${id} MISSING(${key}) -> UNKNOWN & llr=0`, item.status === 'UNKNOWN' && item.llr === 0, `${item.status} ${item.llr}`);
      }
    }
  }

  // PARTIAL coverage scales LLR by 0.7 for non-UNKNOWN detectors
  {
    const scAvail = mkBaseScenario();
    scAvail.events.push({
      id: 'SET-EXT', merchantId: 'M-TEST', type: 'SETTLEMENT', amount: 5000,
      eventTime: T0, settleTime: T0, ingestTime: T0, payerRef: '—', payerHash: '—',
      destHash: 'BEN-2', beneficiaryHash: 'BEN-2', payerState: '—', channel: 'BANK', source: 'settlement.ledger',
    });
    const availMap = evalDetectors(scAvail);
    const scPart = mkBaseScenario();
    scPart.events.push({ ...scAvail.events[scAvail.events.length - 1] });
    scPart.coverage.acquiring = 'PARTIAL';
    scPart.coverage.orders = 'PARTIAL';
    const partMap = evalDetectors(scPart);
    const d10Avail = availMap.get('D10')!;
    const d10Part = partMap.get('D10')!;
    check('PARTIAL scales LLR by 0.7 (D10)', d10Avail.status !== 'UNKNOWN' && Math.abs(d10Part.llr - d10Avail.llr * 0.7) < 1e-12, `${d10Part.llr} vs ${d10Avail.llr * 0.7}`);
    check('PARTIAL sets reliability=0.7', d10Part.reliability === 0.7);
  }

  // 2. outsideHours helper boundary tests (regular & overnight)
  check('outsideHours [7,22]: 6 is outside', outsideHours(6, [7, 22]) === true);
  check('outsideHours [7,22]: 7 is inside', outsideHours(7, [7, 22]) === false);
  check('outsideHours [7,22]: 21 is inside', outsideHours(21, [7, 22]) === false);
  check('outsideHours [7,22]: 22 is outside', outsideHours(22, [7, 22]) === true);
  check('outsideHours [22,6]: 22 is inside', outsideHours(22, [22, 6]) === false);
  check('outsideHours [22,6]: 0 is inside', outsideHours(0, [22, 6]) === false);
  check('outsideHours [22,6]: 5 is inside', outsideHours(5, [22, 6]) === false);
  check('outsideHours [22,6]: 6 is outside', outsideHours(6, [22, 6]) === true);
  check('outsideHours [22,6]: 15 is outside', outsideHours(15, [22, 6]) === true);

  // 3. A1: Ticket sizes vs category norm (minN=30, zero/extreme amounts)
  {
    const sc29 = mkBaseScenario({ events: Array.from({ length: 29 }, (_, i) => mkSale(i, { amount: 50000 })) });
    check('A1 n=29 (<minN 30) -> UNKNOWN', evalDetectors(sc29).get('A1')!.status === 'UNKNOWN');

    const sc30 = mkBaseScenario({ events: Array.from({ length: 30 }, (_, i) => mkSale(i, { amount: 50000 })) });
    const a1 = evalDetectors(sc30).get('A1')!;
    check('A1 n=30 extreme tickets -> ILLICIT', a1.status === 'ILLICIT' && a1.llr > 0, `${a1.status} p=${a1.p} eff=${a1.effect}`);

    const scZero = mkBaseScenario({ events: Array.from({ length: 30 }, (_, i) => mkSale(i, { amount: 0 })) });
    const a1Zero = evalDetectors(scZero).get('A1')!;
    check('A1 amount=0 does not produce NaN', Number.isFinite(a1Zero.llr) && !Number.isNaN(a1Zero.effect));
  }

  // 4. A4: Round-number heaping (499 vs 500 boundary)
  {
    const sc499 = mkBaseScenario({ events: Array.from({ length: 40 }, (_, i) => mkSale(i, { amount: 499 })) });
    check('A4 ₹499 is not round -> BENIGN', evalDetectors(sc499).get('A4')!.status === 'BENIGN');

    const sc500 = mkBaseScenario({ events: Array.from({ length: 40 }, (_, i) => mkSale(i, { amount: 500 })) });
    check('A4 ₹500 is round -> ILLICIT', evalDetectors(sc500).get('A4')!.status === 'ILLICIT');
  }

  // 5. A5: Deposit/bonus tiers excluded when present in website catalogue
  {
    const scTierNoCat = mkBaseScenario({
      events: Array.from({ length: 40 }, (_, i) => mkSale(i, { amount: i % 2 === 0 ? 199 : 999 })),
    });
    check('A5 bonus tiers not in catalogue -> ILLICIT', evalDetectors(scTierNoCat).get('A5')!.status === 'ILLICIT');

    const scTierInCat = mkBaseScenario({
      events: Array.from({ length: 40 }, (_, i) => mkSale(i, { amount: i % 2 === 0 ? 199 : 999 })),
    });
    scTierInCat.web.catalogue = [
      { sku: 'B1', name: 'Box 199', price: 199, inCategory: true, dupImage: false },
      { sku: 'B2', name: 'Box 999', price: 999, inCategory: true, dupImage: false },
    ];
    check('A5 bonus tiers IN catalogue -> BENIGN', evalDetectors(scTierInCat).get('A5')!.status === 'BENIGN');
  }

  // 6. B6: Geography (NATIONAL MCC vs LOCAL MCC, neighbour states, missing payerState, empty localStates)
  {
    // KA neighbours include MH, TN, KL, AP, TS, GA (rules/states.json)
    const scNbr = mkBaseScenario({
      events: Array.from({ length: 40 }, (_, i) => mkSale(i, { payerState: ['KA', 'MH', 'TN', 'KL'][i % 4] })),
    });
    check('B6 neighbouring states count as local -> BENIGN', evalDetectors(scNbr).get('B6')!.status === 'BENIGN');

    const scFar = mkBaseScenario({
      events: Array.from({ length: 40 }, (_, i) => mkSale(i, { payerState: ['DL', 'UP', 'WB', 'PB'][i % 4] })),
    });
    check('B6 distant states -> ILLICIT', evalDetectors(scFar).get('B6')!.status === 'ILLICIT');

    const scNat = mkBaseScenario({
      events: Array.from({ length: 40 }, (_, i) => mkSale(i, { payerState: 'DL' })),
    });
    scNat.profile.mcc = '5712'; // Furniture = NATIONAL catchment
    check('B6 NATIONAL norm MCC -> UNKNOWN', evalDetectors(scNat).get('B6')!.status === 'UNKNOWN');

    const scNoState = mkBaseScenario({
      events: Array.from({ length: 40 }, (_, i) => mkSale(i, { payerState: '—' })),
    });
    check('B6 all missing payerState -> UNKNOWN', evalDetectors(scNoState).get('B6')!.status === 'UNKNOWN');

    const scEmptyLocal = mkBaseScenario();
    scEmptyLocal.profile.localStates = [];
    check('B6 empty localStates -> UNKNOWN', evalDetectors(scEmptyLocal).get('B6')!.status === 'UNKNOWN');
  }

  // 7. B7: Heavy repeat payers (boundary 7 vs 8 payments in same epoch week)
  {
    const baseWeek = Math.floor(T0 / (7 * DAY)) * 7 * DAY + HOUR;
    const sc7 = mkBaseScenario({
      events: Array.from({ length: 35 }, (_, i) => mkSale(i, {
        payerHash: `HP-GROUP-${Math.floor(i / 7)}`,
        eventTime: baseWeek + (i % 7) * HOUR,
      })),
    });
    check('B7 exactly 7/week -> BENIGN', evalDetectors(sc7).get('B7')!.status === 'BENIGN');

    const sc8 = mkBaseScenario({
      events: Array.from({ length: 40 }, (_, i) => mkSale(i, {
        payerHash: `HP-GROUP-${Math.floor(i / 8)}`,
        eventTime: baseWeek + (i % 8) * HOUR,
      })),
    });
    check('B7 exactly 8/week -> ILLICIT', evalDetectors(sc8).get('B7')!.status === 'ILLICIT');
  }

  // 8. B9: Purchaser verification (minN=5, 80% threshold, null verification)
  {
    const scNone = mkBaseScenario({ verification: null });
    check('B9 null verification -> UNKNOWN', evalDetectors(scNone).get('B9')!.status === 'UNKNOWN');

    const sc4 = mkBaseScenario({ verification: { contacted: 4, confirmed: 0 } });
    check('B9 n=4 (<minN 5) -> UNKNOWN', evalDetectors(sc4).get('B9')!.status === 'UNKNOWN');

    const sc80 = mkBaseScenario({ verification: { contacted: 10, confirmed: 8 } });
    check('B9 exact 80% confirm -> BENIGN', evalDetectors(sc80).get('B9')!.status === 'BENIGN');

    const scLow = mkBaseScenario({ verification: { contacted: 15, confirmed: 4 } });
    check('B9 low confirmation (4/15) -> ILLICIT', evalDetectors(scLow).get('B9')!.status === 'ILLICIT');
  }

  // 9. C2: Off-hours uses category norm hours (5462: 7..22 IST) regardless of merchant declared hours
  {
    const nightIst = Date.parse('2026-06-01T23:30:00+05:30');
    const scNight = mkBaseScenario({
      events: Array.from({ length: 40 }, (_, i) => mkSale(i, { eventTime: nightIst + i * 1000 })),
    });
    scNight.profile.hours = [0, 24]; // Merchant tries to declare 24h
    check('C2 uses norm hours even if profile says [0,24] -> ILLICIT', evalDetectors(scNight).get('C2')!.status === 'ILLICIT');
  }

  // 10. C5: Pre-match funding (no fixtures, all days match, 45-min boundary)
  {
    check('C5 empty fixtures -> UNKNOWN', evalDetectors(mkBaseScenario()).get('C5')!.status === 'UNKNOWN');

    // Fixtures on EVERY trading day -> no non-match control days -> UNKNOWN
    const scAllMatch = mkBaseScenario({
      events: Array.from({ length: 25 }, (_, i) => mkSale(i, { eventTime: T0 - i * DAY })),
      fixtures: Array.from({ length: 25 }, (_, i) => T0 - i * DAY + 15 * MIN),
    });
    check('C5 fixtures on all days -> UNKNOWN', evalDetectors(scAllMatch).get('C5')!.status === 'UNKNOWN');

    // Match days have sales 20 min before match; non-match days have sales at noon (different clock time)
    const matchDays = [0, 2, 4, 6, 8, 10];
    const salesC5: PaymentEvent[] = [];
    const fixturesC5: number[] = [];
    for (let d = 0; d < 14; d++) {
      const dayMidnight = Date.parse(`2026-06-${String(d + 1).padStart(2, '0')}T00:00:00+05:30`);
      const matchStart = dayMidnight + 19 * HOUR + 30 * MIN;
      if (matchDays.includes(d)) fixturesC5.push(matchStart);
      for (let j = 0; j < 4; j++) {
        salesC5.push(mkSale(d * 4 + j, {
          eventTime: matchDays.includes(d) ? matchStart - 20 * MIN + j * MIN : dayMidnight + 12 * HOUR + j * MIN,
        }));
      }
    }
    const scPreMatch = mkBaseScenario({ events: salesC5, fixtures: fixturesC5 });
    const c5 = evalDetectors(scPreMatch).get('C5')!;
    check('C5 pre-match burst vs non-match days -> ILLICIT', c5.status === 'ILLICIT' && (c5.effect ?? 0) >= 2, `${c5.status} eff=${c5.effect} p=${c5.p}`);
  }

  // 11. D7: Orphan refunds (minN=3, cross-merchant sale ID counts as orphan)
  {
    const scRef2 = mkBaseScenario();
    scRef2.events.push(
      { id: 'R1', merchantId: 'M-TEST', type: 'REFUND', amount: 500, eventTime: T0, ingestTime: T0, payerRef: 'P-1', payerHash: 'HP-1', destHash: 'HP-1', payerState: 'KA', channel: 'UPI_LINK', source: 'acquirer.refund' },
      { id: 'R2', merchantId: 'M-TEST', type: 'REFUND', amount: 500, eventTime: T0, ingestTime: T0, payerRef: 'P-2', payerHash: 'HP-2', destHash: 'HP-2', payerState: 'KA', channel: 'UPI_LINK', source: 'acquirer.refund' },
    );
    check('D7 n=2 (<minN 3) -> UNKNOWN', evalDetectors(scRef2).get('D7')!.status === 'UNKNOWN');

    const scRefPeer = mkBaseScenario();
    scRefPeer.events.push(mkSale(999, { id: 'PEER-SALE-1', merchantId: 'PEER-1' }));
    for (let i = 0; i < 4; i++) {
      scRefPeer.events.push({
        id: `RO-${i}`, merchantId: 'M-TEST', type: 'REFUND', amount: 600, eventTime: T0, ingestTime: T0,
        payerRef: 'P-1', payerHash: 'HP-1', destHash: 'HP-1', payerState: 'KA', channel: 'UPI_LINK',
        linkedSaleId: 'PEER-SALE-1', source: 'acquirer.refund',
      });
    }
    check('D7 refund linked to peer sale counts as orphan -> ILLICIT', evalDetectors(scRefPeer).get('D7')!.status === 'ILLICIT');
  }

  // 12. D9: Third-party refunds (value >= ₹5000 gate, destHolderHash === payerMobileHash exemption)
  {
    // Value < ₹5000 (4 × ₹1000 = ₹4000) must NOT fire!
    const scLowVal = mkBaseScenario();
    for (let i = 0; i < 4; i++) {
      scLowVal.events.push({
        id: `RL-${i}`, merchantId: 'M-TEST', type: 'REFUND', amount: 1000, eventTime: T0, ingestTime: T0,
        payerRef: `P-${i}`, payerHash: `HP-${i}`, destHash: `OTHER-${i}`, payerState: 'KA', channel: 'UPI_LINK',
        linkedSaleId: `S-${i}`, source: 'acquirer.refund',
      });
    }
    check('D9 third-party refunds ₹4,000 (<₹5,000 gate) -> BENIGN/UNKNOWN, not ILLICIT', evalDetectors(scLowVal).get('D9')!.status !== 'ILLICIT');

    // Same person's other account via mobile/holder hash match must NOT count as third-party
    const scOwnOther = mkBaseScenario();
    for (let i = 0; i < 4; i++) {
      scOwnOther.events[i].payerMobileHash = `MOB-${i}`;
      scOwnOther.events.push({
        id: `ROWN-${i}`, merchantId: 'M-TEST', type: 'REFUND', amount: 3000, eventTime: T0, ingestTime: T0,
        payerRef: `P-${i}`, payerHash: `HP-${i}`, destHash: `OTHER-ACC-${i}`, destHolderHash: `MOB-${i}`,
        payerState: 'KA', channel: 'UPI_LINK', linkedSaleId: `S-${i}`, source: 'acquirer.refund',
      });
    }
    check('D9 refund to payer own other account (mobile match) -> BENIGN', evalDetectors(scOwnOther).get('D9')!.status === 'BENIGN');

    // Value >= ₹5000 (4 × ₹1500 = ₹6000) to distinct holder -> ILLICIT
    const scHighVal = mkBaseScenario();
    for (let i = 0; i < 4; i++) {
      scHighVal.events.push({
        id: `RH-${i}`, merchantId: 'M-TEST', type: 'REFUND', amount: 1500, eventTime: T0, ingestTime: T0,
        payerRef: `P-${i}`, payerHash: `HP-${i}`, destHash: `THIRD-${i}`, payerState: 'KA', channel: 'UPI_LINK',
        linkedSaleId: `S-${i}`, source: 'acquirer.refund',
      });
    }
    check('D9 third-party refunds ₹6,000 (>=₹5,000) -> ILLICIT', evalDetectors(scHighVal).get('D9')!.status === 'ILLICIT');
  }

  // 13. D10: Orders missing (minN=20)
  {
    const sc19 = mkBaseScenario({ events: Array.from({ length: 19 }, (_, i) => mkSale(i, { orderId: null })) });
    check('D10 n=19 (<minN 20) -> UNKNOWN', evalDetectors(sc19).get('D10')!.status === 'UNKNOWN');
    const scUnmatched = mkBaseScenario({ events: Array.from({ length: 30 }, (_, i) => mkSale(i, { orderId: null })) });
    check('D10 30 unmatched orders -> ILLICIT', evalDetectors(scUnmatched).get('D10')!.status === 'ILLICIT');
  }

  // 14. E1: Shared third-party host (own vs unshared external vs shared with peer)
  {
    check('E1 only own embed -> BENIGN', baseEv.get('E1')!.status === 'BENIGN');

    const scUnshared = mkBaseScenario();
    scUnshared.web.embeds.push({ id: 'E-2', merchantId: 'M-TEST', linkId: 'LNK-1', host: 'blog.example', path: '/p', category: 'unknown', pageType: 'blog', firstSeen: '2026-05-01' });
    check('E1 unshared external embed -> UNKNOWN', evalDetectors(scUnshared).get('E1')!.status === 'UNKNOWN');

    const scShared = mkBaseScenario();
    scShared.web.embeds.push(
      { id: 'E-2', merchantId: 'M-TEST', linkId: 'LNK-1', host: 'shared-hub.example', path: '/a', category: 'unknown', pageType: 'checkout', firstSeen: '2026-05-01' },
      { id: 'E-3', merchantId: 'PEER-1', linkId: 'LNK-P', host: 'shared-hub.example', path: '/b', category: 'unknown', pageType: 'checkout', firstSeen: '2026-05-01' },
    );
    check('E1 shared third-party host -> ILLICIT', evalDetectors(scShared).get('E1')!.status === 'ILLICIT');
  }

  // 15. E3 & F2: Cohort continuity + lifecycle handoff (44 vs 45 days; 364 vs 365 days)
  {
    const peerSales = Array.from({ length: 20 }, (_, i) => mkSale(i, {
      id: `PS-${i}`, merchantId: 'PEER-DORMANT', eventTime: T0 - 15 * DAY - i * HOUR,
    }));
    const otherPeerSales = Array.from({ length: 30 }, (_, i) => mkSale(i, {
      id: `OPS-${i}`, merchantId: 'PEER-BG', payerRef: `BG-${i}`, payerHash: `HBG-${i}`, eventTime: T0 - 20 * DAY - i * HOUR,
    }));
    const ownSales = Array.from({ length: 20 }, (_, i) => mkSale(i, {
      id: `OS-${i}`, merchantId: 'M-TEST', eventTime: T0 - 13 * DAY + i * HOUR,
    }));
    // Handoff gap = 2 days (<=7), peer DORMANT
    const scHandoff = mkBaseScenario({
      events: [...ownSales, ...peerSales, ...otherPeerSales],
      peers: [
        { id: 'PEER-DORMANT', name: 'Old Shop', status: 'DORMANT', accountAgeDays: 400 },
        { id: 'PEER-BG', name: 'Unrelated Shop', status: 'ACTIVE', accountAgeDays: 600 },
      ],
    });
    scHandoff.profile.accountAgeDays = 44;
    const ev44 = evalDetectors(scHandoff);
    check('E3 high continuity + DORMANT handoff -> ILLICIT', ev44.get('E3')!.status === 'ILLICIT');
    check('F2 age=44 (<45) + handoff -> ILLICIT', ev44.get('F2')!.status === 'ILLICIT');

    scHandoff.profile.accountAgeDays = 45;
    check('F2 age=45 (boundary) + handoff -> UNKNOWN', evalDetectors(scHandoff).get('F2')!.status === 'UNKNOWN');

    // Active peer (not DORMANT) means no handoff -> E3 forced UNKNOWN
    scHandoff.peers = [{ id: 'PEER-DORMANT', name: 'Old Shop', status: 'ACTIVE', accountAgeDays: 400 }];
    check('E3 high continuity but ACTIVE peer (no handoff) -> UNKNOWN', evalDetectors(scHandoff).get('E3')!.status === 'UNKNOWN');

    const sc364 = mkBaseScenario(); sc364.profile.accountAgeDays = 364;
    check('F2 age=364 (<365), no handoff -> UNKNOWN', evalDetectors(sc364).get('F2')!.status === 'UNKNOWN');
    const sc365 = mkBaseScenario(); sc365.profile.accountAgeDays = 365;
    check('F2 age=365, no handoff -> BENIGN', evalDetectors(sc365).get('F2')!.status === 'BENIGN');
  }

  // 16. F5: Settlement beneficiary changes (<3 settlements, 0 changes, 1 change, 3+ changes, shared with peer)
  {
    const sc2Set = mkBaseScenario();
    sc2Set.events = sc2Set.events.filter(e => e.type !== 'SETTLEMENT').slice(0, 40);
    sc2Set.events.push(
      { id: 'S1', merchantId: 'M-TEST', type: 'SETTLEMENT', amount: 1000, eventTime: T0 - DAY, settleTime: T0 - DAY, ingestTime: T0, payerRef: '—', payerHash: '—', destHash: 'B1', beneficiaryHash: 'B1', payerState: '—', channel: 'BANK', source: 'settlement.ledger' },
      { id: 'S2', merchantId: 'M-TEST', type: 'SETTLEMENT', amount: 1000, eventTime: T0, settleTime: T0, ingestTime: T0, payerRef: '—', payerHash: '—', destHash: 'B2', beneficiaryHash: 'B2', payerState: '—', channel: 'BANK', source: 'settlement.ledger' },
    );
    check('F5 2 settlements (<minN 3) -> UNKNOWN', evalDetectors(sc2Set).get('F5')!.status === 'UNKNOWN');

    check('F5 0 beneficiary changes -> BENIGN', baseEv.get('F5')!.status === 'BENIGN');

    const sc1Chg = mkBaseScenario();
    const sets = sc1Chg.events.filter(e => e.type === 'SETTLEMENT');
    sets[2].beneficiaryHash = 'BEN-2'; sets[3].beneficiaryHash = 'BEN-2';
    check('F5 1 beneficiary change (bank switch) -> UNKNOWN', evalDetectors(sc1Chg).get('F5')!.status === 'UNKNOWN');

    const scManyChg = mkBaseScenario();
    const setsM = scManyChg.events.filter(e => e.type === 'SETTLEMENT');
    setsM.forEach((s, i) => { s.beneficiaryHash = `BEN-CH-${i}`; });
    check('F5 3 beneficiary changes in 9 days -> ILLICIT', evalDetectors(scManyChg).get('F5')!.status === 'ILLICIT');

    const scSharedBen = mkBaseScenario();
    scSharedBen.events.push({
      id: 'PEER-SET', merchantId: 'PEER-1', type: 'SETTLEMENT', amount: 1000, eventTime: T0 - DAY, settleTime: T0 - DAY,
      ingestTime: T0, payerRef: '—', payerHash: '—', destHash: 'BEN-1', beneficiaryHash: 'BEN-1', payerState: '—', channel: 'BANK', source: 'settlement.ledger',
    });
    check('F5 0 changes but shared beneficiary with peer -> ILLICIT', evalDetectors(scSharedBen).get('F5')!.status === 'ILLICIT');
  }

  // 17. F7: Fulfilment (reused tracking IDs count as undelivered, minN=10)
  {
    const sc9 = mkBaseScenario({ orders: mkBaseScenario().orders.slice(0, 9).map(o => ({ ...o, status: 'NONE' })) });
    check('F7 n=9 (<minN 10) -> UNKNOWN', evalDetectors(sc9).get('F7')!.status === 'UNKNOWN');

    const scDupTrk = mkBaseScenario();
    scDupTrk.orders = scDupTrk.orders.map(o => ({ ...o, status: 'DELIVERED', trackingId: 'SAME-TRK-1' }));
    check('F7 all DELIVERED but reused trackingId -> ILLICIT', evalDetectors(scDupTrk).get('F7')!.status === 'ILLICIT');
  }

  // 18. F8: Bank credit reconciliation (±1 rupee tolerance)
  {
    const scTol = mkBaseScenario();
    scTol.bankCredits = scTol.bankCredits.map(b => ({ ...b, amount: b.amount + 1 }));
    check('F8 ₹1 tolerance still matches -> BENIGN', evalDetectors(scTol).get('F8')!.status === 'BENIGN');

    const scMissBank = mkBaseScenario();
    scMissBank.bankCredits = scMissBank.bankCredits.map(b => ({ ...b, amount: b.amount + 50 }));
    check('F8 ₹50 mismatch -> ILLICIT', evalDetectors(scMissBank).get('F8')!.status === 'ILLICIT');
  }

  // 19. G2: Catalogue off-category / dupImage (minN=5)
  {
    const scCat4 = mkBaseScenario();
    scCat4.web.catalogue = scCat4.web.catalogue.slice(0, 4).map(c => ({ ...c, inCategory: false }));
    check('G2 n=4 (<minN 5) -> UNKNOWN', evalDetectors(scCat4).get('G2')!.status === 'UNKNOWN');

    const scCatBad = mkBaseScenario();
    scCatBad.web.catalogue = scCatBad.web.catalogue.map(c => ({ ...c, dupImage: true }));
    check('G2 all dupImage -> ILLICIT', evalDetectors(scCatBad).get('G2')!.status === 'ILLICIT');
  }

  // 20. G6: Undeclared vs known betting host (effect 0.6 vs 1.25)
  {
    check('G6 declared domain -> BENIGN', baseEv.get('G6')!.status === 'BENIGN');

    const scExt = mkBaseScenario();
    scExt.web.embeds.push({ id: 'E-X', merchantId: 'M-TEST', linkId: 'LNK-1', host: 'other.example', path: '/pay', category: 'resale', pageType: 'checkout', firstSeen: '2026-05-01' });
    const g6Ext = evalDetectors(scExt).get('G6')!;
    check('G6 generic undeclared host -> ILLICIT effect=0.6', g6Ext.status === 'ILLICIT' && g6Ext.effect === 0.6);

    const scBetHost = mkBaseScenario();
    scBetHost.web.embeds.push({ id: 'E-B', merchantId: 'M-TEST', linkId: 'LNK-1', host: 'stakearena.example', path: '/dep', category: 'unknown', pageType: 'deposit', firstSeen: '2026-05-01' });
    const g6Bet = evalDetectors(scBetHost).get('G6')!;
    check('G6 known host from rules/hosts.json -> ILLICIT effect=1.25', g6Bet.status === 'ILLICIT' && g6Bet.effect === 1.25);
  }

  // 21. H1 & H2: Weekly volume model, festival adjustment, null weeks, BOCPD+CUSUM agreement
  {
    const sc5w = mkBaseScenario({ weekly: mkBaseScenario().weekly.slice(0, 5) });
    check('H1 <6 weeks -> UNKNOWN', evalDetectors(sc5w).get('H1')!.status === 'UNKNOWN');

    const sc7w = mkBaseScenario({ weekly: mkBaseScenario().weekly.slice(0, 7) });
    check('H2 <8 weeks -> UNKNOWN', evalDetectors(sc7w).get('H2')!.status === 'UNKNOWN');

    const scNullRecent = mkBaseScenario();
    scNullRecent.weekly.slice(-4).forEach(w => { w.actual = null; });
    check('H1 all recent null -> UNKNOWN (no NaN)', evalDetectors(scNullRecent).get('H1')!.status === 'UNKNOWN' && !Number.isNaN(evalDetectors(scNullRecent).get('H1')!.llr));

    // Surge in last 3 weeks (non-festival June 2026) -> both H1 and H2 fire;
    // Also check H2 disagreement (slow early shift where CUSUM alarms but BOCPD < 0.7) -> UNKNOWN
    const scSurge = mkBaseScenario();
    scSurge.weekly = Array.from({ length: 12 }, (_, i) => ({
      week: `W${i + 1}`,
      actual: i < 9 ? 50000 + ((i % 2) * 1000 - 500) : 250000,
      seasonalMult: 1,
    }));
    const surgeEv = evalDetectors(scSurge);
    check('H1 5× non-festival surge -> ILLICIT', surgeEv.get('H1')!.status === 'ILLICIT');
    check('H2 changepoint (last 3 weeks) + CUSUM alarm -> ILLICIT', surgeEv.get('H2')!.status === 'ILLICIT');

    const scOldShift = mkBaseScenario();
    scOldShift.weekly = Array.from({ length: 12 }, (_, i) => ({
      week: `W${i + 1}`,
      actual: i < 6 ? 50000 + ((i % 2) * 1000 - 500) : 200000,
      seasonalMult: 1,
    }));
    check('H2 CUSUM alarm without recent-window changepoint -> UNKNOWN', evalDetectors(scOldShift).get('H2')!.status === 'UNKNOWN');

    // Legitimate Diwali 3× surge on Diwali 2025-10-20 week for sweets (sector ramp 3.0)
    const diwaliEnd = Date.parse('2025-10-20T18:00:00+05:30');
    const scDiwali = mkBaseScenario({
      events: Array.from({ length: 40 }, (_, i) => mkSale(i, { eventTime: diwaliEnd - (i % 5) * HOUR })),
      weekly: Array.from({ length: 12 }, (_, i) => ({
        week: `W${i + 1}`,
        actual: i === 11 ? 150000 : i === 10 ? 130000 : 50000 + ((i % 2) * 1000 - 500),
        seasonalMult: 1,
      })),
    });
    check('H1 Diwali 3× sweets surge explained by calendar -> BENIGN', evalDetectors(scDiwali).get('H1')!.status === 'BENIGN');
  }

  // 22. H3: Joint off-profile cluster (>=2 traits in same sale)
  {
    const nightIst = Date.parse('2026-06-01T23:30:00+05:30');
    // 2 traits on different sales (half round local daytime, half non-round distant daytime) -> 0 joint sales!
    const scDisjoint = mkBaseScenario({
      events: Array.from({ length: 40 }, (_, i) => mkSale(i, {
        amount: i % 2 === 0 ? 1000 : 537,
        payerState: i % 2 === 0 ? 'KA' : 'DL',
      })),
    });
    check('H3 traits on separate transactions -> BENIGN', evalDetectors(scDisjoint).get('H3')!.status === 'BENIGN');

    // Embedded cluster: 25% of sales combine round + distant while 75% are clean
    const scJoint = mkBaseScenario({
      events: Array.from({ length: 100 }, (_, i) => mkSale(i, i < 25 ? {
        amount: 1000,
        payerState: 'DL',
      } : {})),
    });
    check('H3 co-occurring traits in same sales -> ILLICIT', evalDetectors(scJoint).get('H3')!.status === 'ILLICIT');
  }

  // 23. I2 & I3: Payouts & 24h sweep window boundary
  {
    check('I2 0 transfers -> UNKNOWN', baseEv.get('I2')!.status === 'UNKNOWN');

    const scManyPayouts = mkBaseScenario();
    for (let i = 0; i < 12; i++) {
      scManyPayouts.events.push({
        id: `TR-${i}`, merchantId: 'M-TEST', type: 'TRANSFER', amount: 2000,
        eventTime: T0, ingestTime: T0, payerRef: '—', payerHash: '—', destHash: `DEST-${i}`,
        beneficiaryHash: `DEST-${i}`, payerState: '—', channel: 'PAYOUT', source: 'payout.ledger',
      });
    }
    check('I2 12 beneficiaries vs norm 3 -> ILLICIT', evalDetectors(scManyPayouts).get('I2')!.status === 'ILLICIT');

    // I3: transfer 1ms BEFORE settlement vs 24h AFTER vs 24h+1ms AFTER
    const scBefore = mkBaseScenario();
    scBefore.events.filter(e => e.type === 'SETTLEMENT').forEach((s, i) => {
      scBefore.events.push({
        id: `TB-${i}`, merchantId: 'M-TEST', type: 'TRANSFER', amount: 4000,
        eventTime: s.eventTime - 1, ingestTime: T0, payerRef: '—', payerHash: '—',
        destHash: 'OWN-1', beneficiaryHash: 'OWN-1', payerState: '—', channel: 'PAYOUT', source: 'payout.ledger',
      });
    });
    check('I3 transfer 1ms BEFORE settlement does not count -> BENIGN', evalDetectors(scBefore).get('I3')!.status === 'BENIGN');

    const scAfter24h = mkBaseScenario();
    scAfter24h.events.filter(e => e.type === 'SETTLEMENT').forEach((s, i) => {
      scAfter24h.events.push({
        id: `TA-${i}`, merchantId: 'M-TEST', type: 'TRANSFER', amount: 4000,
        eventTime: s.eventTime + 24 * HOUR + 1, ingestTime: T0, payerRef: '—', payerHash: '—',
        destHash: 'OWN-1', beneficiaryHash: 'OWN-1', payerState: '—', channel: 'PAYOUT', source: 'payout.ledger',
      });
    });
    check('I3 transfer 24h+1ms after settlement does not count -> BENIGN', evalDetectors(scAfter24h).get('I3')!.status === 'BENIGN');

    const scExact24h = mkBaseScenario();
    scExact24h.events.filter(e => e.type === 'SETTLEMENT').forEach((s, i) => {
      scExact24h.events.push({
        id: `TE-${i}`, merchantId: 'M-TEST', type: 'TRANSFER', amount: 4000,
        eventTime: s.eventTime + 24 * HOUR, ingestTime: T0, payerRef: '—', payerHash: '—',
        destHash: 'OWN-1', beneficiaryHash: 'OWN-1', payerState: '—', channel: 'PAYOUT', source: 'payout.ledger',
      });
    });
    check('I3 transfer at exact +24h boundary counts -> ILLICIT', evalDetectors(scExact24h).get('I3')!.status === 'ILLICIT');
  }

  // 24. K1: Declared profile vs norm
  {
    check('K1 norm-aligned profile -> BENIGN', baseEv.get('K1')!.status === 'BENIGN');
    const scWide = mkBaseScenario();
    scWide.profile.catchment = 'NATIONAL';
    scWide.profile.hours = [0, 24];
    scWide.profile.ticketMax = 100000;
    scWide.profile.expectedRoundShare = 0.5;
    check('K1 absurdly wide profile on LOCAL MCC -> ILLICIT', evalDetectors(scWide).get('K1')!.status === 'ILLICIT');
  }

  return bad;
}
