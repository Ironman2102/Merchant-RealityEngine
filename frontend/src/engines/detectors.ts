/**
 * L3 detector library (v2 + conduct/profile separation). Each detector runs a statistical test of the merchant against
 * its CATEGORY NORM (rules/mcc.json), the festival/match calendar or an independent source, and returns p-value,
 * effect size and n. `judge` turns that into an evidence weight (LLR). The merchant's self-declared profile is never
 * used as the baseline; it is only compared with the norm (K1).
 */
import type { MerchantProfile, Scenario, CoverageKey } from '../types/merchant';
import type { PaymentEvent } from '../types/payment';
import type { EvidenceItem, Family, Mechanism, Provenance } from '../types/evidence';
import type { CohortMatch, CusumPoint, WeeklyRow } from '../types/investigation';
import { istHour, pct, inr } from '../utils/format';
import { RULES, type MccNorm } from '../../../rules/index';
import { judge, type Obs } from './judge';
import type { VolumeModel } from './residualEngine';
import { betaBinomUpperP, priorFromRate } from '../stats/eb';
import { binomSf, binomCdf, chi2Sf, hypergeomSf, lognormalCdf, normalSf, poissonSf } from '../stats/dist';
import { ksOneSample } from '../stats/tests';
import { wilson } from '../stats/intervals';
import { bocpdRecentChange } from '../stats/changepoint';
import { rng, seedOf, shuffle } from '../stats/rng';
import { type Axis } from './passport';
import { hasBetween } from '../utils/num';
import { instant } from '../utils/time';

export type ScopeKind = 'account' | 'link' | 'channel' | 'repeat-payers';
export interface Ctx {
  sc: Scenario; p: MerchantProfile; norm: MccNorm; all: PaymentEvent[];
  sales: PaymentEvent[]; refunds: PaymentEvent[]; settlements: PaymentEvent[]; transfers: PaymentEvent[]; chargebacks?: PaymentEvent[];
  rows: WeeklyRow[]; cusum: CusumPoint[]; cohort: CohortMatch[]; vol: VolumeModel;
  scope: ScopeKind; covered: (e: PaymentEvent, axis: Axis) => boolean;
  learnedRates?: Map<string, { sensitivity: number; falsePositive: number }>;
}
interface Def { id: string; run: (c: Ctx) => Obs }

const ids = (xs: PaymentEvent[]) => xs.map(e => e.id);
const embedIds = (xs: { id?: string }[]) => xs.map(x => x.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
const share = (x: number, n: number) => (n ? x / n : 0);
const ci90 = (x: number, n: number) => (n ? wilson(x, n, 0.9) : null);
const unknown = (why: string, expected = '—', expectedSource = '—'): Obs => ({ p: null, effect: null, n: 0, effectLabel: '—', observed: 'Not assessable', expected, explanation: why, expectedSource, force: 'UNKNOWN' });

/** Outside trading hours. Overnight businesses (open > close, e.g. [22, 6]) wrap past midnight. */
export const outsideHours = (h: number, [open, close]: [number, number] | number[]) => open < close ? h < open || h >= close : h < open && h >= close;
const isRound = (a: number) => a >= RULES.amounts.roundMin && a % RULES.amounts.roundStep === 0;
export const homeAndNeighbours = (p: MerchantProfile) => { const home = p.localStates[0]; return home ? new Set([home, ...RULES.neighbours(home)]) : null; };
const isRemote = (e: PaymentEvent, local: Set<string>) => !!e.payerState && e.payerState !== '—' && e.payerState !== 'UNKNOWN' && !local.has(e.payerState);
const hasPayer = (e: PaymentEvent) => !!e.payerHash && e.payerHash !== '—';

/** Payments by a payer who made at least `conduct.minPayments` of them inside some `conduct.windowDays` window. */
export function regulars(xs: PaymentEvent[]): PaymentEvent[] {
  const { windowDays, minPayments } = RULES.engine.conduct, by = new Map<string, PaymentEvent[]>(), keep = new Set<PaymentEvent>();
  for (const e of xs) if (hasPayer(e)) { const list = by.get(e.payerHash); if (list) list.push(e); else by.set(e.payerHash, [e]); }
  by.forEach(list => {
    list.sort((a, b) => a.eventTime - b.eventTime);
    for (let i = minPayments - 1; i < list.length; i++) {
      if (list[i].eventTime - list[i - minPayments + 1].eventTime <= windowDays * 86400000) { list.forEach(e => keep.add(e)); break; }
    }
  });
  return xs.filter(e => keep.has(e));
}

const normSrc = (c: Ctx) => `Category norm for MCC ${c.p.mcc} (${c.norm.name}), rules/mcc.json`;

/** Rate test against the category norm with empirical-Bayes beta-binomial (prior strength 200 merchant-sales). */
function rateTest(x: number, n: number, normRate: number, strength = 200) {
  const pr = priorFromRate(normRate, strength);
  return { p: n ? betaBinomUpperP(x, n, pr) : 1, effect: share(x, n) - normRate, ci: ci90(x, n) };
}

const IST_OFFSET_MS = 19_800_000;
const fastIstDay = (t: number) => Math.floor((t + IST_OFFSET_MS) / 86_400_000);
const fastIstMin = (t: number) => {
  const m = Math.floor((t + IST_OFFSET_MS) / 60_000) % 1440;
  return m < 0 ? m + 1440 : m;
};
const fastIstHour = (t: number) => Math.floor(fastIstMin(t) / 60);

const PRE = RULES.engine.preMatchMinutes;
function matchWindows(c: Ctx) {
  const fx = [...c.sc.fixtures, ...RULES.calendar.cricketFixtures.map(f => instant(String(f)))].filter(Number.isFinite);
  const fixDays = new Set(fx.map(f => fastIstDay(fastIstMin(f) < PRE ? f - PRE * 60_000 : f)));
  const wins = [...new Set(fx.map(fastIstMin))].map(m => [m - PRE, m] as const);
  const inWin = (m: number) => wins.some(([a, b]) => (a >= 0 ? m >= a && m < b : m >= a + 1440 || m < b));
  return { fx, fixDays, inWin };
}

export const DETECTORS: Def[] = [
  { id: 'A1', run: c => {
    const xs = c.sales.filter(e => !c.covered(e, 'amount')), n = xs.length;
    if (!n) return unknown('A verified Context Passport covers these payments.');
    const amounts = xs.map(s => s.amount), sorted = [...amounts].sort((a, b) => a - b), med = sorted[Math.floor(n / 2)] ?? 0;
    const { low, high } = RULES.engine.ticketShift, centre = Math.min(c.norm.ticket.median * high, Math.max(c.norm.ticket.median * low, med));
    const t = ksOneSample(sorted, x => lognormalCdf(x, centre, c.norm.ticket.sigma));
    const counts = new Map<number, number>();
    for (const a of amounts) counts.set(a, (counts.get(a) ?? 0) + 1);
    const nonRoundTop3 = [...counts.entries()].filter(([a]) => !isRound(a)).sort((a, b) => b[1] - a[1]).slice(0, 3).reduce((s, [, cnt]) => s + cnt, 0);
    const discreteMenu = c.scope === 'account' && n >= 20 && nonRoundTop3 / n >= 0.45 && med >= c.norm.ticket.median * low && med <= c.norm.ticket.median * 2.5;
    return { p: t.p, effect: discreteMenu ? 0 : t.statistic, n, effectLabel: 'KS distance D', ci: null, expectedSource: normSrc(c),
      force: discreteMenu ? 'BENIGN' : undefined,
      observed: `Median ticket ${inr(med)}; distribution distance D = ${t.statistic.toFixed(2)}`, expected: `Median about ${inr(c.norm.ticket.median)}, spread like the category`,
      explanation: discreteMenu ? 'Discrete menu pricing within normal category ticket bounds.' : 'Compares the whole ticket-size distribution with what this kind of business normally takes.',
      metrics: { D: t.statistic.toFixed(3), p: t.p.toExponential(2), median: inr(med) } };
  } },
  { id: 'A4', run: c => {
    const xs = c.sales.filter(e => !c.covered(e, 'amount')), r = xs.filter(e => isRound(e.amount)), n = xs.length, t = rateTest(r.length, n, c.norm.roundShare);
    return { ...t, n, effectLabel: 'excess share at ₹500 multiples', expectedSource: normSrc(c), records: ids(r),
      observed: `${pct(share(r.length, n))} of tickets at round ₹500 multiples (${r.length} of ${n})`, expected: `about ${pct(c.norm.roundShare)}`,
      explanation: 'Real baskets rarely land on round values. Heaping suggests amounts chosen by a payer, not built from products.', metrics: { round: r.length, share: pct(share(r.length, n), 1), p: t.p.toExponential(2) } };
  } },
  { id: 'A5', run: c => {
    const tiers = new Set(RULES.amounts.bonusTiers), catalogue = new Set(c.sc.web.catalogue.map(i => Math.round(i.price)));
    const offlineNoCat = c.sc.coverage.website === 'MISSING' && c.sc.web.catalogue.length === 0;
    const xs = c.sales.filter(e => !c.covered(e, 'amount')), hit = xs.filter(e => tiers.has(e.amount) && !catalogue.has(e.amount) && !(offlineNoCat && e.amount % 100 === 99)), n = xs.length, t = rateTest(hit.length, n, c.norm.bonusShare);
    return { ...t, n, effectLabel: 'excess share at deposit/bonus-tier amounts', expectedSource: `${normSrc(c)}; tiers in rules/amounts.json`, records: ids(hit),
      observed: `${pct(share(hit.length, n))} of tickets at deposit-tier amounts not in the catalogue`, expected: `about ${pct(c.norm.bonusShare)}`,
      explanation: 'Amounts like ₹199, ₹999, ₹1,999 that are not catalogue prices match betting deposit tiers.', metrics: { tier: hit.length, p: t.p.toExponential(2) } };
  } },
  { id: 'B6', run: c => {
    if (c.norm.catchment === 'NATIONAL') return unknown('This category sells nationally, so payer geography is not informative.', 'National catchment', normSrc(c));
    const local = homeAndNeighbours(c.p);
    if (!local) return unknown('No home state on the merchant record.');
    const known = c.sales.filter(e => e.payerState && e.payerState !== '—' && e.payerState !== 'UNKNOWN' && !c.covered(e, 'area')), off = known.filter(e => !local.has(e.payerState)), t = rateTest(off.length, known.length, c.norm.offAreaShare);
    return { ...t, n: known.length, effectLabel: 'excess out-of-area share', expectedSource: `${normSrc(c)}; neighbouring states count as local (rules/states.json)`, records: ids(off),
      observed: `${pct(share(off.length, known.length))} of payers from outside ${[...local].slice(0, 1)} and its neighbours (${new Set(off.map(e => e.payerState)).size} states)`,
      expected: `about ${pct(c.norm.offAreaShare)}`, explanation: 'A neighbourhood business receiving many payments from far away is off-profile.',
      metrics: { outOfArea: off.length, states: new Set(off.map(e => e.payerState)).size, p: t.p.toExponential(2) } };
  } },
  { id: 'B7', run: c => {
    if (c.scope === 'repeat-payers') return unknown('This stream is made of repeat payers, so their repetition is not evidence.');
    const known = c.sales.filter(hasPayer);
    const byPayer = new Map<string, PaymentEvent[]>();
    known.forEach(e => byPayer.set(e.payerHash, [...(byPayer.get(e.payerHash) ?? []), e]));
    const heavyIds = new Set<string>(), winMs = 7 * 86400000, bar = RULES.engine.heavyRepeatPerWeek;
    for (const evs of byPayer.values()) {
      if (evs.length < bar) continue;
      const sorted = [...evs].sort((a, b) => a.eventTime - b.eventTime);
      let l = 0;
      for (let r = 0; r < sorted.length; r++) {
        while (sorted[r].eventTime - sorted[l].eventTime > winMs) l++;
        if (r - l + 1 >= bar) for (let k = l; k <= r; k++) heavyIds.add(sorted[k].id);
      }
    }
    const heavy = known.filter(e => heavyIds.has(e.id)), t = rateTest(heavy.length, known.length, c.norm.heavyRepeatShare);
    return { ...t, n: known.length, effectLabel: 'excess share from heavy repeat payers', expectedSource: normSrc(c), records: ids(heavy),
      observed: `${pct(share(heavy.length, known.length))} of sales from payers paying ${bar}+ times in a week`, expected: `about ${pct(c.norm.heavyRepeatShare)}`,
      explanation: 'Betting depositors top up again and again within days; regular customers of most shops do not.', metrics: { heavySales: heavy.length, p: t.p.toExponential(2) } };
  } },
  { id: 'B8', run: c => {
    const K = RULES.engine.conduct, known = c.sales.filter(hasPayer);
    if (!known.length) return unknown('No payer identifiers.');
    if (c.scope === 'repeat-payers' && (!RULES.knowsCategory(c.p.mcc) || c.norm.roundShare > RULES.engine.streams.repeatCohortMaxRoundNorm)) return unknown('Regulars of this category often pay round amounts, so this stream cannot test it.');
    const hit = regulars(known.filter(e => e.amount >= K.depositMin && e.amount % K.depositStep === 0)), t = rateTest(hit.length, known.length, K.depositNorm);
    return { ...t, n: known.length, effectLabel: 'excess share of repeat deposit-like payments', expectedSource: 'Category-free: the declared category cannot relax this test', records: ids(hit),
      observed: `${pct(share(hit.length, known.length))} of sales are round top-ups from payers who keep coming back (${new Set(hit.map(e => e.payerHash)).size} payers)`, expected: `about ${pct(K.depositNorm)}`,
      explanation: 'The same people paying round sums again and again is how wallets are topped up, whatever the merchant says it sells.', metrics: { repeatDeposits: hit.length, p: t.p.toExponential(2) } };
  } },
  { id: 'B10', run: c => {
    if (c.norm.catchment === 'NATIONAL') return unknown('This category sells nationally, so distant repeat payers are not informative.', 'National catchment', normSrc(c));
    const local = homeAndNeighbours(c.p);
    if (!local) return unknown('No home state on the merchant record.');
    const known = c.sales.filter(e => hasPayer(e) && !!e.payerState && e.payerState !== '—' && e.payerState !== 'UNKNOWN');
    if (!known.length) return unknown('No payer locations. A UPI ID does not carry one.');
    const hit = regulars(known.filter(e => isRemote(e, local))), t = rateTest(hit.length, known.length, RULES.engine.conduct.remoteNorm);
    return { ...t, n: known.length, effectLabel: 'excess share from distant regulars', expectedSource: 'Category-free: the declared category cannot relax this test', records: ids(hit),
      observed: `${pct(share(hit.length, known.length))} of sales come from distant payers who pay repeatedly`, expected: `about ${pct(RULES.engine.conduct.remoteNorm)}`,
      explanation: 'Visitors and delivery customers come from far away. People far away who pay every few days are a different thing.', metrics: { distantRegularSales: hit.length, p: t.p.toExponential(2) } };
  } },
  { id: 'B9', run: c => {
    const v = c.sc.verification; if (!v || !v.contacted) return unknown('No purchaser verification sample.');
    const p = binomCdf(v.confirmed, v.contacted, 0.8), rate = v.confirmed / v.contacted;
    return { p, effect: 0.8 - rate, n: v.contacted, effectLabel: 'shortfall below 80% confirmation', ci: ci90(v.confirmed, v.contacted), expectedSource: 'Genuine merchants: ≥ 80% of sampled purchasers confirm',
      observed: `${v.confirmed} of ${v.contacted} sampled purchasers confirm buying`, expected: '≥ 80% confirm', force: rate >= 0.8 ? 'BENIGN' : undefined,
      explanation: 'Independently contacted payers either recognise their purchase or they do not. This is hard to fake.', metrics: { contacted: v.contacted, confirmed: v.confirmed, p: p.toExponential(2) } };
  } },
  { id: 'C2', run: c => {
    if (c.norm.open === 0 && c.norm.close === 24) return unknown('This category trades around the clock, so hours are not informative.');
    const xs = c.sales.filter(e => !c.covered(e, 'hours'));
    const off = xs.filter(e => outsideHours(fastIstHour(e.eventTime), [c.norm.open, c.norm.close])), n = xs.length, t = rateTest(off.length, n, c.norm.offHoursShare);
    return { ...t, n, effectLabel: 'excess off-hours share', expectedSource: `${normSrc(c)} (${c.norm.open}:00–${c.norm.close}:00)`, records: ids(off),
      observed: `${pct(share(off.length, n))} of sales outside ${c.norm.open}:00–${c.norm.close}:00`, expected: `about ${pct(c.norm.offHoursShare)}`,
      explanation: 'Collections arriving when this kind of business is normally closed.', metrics: { offHours: off.length, p: t.p.toExponential(2) } };
  } },
  { id: 'C5', run: c => {
    const { fx, fixDays, inWin } = matchWindows(c);
    if (!fx.length) return unknown('No match fixtures in the window, so alignment cannot be tested.', '—', 'Uploaded fixtures + rules/calendar.json');
    const days = new Map<number, { inW: number; tot: number }>();
    const hit: PaymentEvent[] = [];
    for (const e of c.sales) {
      const k = fastIstDay(e.eventTime);
      let d = days.get(k);
      if (!d) { d = { inW: 0, tot: 0 }; days.set(k, d); }
      d.tot++;
      if (inWin(fastIstMin(e.eventTime))) {
        d.inW++;
        if (fixDays.has(k)) hit.push(e);
      }
    }
    const nDays = days.size;
    const isFix: boolean[] = [], inWArr: number[] = [], totArr: number[] = [];
    let kCount = 0, matchTot = 0;
    for (const [key, d] of days) {
      const f = fixDays.has(key);
      isFix.push(f); inWArr.push(d.inW); totArr.push(d.tot);
      if (f) { kCount++; matchTot += d.tot; }
    }
    if (!kCount || kCount === nDays) return unknown('Fixtures fall on all or none of the trading days, so there is no comparison.');
    const rate = (sel: boolean[]) => {
      let a = 0, b = 0;
      for (let i = 0; i < nDays; i++) if (sel[i]) { a += inWArr[i]; b += totArr[i]; }
      return b ? a / b : 0;
    };
    const obs = rate(isFix), ctrl = rate(isFix.map(x => !x)), r = rng(seedOf(c.p.id + 'C5'));
    let ge = 0; const B = RULES.engine.permutationDraws;
    for (let i = 0; i < B; i++) if (rate(shuffle(r, isFix)) >= obs - 1e-12) ge++;
    const p = (ge + 1) / (B + 1), ratio = obs / Math.max(ctrl, 0.5 / Math.max(c.sales.length, 1)), n = matchTot;
    return { p, effect: ratio, n, effectLabel: 'rate ratio vs non-match days', ci: null, expectedSource: 'Same clock windows on non-match days (permutation over days)', records: ids(hit),
      observed: `${pct(obs)} of match-day sales in the ${PRE} min before a start vs ${pct(ctrl)} on other days (${ratio.toFixed(1)}×)`, expected: 'No difference from other days',
      explanation: 'Funding that clusters just before match starts, compared with the same clock time on days without matches.', metrics: { ratio: ratio.toFixed(2), p: p.toFixed(4), matchDays: kCount } };
  } },
  { id: 'C6', run: c => {
    const K = RULES.engine.conduct, known = c.sales.filter(hasPayer);
    if (!known.length) return unknown('No payer identifiers.');
    const by = new Map<string, PaymentEvent[]>(), hit = new Set<PaymentEvent>();
    for (const e of known) if (e.amount >= K.depositMin) { const list = by.get(e.payerHash); if (list) list.push(e); else by.set(e.payerHash, [e]); }
    by.forEach(list => {
      list.sort((a, b) => a.eventTime - b.eventTime);
      for (let i = 0; i + 2 < list.length; i++) {
        const [a, b, d] = [list[i], list[i + 1], list[i + 2]];
        if (d.eventTime - a.eventTime <= K.burstHours * 3600000 && b.amount >= a.amount && d.amount >= b.amount && d.amount > a.amount) [a, b, d].forEach(x => hit.add(x));
      }
    });
    const t = rateTest(hit.size, known.length, K.burstNorm, 100);
    return { ...t, n: known.length, effectLabel: 'excess share inside rising runs', expectedSource: 'Category-free: the declared category cannot relax this test', records: ids([...hit]),
      observed: `${pct(share(hit.size, known.length))} of sales sit in a same-payer run of rising payments`, expected: `about ${pct(K.burstNorm)}`,
      explanation: 'Three growing payments by one person within two hours resembles chasing losses.', metrics: { burstSales: hit.size, p: t.p.toExponential(2) } };
  } },
  { id: 'D7', run: c => {
    if (!c.refunds.length) return unknown('No refunds in the window.');
    const sid = new Set(c.sales.map(s => s.id)), orph = c.refunds.filter(r => !r.linkedSaleId || !sid.has(r.linkedSaleId)), t = rateTest(orph.length, c.refunds.length, 0.02, 50);
    return { ...t, n: c.refunds.length, effectLabel: 'excess orphan-refund share', expectedSource: 'Norm: about 2% of refunds lack a findable sale', records: ids(orph),
      observed: `${orph.length} of ${c.refunds.length} refunds have no original sale`, expected: 'Every refund links to a prior sale',
      explanation: 'Money leaving as refunds with nothing to refund.', metrics: { orphan: orph.length, value: inr(orph.reduce((s, r) => s + r.amount, 0)), p: t.p.toExponential(2) } };
  } },
  { id: 'D9', run: c => {
    const byId = new Map(c.sales.map(s => [s.id, s])), linked = c.refunds.filter(r => r.linkedSaleId && byId.has(r.linkedSaleId));
    if (!linked.length) return unknown('No refunds linked to sales.');
    const own = (r: PaymentEvent, s: PaymentEvent) => r.destHash === s.payerHash || (!!r.destHolderHash && r.destHolderHash === s.payerMobileHash);
    const bad = linked.filter(r => !own(r, byId.get(r.linkedSaleId!)!)), t = rateTest(bad.length, linked.length, 0.05, 50);
    const value = bad.reduce((s, r) => s + r.amount, 0);
    return { ...t, effect: value >= 5000 ? t.effect : Math.min(t.effect, 0), n: linked.length, effectLabel: 'excess share to other people (value ≥ ₹5,000)', expectedSource: 'Norm: about 5% of refunds go to another account of the same person', records: ids(bad),
      observed: `${bad.length} of ${linked.length} linked refunds paid to someone other than the payer (${inr(value)})`, expected: 'Refunds return to the payer or the payer\'s own account',
      explanation: 'Refunds routed to accounts that never paid. Refunds to the payer\'s own other account are not counted.', metrics: { other: bad.length, value: inr(value), p: t.p.toExponential(2) } };
  } },
  { id: 'D10', run: c => {
    if (!c.sc.orders.length) return unknown('No order records connected. Only an explicit "none found" row counts as missing an order.');
    const online = c.sales.filter(s => s.channel !== 'POS' && s.channel !== 'UPI_QR');
    if (!online.length) return unknown('Only POS / in-store QR walk-in sales in window; order matching applies to online/remote sales.');
    const n = online.length, un = online.filter(s => !s.orderId), p = binomSf(un.length, n, 0.05);
    return { p, effect: share(un.length, n) - 0.05, n, effectLabel: 'excess unmatched share', ci: ci90(un.length, n), expectedSource: 'Norm: ≤ 5% of online payments lack an order', records: ids(un),
      observed: `${pct(1 - share(un.length, n))} of online payments match an order`, expected: '≥ 95% match', explanation: 'Payments with no corresponding order in the merchant\'s order system.', metrics: { unmatched: un.length, p: p.toExponential(2) } };
  } },
  { id: 'D11', run: c => {
    const cbs = c.chargebacks ?? c.all.filter(e => e.type === 'CHARGEBACK');
    if (!cbs.length) return unknown('No chargeback records in the window.');
    const n = c.sales.length;
    if (!n) return unknown('No sales in the window.');
    const k = Math.min(cbs.length, n), rate = k / n, p = binomSf(k, n, 0.01);
    return { p, effect: rate - 0.01, n, effectLabel: 'excess chargeback rate above 1%', ci: ci90(k, n), expectedSource: 'Industry card/online norm: ≤ 1% chargeback rate', records: ids(cbs),
      observed: `${cbs.length} chargeback(s) across ${n} sales (${pct(rate, 1)})`, expected: '≤ 1% of sales disputed',
      explanation: 'High chargeback and dispute rates on cards, netbanking, or wallets indicate unauthorised, undelivered, or disguised transactions.', metrics: { chargebacks: cbs.length, rate: pct(rate, 1), p: p.toExponential(2) } };
  } },
  { id: 'E1', run: c => {
    const mine = c.sc.web.embeds.filter(e => e.merchantId === c.p.id && e.category !== 'own');
    if (!mine.length) return { p: null, effect: 0, n: 1, effectLabel: 'peers on shared host', observed: 'No third-party embeds', expected: 'Links on declared domains only', explanation: 'No payment link shared with other parties was found.', expectedSource: 'Crawler snapshot', force: 'BENIGN' };
    const peers = new Set(c.sc.web.embeds.filter(e => e.merchantId !== c.p.id && mine.some(m => m.host === e.host)).map(e => e.merchantId));
    if (!peers.size) return unknown('Third-party embed found but not shared with other merchants.');
    return { p: null, effect: peers.size, n: 1, effectLabel: 'other merchants on the same host', observed: `${peers.size} other merchant(s) have links on ${mine[0].host}`, expected: 'Links on declared domains only', force: 'ILLICIT',
      explanation: 'Unrelated merchants\' payment links on the same third-party page. A lead, not proof of common ownership.', expectedSource: 'Crawler snapshot', records: embedIds(mine), metrics: { peers: peers.size, host: mine[0].host } };
  } },
  { id: 'E3', run: c => {
    if (!c.cohort.length) return unknown('No cohort peers monitored for this merchant.');
    const b = c.cohort[0], P = new Set(c.sales.filter(hasPayer).map(e => e.payerHash)), Q = new Set(c.sc.events.filter(e => e.merchantId === b.peerId && e.type === 'SALE' && hasPayer(e)).map(e => e.payerHash));
    if (!P.size || !Q.size) return unknown('No identified payers to test cohort overlap.');
    const N = new Set(c.sc.events.filter(e => e.type === 'SALE' && hasPayer(e)).map(e => e.payerHash)).size, k = [...P].filter(x => Q.has(x)).length;
    const p = hypergeomSf(k, Math.max(N, P.size + Q.size - k), Q.size, P.size);
    const force = b.score < 0.4 ? 'BENIGN' as const : b.handoff ? undefined : 'UNKNOWN' as const;
    return { p, effect: b.score, n: P.size, effectLabel: 'continuity score', ci: null, expectedSource: 'Payers in this file (hypergeometric null)', force,
      observed: `Continuity ${b.score.toFixed(2)} with ${b.name}; ${k} shared payers${b.handoff ? `; started ${b.gapDays?.toFixed(1)} days after it went dormant` : ''}`, expected: 'Continuity below 0.40 with every peer',
      explanation: 'Payers, ticket shape and timing carry over from a dormant peer. A lead for review, not proof of common ownership.', metrics: { peer: b.name, sharedPayers: k, p: p.toExponential(2), handoff: b.handoff ? 'yes' : 'no' } };
  } },
  { id: 'F2', run: c => {
    const h = c.cohort.find(x => x.handoff);
    if (c.p.accountAgeDays < 45 && h) return { p: null, effect: 1, n: 1, effectLabel: 'hand-off', observed: `Account ${c.p.accountAgeDays} days old; started ${h.gapDays!.toFixed(1)} days after ${h.name} went dormant`, expected: 'Independent onboarding', force: 'ILLICIT', explanation: 'A new account opens as a similar one stops.', expectedSource: 'Peer lifecycle records', metrics: { ageDays: c.p.accountAgeDays } };
    if (c.p.accountAgeDays >= 365 && !h) return { p: null, effect: 0, n: 1, effectLabel: 'hand-off', observed: `Account ${c.p.accountAgeDays} days old, no hand-off`, expected: 'Independent onboarding', force: 'BENIGN', explanation: 'A long, continuous history is consistent with an ordinary business.', expectedSource: 'Peer lifecycle records' };
    return unknown('Recent account without a clear hand-off.');
  } },
  { id: 'F5', run: c => {
    const s = [...c.settlements].sort((a, b) => a.eventTime - b.eventTime);
    if (s.length < 3) return unknown('Too few settlements to judge.');
    let ch = 0; s.forEach((x, i) => { if (i && x.beneficiaryHash !== s[i - 1].beneficiaryHash) ch++; });
    const years = Math.max((s[s.length - 1].eventTime - s[0].eventTime) / (365 * 86400000), 30 / 365), lam = c.norm.beneficiaryChangesPerYear * years;
    const peerBen = new Set(c.sc.events.filter(e => e.merchantId !== c.p.id && e.type === 'SETTLEMENT').map(e => e.beneficiaryHash)), shared = s.some(x => peerBen.has(x.beneficiaryHash));
    const p = poissonSf(ch, lam);
    const force = shared ? 'ILLICIT' as const : ch === 0 ? 'BENIGN' as const : ch === 1 ? 'UNKNOWN' as const : undefined;
    return { p, effect: ch, n: s.length, effectLabel: 'beneficiary changes', ci: null, expectedSource: `${normSrc(c)}: ~${c.norm.beneficiaryChangesPerYear}/year`, force, records: ids(s),
      observed: `Beneficiary changed ${ch}× in ${s.length} settlements${shared ? '; a beneficiary also settles another merchant' : ''}`, expected: 'Stable settlement account; one change can be a normal bank switch',
      explanation: ch === 1 && !shared ? 'One change to a new account is common (bank switch) and is not counted.' : 'Settlement destinations moving, or shared with another merchant.', metrics: { changes: ch, sharedWithPeer: shared ? 'yes' : 'no', p: p.toExponential(2) } };
  } },
  { id: 'F7', run: c => {
    const od = c.sc.orders; if (!od.length) return unknown('No orders to test.');
    const cnt = new Map<string, number>(); od.forEach(o => o.trackingId && cnt.set(o.trackingId, (cnt.get(o.trackingId) ?? 0) + 1));
    const good = od.filter(o => o.status === 'DELIVERED' && !(o.trackingId && cnt.get(o.trackingId)! > 1)).length, p = binomCdf(good, od.length, 0.9);
    return { p, effect: 0.9 - share(good, od.length), n: od.length, effectLabel: 'shortfall below 90% delivered', ci: ci90(good, od.length), expectedSource: 'Norm: ≥ 90% of orders delivered with unique tracking',
      observed: `${pct(share(good, od.length))} of orders delivered with unique tracking`, expected: '≥ 90%', explanation: 'Few orders reach customers, or shipment records are reused.', metrics: { orders: od.length, deliveredUnique: good, p: p.toExponential(2) } };
  } },
  { id: 'F8', run: c => {
    if (!c.settlements.length) return unknown('No settlements.');
    if (!c.sc.bankCredits.length) return unknown('No bank credits to reconcile against.');
    const credits = new Map<string | undefined, number[]>();
    for (const b of c.sc.bankCredits) if (Number.isFinite(b.amount)) { const list = credits.get(b.beneficiaryHash); if (list) list.push(b.amount); else credits.set(b.beneficiaryHash, [b.amount]); }
    credits.forEach(list => list.sort((x, y) => x - y));
    const un = c.settlements.filter(s => !hasBetween(credits.get(s.beneficiaryHash) ?? [], s.amount - 1, s.amount + 1)), n = c.settlements.length, p = binomSf(un.length, n, 0.02);
    return { p, effect: share(un.length, n) - 0.02, n, effectLabel: 'excess unmatched share', ci: ci90(un.length, n), expectedSource: 'Norm: ≤ 2% of settlements missing from bank credits', records: ids(un),
      observed: `${pct(1 - share(un.length, n))} of settlements match a bank credit`, expected: '≥ 98% match', explanation: 'Settlements that do not reconcile with the bank\'s credits.', metrics: { unmatched: un.length, p: p.toExponential(2) } };
  } },
  { id: 'G2', run: c => {
    const cat = c.sc.web.catalogue; if (!cat.length) return unknown('No catalogue captured.');
    const off = cat.filter(i => !i.inCategory || i.dupImage).length, p = binomSf(off, cat.length, 0.05);
    return { p, effect: share(off, cat.length) - 0.05, n: cat.length, effectLabel: 'excess off-category / reused-image share', ci: ci90(off, cat.length), expectedSource: 'Norm: ≤ 5% of items off-category or reused',
      observed: `${off} of ${cat.length} catalogue items off-category or with reused images`, expected: '≤ 5%', explanation: 'The catalogue does not look like the declared category. Catalogues are cheap to fake, so calm results count little.', metrics: { offItems: off, p: p.toExponential(2) } };
  } },
  { id: 'G6', run: c => {
    const mine = c.sc.web.embeds.filter(e => e.merchantId === c.p.id); if (!mine.length) return unknown('No embeds captured for this merchant\'s links.');
    const normHost = (h: string) => h.trim().toLowerCase().replace(/^www\./, '');
    const declared = new Set(c.p.declaredDomains.map(normHost));
    const known = new Set(RULES.hosts.known.map(h => normHost(h.host))), ext = mine.filter(e => !declared.has(normHost(e.host))), bet = ext.filter(e => e.category === 'gambling' || known.has(normHost(e.host)));
    const place = (e: { host: string; path?: string; pageType?: string }) => `${e.host ?? ''}${e.path ?? ''}${e.pageType ? ` (${e.pageType})` : ''}`;
    if (bet.length) return { p: null, effect: 1.25, n: mine.length, effectLabel: 'betting-host embed', force: 'ILLICIT', observed: `Link ${bet[0].linkId} embedded on ${place(bet[0])}`, expected: 'Links only on declared domains', explanation: 'A merchant payment link on an undeclared betting deposit page.', expectedSource: 'Crawler snapshot + rules/hosts.json', records: embedIds(bet), metrics: { host: bet[0].host } };
    if (ext.length && ext.every(e => e.category === 'marketplace')) return unknown('The link is on a marketplace page. Ask the merchant to declare it.');
    if (ext.length) return { p: null, effect: 0.6, n: mine.length, effectLabel: 'undeclared embed', force: 'ILLICIT', observed: `Link ${ext[0].linkId} embedded on undeclared ${place(ext[0])}`, expected: 'Links only on declared domains', explanation: 'A payment link used on a page unrelated to the declared business.', expectedSource: 'Crawler snapshot', records: embedIds(ext) };
    return { p: null, effect: 0, n: mine.length, effectLabel: 'undeclared embed', force: 'BENIGN', observed: `All ${mine.length} embed(s) on declared domains`, expected: 'Links only on declared domains', explanation: 'Checkout provenance matches the declared website.', expectedSource: 'Crawler snapshot' };
  } },
  { id: 'H1', run: c => {
    const k = RULES.engine.volume.recentWeeks, zs = c.vol.z.slice(-k).filter((v): v is number => v !== null);
    if (c.rows.length < RULES.engine.volume.minWeeks || !zs.length) return unknown('Too little weekly history.');
    if (!c.vol.fitted) return unknown(c.vol.note);
    if (c.sc.weeklyReconciled === false) return unknown('Weekly totals do not reconcile with the ledger, so volume cannot be judged.');
    const Z = zs.reduce((s, v) => s + v, 0) / Math.sqrt(zs.length), p = normalSf(Z), recent = c.rows.slice(-k).filter(r => r.actual !== null);
    const ratio = recent.reduce((s, r) => s + r.actual! / r.seasonal, 0) / Math.max(recent.length, 1);
    return { p, effect: ratio, n: c.rows.length, effectLabel: 'actual ÷ expected (last 4 weeks)', ci: null, expectedSource: c.vol.note,
      observed: `Last ${recent.length} weeks at ${ratio.toFixed(2)}× the festival-adjusted expectation (z = ${Z.toFixed(1)})`, expected: 'About 1.0× expectation, festivals included',
      explanation: 'Growth beyond what the festival calendar explains for this kind of business. Volume alone is weak evidence.', metrics: { ratio: ratio.toFixed(2), z: Z.toFixed(2), p: p.toExponential(2), cv: c.vol.cv.toFixed(2) } };
  } },
  { id: 'H2', run: c => {
    const zs = c.vol.z.filter((v): v is number => v !== null);
    if (zs.length < 8) return unknown('Too little weekly history for change detection.');
    if (!c.vol.fitted || c.sc.weeklyReconciled === false) return unknown('No reliable weekly baseline to detect a change against.');
    const pc = bocpdRecentChange(zs), alarm = c.cusum.slice(-RULES.engine.volume.recentWeeks).some(x => x.alarm);
    const force = pc >= 0.7 && alarm ? 'ILLICIT' as const : pc < 0.2 && !alarm ? 'BENIGN' as const : 'UNKNOWN' as const;
    return { p: null, effect: pc, n: zs.length, effectLabel: 'P(change in last 4 weeks)', ci: null, expectedSource: 'Standardised volume residuals; CUSUM h set for one false alarm per merchant-year', force,
      observed: `P(recent change) = ${pct(pc)}; CUSUM ${alarm ? 'alarm' : 'no alarm'} in the last 4 weeks`, expected: 'No change beyond the festival-adjusted expectation',
      explanation: 'Detects a lasting shift in behaviour rather than a single busy week.', metrics: { pChange: pc.toFixed(2), cusumAlarm: alarm ? 'yes' : 'no' } };
  } },
  { id: 'H3', run: c => {
    const { fixDays, inWin } = matchWindows(c), local = c.norm.catchment === 'LOCAL' ? homeAndNeighbours(c.p) : null;
    const traitsOf = (e: PaymentEvent) => {
      const m = fastIstMin(e.eventTime);
      return [
        isRound(e.amount) && !c.covered(e, 'amount'),
        !!local && isRemote(e, local) && !c.covered(e, 'area'),
        !c.covered(e, 'hours') && (outsideHours(Math.floor(m / 60), [c.norm.open, c.norm.close]) || (fixDays.has(fastIstDay(e.eventTime)) && inWin(m))),
      ];
    };
    const rows = c.sales.map(traitsOf), n = rows.length, joint = c.sales.filter((_, i) => rows[i].filter(Boolean).length >= 2);
    // Expected co-occurrence if the three traits were independent: this test may not re-count the traits themselves.
    const [a, b, d] = [0, 1, 2].map(i => share(rows.filter(r => r[i]).length, n));
    const expected = Math.min(0.99, Math.max(0.01, a * b + a * d + b * d - 2 * a * b * d)), t = rateTest(joint.length, n, expected, 100);
    return { ...t, n, effectLabel: 'excess share with ≥ 2 off-profile traits', expectedSource: 'What each trait\'s own rate predicts if they were unrelated', records: ids(joint),
      observed: `${joint.length} sales (${pct(share(joint.length, n))}) combine ≥ 2 off-profile traits`, expected: `about ${pct(expected)} if unrelated`,
      explanation: 'Round amount, out-of-area payer and odd timing co-occurring in the same payments: a separate population hidden inside the merchant.', metrics: { joint: joint.length, value: inr(joint.reduce((s, e) => s + e.amount, 0)), p: t.p.toExponential(2) } };
  } },
  { id: 'I2', run: c => {
    if (!c.transfers.length) return unknown('No payout records. A PA usually cannot see what happens after settlement, so this is not evidence of innocence.');
    const b = new Set(c.transfers.map(t => t.beneficiaryHash)).size, p = poissonSf(b, c.norm.payoutBeneficiaries);
    return { p, effect: b / c.norm.payoutBeneficiaries, n: c.transfers.length, effectLabel: 'payout beneficiaries ÷ norm', ci: null, expectedSource: `${normSrc(c)}: ~${c.norm.payoutBeneficiaries} beneficiaries`, records: ids(c.transfers),
      observed: `${c.transfers.length} payouts to ${b} distinct beneficiaries`, expected: `about ${c.norm.payoutBeneficiaries}`, explanation: 'Funds fanning out to many third parties does not fit this category\'s cost structure.', metrics: { beneficiaries: b, value: inr(c.transfers.reduce((s, t) => s + t.amount, 0)), p: p.toExponential(2) } };
  } },
  { id: 'I3', run: c => {
    if (c.settlements.length < 3) return unknown('Too few settlements.');
    if (!c.transfers.length) return unknown('No payout records, so sweeping cannot be seen either way.');
    const W = RULES.engine.sweepHours * 3600000, paidOut = c.transfers.map(t => t.eventTime).sort((x, y) => x - y);
    const swept = c.settlements.filter(s => hasBetween(paidOut, s.eventTime, s.eventTime + W)), n = c.settlements.length, p = binomSf(swept.length, n, 0.1);
    return { p, effect: share(swept.length, n) - 0.1, n, effectLabel: 'excess share swept within 24 h', ci: ci90(swept.length, n), expectedSource: 'Norm: ≤ 10% of settlements followed by an onward payout within 24 h', records: ids(swept),
      observed: `${swept.length} of ${n} settlements followed by an onward payout within ${RULES.engine.sweepHours} h`, expected: 'About 10%', explanation: 'Money passing straight through the merchant account.', metrics: { swept: swept.length, p: p.toExponential(2) } };
  } },
  { id: 'K1', run: c => {
    const n = c.norm, p = c.p, gaps: [string, number][] = [];
    const declared = (k: NonNullable<MerchantProfile['undeclared']>[number]) => !p.undeclared?.includes(k);
    if ((['catchment', 'hours', 'ticketMax', 'expectedRoundShare'] as const).every(k => !declared(k))) return unknown('The merchant record declares no profile to compare.');
    if (declared('catchment') && p.catchment === 'NATIONAL' && n.catchment === 'LOCAL') gaps.push(['declares national catchment', 3]);
    const w = (h: number[]) => ((h[1] - h[0]) + 24) % 24 || 24, dw = (w(p.hours) - w([n.open, n.close])) / 3;
    if (declared('hours') && dw > 0) gaps.push([`declares ${w(p.hours)} trading hours vs ${w([n.open, n.close])}`, dw]);
    const p95 = n.ticket.median * Math.exp(1.645 * n.ticket.sigma), dt = Math.log(p.ticketMax / p95) / 0.5;
    if (declared('ticketMax') && dt > 0) gaps.push([`declares tickets up to ${inr(p.ticketMax)} vs ~${inr(p95)}`, dt]);
    const dr = ((p.expectedRoundShare ?? n.roundShare) - n.roundShare) / 0.05;
    if (declared('expectedRoundShare') && dr > 0) gaps.push([`declares ${pct(p.expectedRoundShare)} round amounts vs ${pct(n.roundShare)}`, dr]);
    const chi = gaps.reduce((s, [, g]) => s + g * g, 0), pv = chi2Sf(chi, 4), d = Math.sqrt(chi);
    return { p: pv, effect: d, n: 1, effectLabel: 'standardised distance from the norm', ci: null, expectedSource: normSrc(c), force: d === 0 ? 'BENIGN' : undefined,
      observed: gaps.length ? gaps.map(g => g[0]).join('; ') : 'Declared profile matches the category norm', expected: 'Declared profile close to the category norm',
      explanation: 'A merchant that declares an unusually wide profile switches off ordinary checks. The width of the declaration is itself a signal.', metrics: { distance: d.toFixed(2), p: pv.toExponential(2) } };
  } },
  { id: 'K2', run: c => {
    const decl = c.p.declaredChannels ?? [];
    if (!decl.length) return unknown('No payment channels declared on the merchant record.');
    const allowed = new Set<string>();
    for (const raw of decl) {
      const s = raw.toLowerCase();
      if (s.includes('pos') || s.includes('in-store') || s.includes('in store') || s.includes('pickup') || s.includes('retail')) { allowed.add('POS'); allowed.add('UPI_QR'); allowed.add('CARD'); }
      if (s.includes('qr') || s.includes('upi')) { allowed.add('UPI_QR'); allowed.add('UPI_LINK'); allowed.add('UPI_COLLECT'); }
      if (s.includes('deliver') || s.includes('link') || s.includes('whatsapp')) { allowed.add('UPI_LINK'); allowed.add('UPI_COLLECT'); allowed.add('UPI_QR'); allowed.add('ONLINE'); }
      if (s.includes('online') || s.includes('website') || s.includes('web') || s.includes('e-commerce') || s.includes('ecommerce') || s.includes('app')) {
        allowed.add('ONLINE'); allowed.add('CARD'); allowed.add('NETBANKING'); allowed.add('WALLET'); allowed.add('BNPL'); allowed.add('UPI_LINK'); allowed.add('UPI_COLLECT');
      }
      if (s.includes('card')) allowed.add('CARD');
      if (s.includes('netbanking') || s.includes('net banking')) allowed.add('NETBANKING');
      if (s.includes('wallet')) allowed.add('WALLET');
      if (s.includes('bnpl') || s.includes('emi') || s.includes('pay later')) allowed.add('BNPL');
    }
    if (!allowed.size) return unknown('Declared channels could not be mapped to canonical payment rails.');
    const n = c.sales.length;
    if (!n) return unknown('No sales in the window.');
    const un = c.sales.filter(e => !allowed.has(e.channel));
    const p = binomSf(un.length, n, 0.1);
    const rails = [...new Set(un.map(e => e.channel))].join(', ');
    return { p, effect: share(un.length, n) - 0.1, n, effectLabel: 'excess share on undeclared payment rails', ci: ci90(un.length, n), expectedSource: `Declared channels: ${decl.join(', ')}`, records: ids(un),
      observed: un.length ? `${pct(share(un.length, n))} of sales via undeclared rail(s) (${rails})` : 'All sales match declared payment channels', expected: '≤ 10% outside declared payment channels',
      explanation: 'Collections arriving on payment rails (e.g. online cards, netbanking, wallets, or remote links) that the merchant never declared during onboarding.', metrics: { undeclaredSales: un.length, rails: rails || 'none', p: p.toExponential(2) } };
  } },
];

export function runDetectors(c: Ctx): EvidenceItem[] {
  const known = RULES.knowsCategory(c.p.mcc);
  const items = DETECTORS.map((d): EvidenceItem => {
    const baseCfg = RULES.detector(d.id), learned = c.learnedRates?.get(d.id);
    const cfg = learned ? { ...baseCfg, sensitivity: learned.sensitivity, falsePositive: learned.falsePositive } : baseCfg;
    const req = cfg.requires as CoverageKey[];
    const miss = req.filter(k => c.sc.coverage[k] === 'MISSING'), part = req.some(k => c.sc.coverage[k] === 'PARTIAL');
    const o: Obs = miss.length
      ? { ...unknown(`Required source (${miss.join(', ')}) is missing. Missing data is UNKNOWN: it does not move the score either way.`), observed: 'Source not available' }
      : cfg.level === 'merchant' && c.scope !== 'account' ? unknown('Measured on the whole account, not on a single payment stream.')
      : cfg.categoryNorm && !known ? unknown(`MCC ${c.p.mcc} has no category norm. The engine abstains instead of guessing what is normal.`)
      : d.run(c);
    const j = judge(cfg, o);
    let llr = part ? j.llr * 0.7 : j.llr;
    // Looking normal for a category the merchant chose for itself earns little credit.
    if (j.status === 'BENIGN' && cfg.categoryNorm) llr *= RULES.engine.declaredCalmWeight;
    const fire = Math.log(cfg.sensitivity / cfg.falsePositive);
    return {
      id: d.id, name: cfg.name, family: cfg.family as Family, status: j.status, strength: Math.min(1, Math.abs(llr) / fire),
      reliability: part ? 0.7 : 1, fakeDifficulty: cfg.fakeDifficulty, lineage: cfg.lineage, system: cfg.provenance, requires: req,
      affinity: { ROTATION: cfg.affinity[0], TRANSACTION_LAUNDERING: cfg.affinity[1], FABRICATED_SUBSTANCE: cfg.affinity[2], OTHER_ABUSE: cfg.affinity[3] } as Record<Mechanism, number>,
      observed: o.observed, expected: o.expected, explanation: o.explanation, metrics: o.metrics ?? {}, records: (o.records ?? []).slice(0, 40),
      llr, signal: cfg.class, derived: !!cfg.derivedFrom,
      provenance: cfg.provenance as Provenance, test: cfg.test, p: o.p, effect: o.effect, effectLabel: o.effectLabel, ci: o.ci ?? null, n: o.n, expectedSource: o.expectedSource,
    };
  });
  // A signal built from other signals keeps only its within-family share when those already fired.
  for (const e of items) {
    // A local crowd before a match is custom. Distant money timed to matches is conduct.
    if (e.status === 'ILLICIT' && RULES.detector(e.id).conductWith?.some(id => items.some(x => x.id === id && x.status === 'ILLICIT'))) e.signal = 'conduct';
    const parents = RULES.detector(e.id).derivedFrom;
    if (e.llr > 0 && parents?.some(id => items.some(x => x.id === id && x.status === 'ILLICIT'))) e.llr *= RULES.engine.familyRho;
  }
  return items;
}
