/**
 * L3 detector library (v2). Each detector runs a statistical test of the merchant against its CATEGORY NORM
 * (rules/mcc.json, later portfolio peers), the festival/match calendar or an independent source, and returns
 * p-value, effect size and n. `judge` turns that into an evidence weight (LLR). The merchant's self-declared profile
 * is never used as the baseline; it is only compared with the norm (K1).
 */
import type { MerchantProfile, Scenario, CoverageKey } from '../types/merchant';
import type { PaymentEvent } from '../types/payment';
import type { EvidenceItem, Family, Mechanism, Provenance } from '../types/evidence';
import type { CohortMatch, CusumPoint, WeeklyRow } from '../types/investigation';
import { istMinuteOfDay, istDayKey, istHour, pct, inr } from '../utils/format';
import { RULES, type MccNorm } from '../../../rules/index';
import { judge, type Obs } from './judge';
import type { VolumeModel } from './residualEngine';
import { betaBinomUpperP, priorFromRate } from '../stats/eb';
import { binomSf, binomCdf, chi2Sf, hypergeomSf, lognormalCdf, normalSf, poissonSf } from '../stats/dist';
import { ksOneSample } from '../stats/tests';
import { wilson } from '../stats/intervals';
import { bocpdRecentChange } from '../stats/changepoint';
import { rng, seedOf, shuffle } from '../stats/rng';

export interface Ctx {
  sc: Scenario; p: MerchantProfile; norm: MccNorm; all: PaymentEvent[];
  sales: PaymentEvent[]; refunds: PaymentEvent[]; settlements: PaymentEvent[]; transfers: PaymentEvent[];
  rows: WeeklyRow[]; cusum: CusumPoint[]; cohort: CohortMatch[]; vol: VolumeModel;
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
const homeAndNeighbours = (p: MerchantProfile) => { const home = p.localStates[0]; return home ? new Set([home, ...RULES.neighbours(home)]) : null; };
const normSrc = (c: Ctx) => `Category norm for MCC ${c.p.mcc} (${c.norm.name}), rules/mcc.json`;

/** Rate test against the category norm with empirical-Bayes beta-binomial (prior strength 200 merchant-sales). */
function rateTest(x: number, n: number, normRate: number, strength = 200) {
  const pr = priorFromRate(normRate, strength);
  return { p: n ? betaBinomUpperP(x, n, pr) : 1, effect: share(x, n) - normRate, ci: ci90(x, n) };
}

const PRE = RULES.engine.preMatchMinutes;
function matchWindows(c: Ctx) {
  const fx = [...c.sc.fixtures, ...RULES.calendar.cricketFixtures.map(f => Date.parse(String(f)))].filter(Number.isFinite);
  const fixDays = new Set(fx.map(f => istDayKey(istMinuteOfDay(f) < PRE ? f - PRE * 60_000 : f)));
  const wins = [...new Set(fx.map(istMinuteOfDay))].map(m => [m - PRE, m] as const);
  const inWin = (m: number) => wins.some(([a, b]) => (a >= 0 ? m >= a && m < b : m >= a + 1440 || m < b));
  return { fx, fixDays, inWin };
}

export const DETECTORS: Def[] = [
  { id: 'A1', run: c => {
    const amounts = c.sales.map(s => s.amount), n = amounts.length;
    const t = ksOneSample(amounts, x => lognormalCdf(x, c.norm.ticket.median, c.norm.ticket.sigma));
    const sorted = [...amounts].sort((a, b) => a - b), med = sorted[Math.floor(n / 2)] ?? 0;
    const counts = new Map<number, number>();
    for (const a of amounts) counts.set(a, (counts.get(a) ?? 0) + 1);
    const maxTie = counts.size ? Math.max(...counts.values()) / Math.max(n, 1) : 0;
    const discreteMenu = n >= 20 && counts.size <= 15 && maxTie >= 0.08 && med >= c.norm.ticket.median * 0.2 && med <= c.norm.ticket.median * 3;
    return { p: discreteMenu ? 1 : t.p, effect: discreteMenu ? 0 : t.statistic, n, effectLabel: 'KS distance D', ci: null, expectedSource: normSrc(c),
      observed: `Median ticket ${inr(med)}; distribution distance D = ${t.statistic.toFixed(2)}`, expected: `Median about ${inr(c.norm.ticket.median)}, spread like the category`,
      explanation: discreteMenu ? 'Discrete menu pricing within normal category ticket bounds.' : 'Compares the whole ticket-size distribution with what this kind of business normally takes.',
      metrics: { D: t.statistic.toFixed(3), p: t.p.toExponential(2), median: inr(med) } };
  } },
  { id: 'A4', run: c => {
    const r = c.sales.filter(e => isRound(e.amount)), n = c.sales.length, t = rateTest(r.length, n, c.norm.roundShare);
    return { ...t, n, effectLabel: 'excess share at ₹500 multiples', expectedSource: normSrc(c), records: ids(r),
      observed: `${pct(share(r.length, n))} of tickets at round ₹500 multiples (${r.length} of ${n})`, expected: `about ${pct(c.norm.roundShare)}`,
      explanation: 'Real baskets rarely land on round values. Heaping suggests amounts chosen by a payer, not built from products.', metrics: { round: r.length, share: pct(share(r.length, n), 1), p: t.p.toExponential(2) } };
  } },
  { id: 'A5', run: c => {
    const tiers = new Set(RULES.amounts.bonusTiers), catalogue = new Set(c.sc.web.catalogue.map(i => Math.round(i.price)));
    const offlineNoCat = c.sc.coverage.website === 'MISSING' && c.sc.web.catalogue.length === 0;
    const hit = c.sales.filter(e => tiers.has(e.amount) && !catalogue.has(e.amount) && !(offlineNoCat && e.amount % 100 === 99)), n = c.sales.length, t = rateTest(hit.length, n, c.norm.bonusShare);
    return { ...t, n, effectLabel: 'excess share at deposit/bonus-tier amounts', expectedSource: `${normSrc(c)}; tiers in rules/amounts.json`, records: ids(hit),
      observed: `${pct(share(hit.length, n))} of tickets at deposit-tier amounts not in the catalogue`, expected: `about ${pct(c.norm.bonusShare)}`,
      explanation: 'Amounts like ₹199, ₹999, ₹1,999 that are not catalogue prices match betting deposit tiers.', metrics: { tier: hit.length, p: t.p.toExponential(2) } };
  } },
  { id: 'B6', run: c => {
    if (c.norm.catchment === 'NATIONAL') return unknown('This category sells nationally, so payer geography is not informative.', 'National catchment', normSrc(c));
    const local = homeAndNeighbours(c.p);
    if (!local) return unknown('No home state on the merchant record.');
    const known = c.sales.filter(e => e.payerState && e.payerState !== '—'), off = known.filter(e => !local.has(e.payerState)), t = rateTest(off.length, known.length, c.norm.offAreaShare);
    return { ...t, n: known.length, effectLabel: 'excess out-of-area share', expectedSource: `${normSrc(c)}; neighbouring states count as local (rules/states.json)`, records: ids(off),
      observed: `${pct(share(off.length, known.length))} of payers from outside ${[...local].slice(0, 1)} and its neighbours (${new Set(off.map(e => e.payerState)).size} states)`,
      expected: `about ${pct(c.norm.offAreaShare)}`, explanation: 'A neighbourhood business receiving many payments from far away is off-profile.',
      metrics: { outOfArea: off.length, states: new Set(off.map(e => e.payerState)).size, p: t.p.toExponential(2) } };
  } },
  { id: 'B7', run: c => {
    const known = c.sales.filter(e => e.payerHash && e.payerHash !== '—');
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
  { id: 'B9', run: c => {
    const v = c.sc.verification; if (!v || !v.contacted) return unknown('No purchaser verification sample.');
    const p = binomCdf(v.confirmed, v.contacted, 0.8), rate = v.confirmed / v.contacted;
    return { p, effect: 0.8 - rate, n: v.contacted, effectLabel: 'shortfall below 80% confirmation', ci: ci90(v.confirmed, v.contacted), expectedSource: 'Genuine merchants: ≥ 80% of sampled purchasers confirm',
      observed: `${v.confirmed} of ${v.contacted} sampled purchasers confirm buying`, expected: '≥ 80% confirm', force: rate >= 0.8 ? 'BENIGN' : undefined,
      explanation: 'Independently contacted payers either recognise their purchase or they do not. This is hard to fake.', metrics: { contacted: v.contacted, confirmed: v.confirmed, p: p.toExponential(2) } };
  } },
  { id: 'C2', run: c => {
    const off = c.sales.filter(e => outsideHours(istHour(e.eventTime), [c.norm.open, c.norm.close])), n = c.sales.length, t = rateTest(off.length, n, c.norm.offHoursShare);
    return { ...t, n, effectLabel: 'excess off-hours share', expectedSource: `${normSrc(c)} (${c.norm.open}:00–${c.norm.close}:00)`, records: ids(off),
      observed: `${pct(share(off.length, n))} of sales outside ${c.norm.open}:00–${c.norm.close}:00`, expected: `about ${pct(c.norm.offHoursShare)}`,
      explanation: 'Collections arriving when this kind of business is normally closed.', metrics: { offHours: off.length, p: t.p.toExponential(2) } };
  } },
  { id: 'C5', run: c => {
    const { fx, fixDays, inWin } = matchWindows(c);
    if (!fx.length) return unknown('No match fixtures in the window, so alignment cannot be tested.', '—', 'Uploaded fixtures + rules/calendar.json');
    const days = new Map<string, { inW: number; tot: number }>();
    c.sales.forEach(e => { const k = istDayKey(e.eventTime), d = days.get(k) ?? { inW: 0, tot: 0 }; d.tot++; if (inWin(istMinuteOfDay(e.eventTime))) d.inW++; days.set(k, d); });
    const keys = [...days.keys()], isFix = keys.map(k => fixDays.has(k)), k = isFix.filter(Boolean).length;
    if (!k || k === keys.length) return unknown('Fixtures fall on all or none of the trading days, so there is no comparison.');
    const rate = (sel: boolean[]) => { let a = 0, b = 0; keys.forEach((key, i) => { if (sel[i]) { a += days.get(key)!.inW; b += days.get(key)!.tot; } }); return b ? a / b : 0; };
    const obs = rate(isFix), ctrl = rate(isFix.map(x => !x)), r = rng(seedOf(c.p.id + 'C5'));
    let ge = 0; const B = RULES.engine.permutationDraws;
    for (let i = 0; i < B; i++) if (rate(shuffle(r, isFix)) >= obs - 1e-12) ge++;
    const p = (ge + 1) / (B + 1), ratio = obs / Math.max(ctrl, 0.5 / Math.max(c.sales.length, 1)), n = keys.filter((_, i) => isFix[i]).reduce((s, key) => s + days.get(key)!.tot, 0);
    const hit = c.sales.filter(e => fixDays.has(istDayKey(e.eventTime)) && inWin(istMinuteOfDay(e.eventTime)));
    return { p, effect: ratio, n, effectLabel: 'rate ratio vs non-match days', ci: null, expectedSource: 'Same clock windows on non-match days (permutation over days)', records: ids(hit),
      observed: `${pct(obs)} of match-day sales in the ${PRE} min before a start vs ${pct(ctrl)} on other days (${ratio.toFixed(1)}×)`, expected: 'No difference from other days',
      explanation: 'Funding that clusters just before match starts, compared with the same clock time on days without matches.', metrics: { ratio: ratio.toFixed(2), p: p.toFixed(4), matchDays: k } };
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
    const online = c.sales.filter(s => s.channel !== 'POS');
    if (!online.length) return unknown('Only POS walk-in sales in window; order matching applies to online/link sales.');
    const n = online.length, un = online.filter(s => !s.orderId), p = binomSf(un.length, n, 0.05);
    return { p, effect: share(un.length, n) - 0.05, n, effectLabel: 'excess unmatched share', ci: ci90(un.length, n), expectedSource: 'Norm: ≤ 5% of online payments lack an order', records: ids(un),
      observed: `${pct(1 - share(un.length, n))} of online payments match an order`, expected: '≥ 95% match', explanation: 'Payments with no corresponding order in the merchant\'s order system.', metrics: { unmatched: un.length, p: p.toExponential(2) } };
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
    const b = c.cohort[0], P = new Set(c.sales.map(e => e.payerHash)), Q = new Set(c.sc.events.filter(e => e.merchantId === b.peerId && e.type === 'SALE').map(e => e.payerHash));
    const N = new Set(c.sc.events.filter(e => e.type === 'SALE').map(e => e.payerHash)).size, k = [...P].filter(x => Q.has(x)).length;
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
    const bc = c.sc.bankCredits, un = c.settlements.filter(s => !bc.some(b => Math.abs(b.amount - s.amount) <= 1 && b.beneficiaryHash === s.beneficiaryHash)), n = c.settlements.length, p = binomSf(un.length, n, 0.02);
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
    if (ext.length) return { p: null, effect: 0.6, n: mine.length, effectLabel: 'undeclared embed', force: 'ILLICIT', observed: `Link ${ext[0].linkId} embedded on undeclared ${place(ext[0])}`, expected: 'Links only on declared domains', explanation: 'A payment link used on a page unrelated to the declared business.', expectedSource: 'Crawler snapshot', records: embedIds(ext) };
    return { p: null, effect: 0, n: mine.length, effectLabel: 'undeclared embed', force: 'BENIGN', observed: `All ${mine.length} embed(s) on declared domains`, expected: 'Links only on declared domains', explanation: 'Checkout provenance matches the declared website.', expectedSource: 'Crawler snapshot' };
  } },
  { id: 'H1', run: c => {
    const k = RULES.engine.volume.recentWeeks, zs = c.vol.z.slice(-k).filter((v): v is number => v !== null);
    if (c.rows.length < RULES.engine.volume.minWeeks || !zs.length) return unknown('Too little weekly history.');
    const Z = zs.reduce((s, v) => s + v, 0) / Math.sqrt(zs.length), p = normalSf(Z), recent = c.rows.slice(-k).filter(r => r.actual !== null);
    const ratio = recent.reduce((s, r) => s + r.actual! / r.seasonal, 0) / Math.max(recent.length, 1);
    return { p, effect: ratio, n: c.rows.length, effectLabel: 'actual ÷ expected (last 4 weeks)', ci: null, expectedSource: c.vol.note,
      observed: `Last ${recent.length} weeks at ${ratio.toFixed(2)}× the festival-adjusted expectation (z = ${Z.toFixed(1)})`, expected: 'About 1.0× expectation, festivals included',
      explanation: 'Growth beyond what the festival calendar explains for this kind of business. Volume alone is weak evidence.', metrics: { ratio: ratio.toFixed(2), z: Z.toFixed(2), p: p.toExponential(2), cv: c.vol.cv.toFixed(2) } };
  } },
  { id: 'H2', run: c => {
    const zs = c.vol.z.filter((v): v is number => v !== null);
    if (zs.length < 8) return unknown('Too little weekly history for change detection.');
    const pc = bocpdRecentChange(zs), alarm = c.cusum.slice(-RULES.engine.volume.recentWeeks).some(x => x.alarm);
    const force = pc >= 0.7 && alarm ? 'ILLICIT' as const : pc < 0.2 && !alarm ? 'BENIGN' as const : 'UNKNOWN' as const;
    return { p: null, effect: pc, n: zs.length, effectLabel: 'P(change in last 4 weeks)', ci: null, expectedSource: 'Standardised volume residuals; CUSUM h set for one false alarm per merchant-year', force,
      observed: `P(recent change) = ${pct(pc)}; CUSUM ${alarm ? 'alarm' : 'no alarm'} in the last 4 weeks`, expected: 'No change beyond the festival-adjusted expectation',
      explanation: 'Detects a lasting shift in behaviour rather than a single busy week.', metrics: { pChange: pc.toFixed(2), cusumAlarm: alarm ? 'yes' : 'no' } };
  } },
  { id: 'H3', run: c => {
    const { fixDays, inWin } = matchWindows(c), local = c.norm.catchment === 'LOCAL' ? homeAndNeighbours(c.p) : null;
    const traits = (e: PaymentEvent) => [isRound(e.amount), local ? !!e.payerState && e.payerState !== '—' && !local.has(e.payerState) : false,
      outsideHours(istHour(e.eventTime), [c.norm.open, c.norm.close]) || (fixDays.has(istDayKey(e.eventTime)) && inWin(istMinuteOfDay(e.eventTime)))].filter(Boolean).length;
    const joint = c.sales.filter(e => traits(e) >= 2), n = c.sales.length, t = rateTest(joint.length, n, 0.01, 100);
    return { ...t, n, effectLabel: 'excess share with ≥ 2 off-profile traits', expectedSource: 'Norm: about 1% of sales combine two off-profile traits', records: ids(joint),
      observed: `${joint.length} sales (${pct(share(joint.length, n))}) combine ≥ 2 off-profile traits`, expected: 'About 1%',
      explanation: 'Round amount, out-of-area payer and odd timing co-occurring in the same payments: a separate population hidden inside the merchant.', metrics: { joint: joint.length, value: inr(joint.reduce((s, e) => s + e.amount, 0)), p: t.p.toExponential(2) } };
  } },
  { id: 'I2', run: c => {
    if (!c.transfers.length) return { p: null, effect: 0, n: 1, effectLabel: 'payout beneficiaries ÷ norm', observed: 'No onward payouts', expected: 'Few third-party payouts', explanation: 'No onward payouts to third parties.', expectedSource: normSrc(c), force: 'BENIGN' };
    const b = new Set(c.transfers.map(t => t.beneficiaryHash)).size, p = poissonSf(b, c.norm.payoutBeneficiaries);
    return { p, effect: b / c.norm.payoutBeneficiaries, n: c.transfers.length, effectLabel: 'payout beneficiaries ÷ norm', ci: null, expectedSource: `${normSrc(c)}: ~${c.norm.payoutBeneficiaries} beneficiaries`, records: ids(c.transfers),
      observed: `${c.transfers.length} payouts to ${b} distinct beneficiaries`, expected: `about ${c.norm.payoutBeneficiaries}`, explanation: 'Funds fanning out to many third parties does not fit this category\'s cost structure.', metrics: { beneficiaries: b, value: inr(c.transfers.reduce((s, t) => s + t.amount, 0)), p: p.toExponential(2) } };
  } },
  { id: 'I3', run: c => {
    if (c.settlements.length < 3) return unknown('Too few settlements.');
    const W = RULES.engine.sweepHours * 3600000, swept = c.settlements.filter(s => c.transfers.some(t => t.eventTime >= s.eventTime && t.eventTime - s.eventTime <= W)), n = c.settlements.length, p = binomSf(swept.length, n, 0.1);
    return { p, effect: share(swept.length, n) - 0.1, n, effectLabel: 'excess share swept within 24 h', ci: ci90(swept.length, n), expectedSource: 'Norm: ≤ 10% of settlements followed by an onward payout within 24 h', records: ids(swept),
      observed: `${swept.length} of ${n} settlements followed by an onward payout within ${RULES.engine.sweepHours} h`, expected: 'About 10%', explanation: 'Money passing straight through the merchant account.', metrics: { swept: swept.length, p: p.toExponential(2) } };
  } },
  { id: 'K1', run: c => {
    const n = c.norm, p = c.p, gaps: [string, number][] = [];
    if (p.catchment === 'NATIONAL' && n.catchment === 'LOCAL') gaps.push(['declares national catchment', 3]);
    const w = (h: number[]) => ((h[1] - h[0]) + 24) % 24 || 24, dw = (w(p.hours) - w([n.open, n.close])) / 3;
    if (dw > 0) gaps.push([`declares ${w(p.hours)} trading hours vs ${w([n.open, n.close])}`, dw]);
    const p95 = n.ticket.median * Math.exp(1.645 * n.ticket.sigma), dt = Math.log(p.ticketMax / p95) / 0.5;
    if (dt > 0) gaps.push([`declares tickets up to ${inr(p.ticketMax)} vs ~${inr(p95)}`, dt]);
    const dr = ((p.expectedRoundShare ?? n.roundShare) - n.roundShare) / 0.05;
    if (dr > 0) gaps.push([`declares ${pct(p.expectedRoundShare)} round amounts vs ${pct(n.roundShare)}`, dr]);
    const chi = gaps.reduce((s, [, g]) => s + g * g, 0), pv = chi2Sf(chi, 4), d = Math.sqrt(chi);
    return { p: pv, effect: d, n: 1, effectLabel: 'standardised distance from the norm', ci: null, expectedSource: normSrc(c), force: d === 0 ? 'BENIGN' : undefined,
      observed: gaps.length ? gaps.map(g => g[0]).join('; ') : 'Declared profile matches the category norm', expected: 'Declared profile close to the category norm',
      explanation: 'A merchant that declares an unusually wide profile switches off ordinary checks. The width of the declaration is itself a signal.', metrics: { distance: d.toFixed(2), p: pv.toExponential(2) } };
  } },
];

export function runDetectors(c: Ctx): EvidenceItem[] {
  return DETECTORS.map(d => {
    const cfg = RULES.detector(d.id), req = cfg.requires as CoverageKey[];
    const miss = req.filter(k => c.sc.coverage[k] === 'MISSING'), part = req.some(k => c.sc.coverage[k] === 'PARTIAL');
    const o: Obs = miss.length
      ? { ...unknown(`Required source (${miss.join(', ')}) is missing. Missing data is UNKNOWN: it does not move the score either way.`), observed: 'Source not available' }
      : d.run(c);
    const j = judge(cfg, o), llr = part ? j.llr * 0.7 : j.llr, fire = Math.log(cfg.sensitivity / cfg.falsePositive);
    return {
      id: d.id, name: cfg.name, family: cfg.family as Family, status: j.status, strength: Math.min(1, Math.abs(llr) / fire),
      reliability: part ? 0.7 : 1, fakeDifficulty: cfg.fakeDifficulty, lineage: cfg.lineage, system: cfg.provenance, requires: req,
      affinity: { ROTATION: cfg.affinity[0], TRANSACTION_LAUNDERING: cfg.affinity[1], FABRICATED_SUBSTANCE: cfg.affinity[2], OTHER_ABUSE: cfg.affinity[3] } as Record<Mechanism, number>,
      observed: o.observed, expected: o.expected, explanation: o.explanation, metrics: o.metrics ?? {}, records: (o.records ?? []).slice(0, 40),
      llr, provenance: cfg.provenance as Provenance, test: cfg.test, p: o.p, effect: o.effect, effectLabel: o.effectLabel, ci: o.ci ?? null, n: o.n, expectedSource: o.expectedSource,
    };
  });
}
