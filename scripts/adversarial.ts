/**
 * Adversarial harness: take a known sample, mutate it the way a real fraudster / messy feed would,
 * and check whether the decision flips. Run: npx tsx audit/adversarial.ts
 * Each case: name, base sample, mutate(dataset), and the decision a robust engine SHOULD give.
 */
import { readFileSync } from 'node:fs';
import { analyzeDataset } from '../backend/src/algorithms/analyze';

type D = any;
const load = (f: string): D => JSON.parse(readFileSync(`frontend/public/samples/${f}`, 'utf8'));
const BET = '01-sweet-crumbs-betting-front.json', ROT = '02-merchant-rotation.json', FAB = '03-fabricated-online-store.json';
const DIWALI = '04-anand-sweets-diwali-genuine.json', CHAI = '05-chai-corner-night-betting.json', GOOD = '06-shree-ganesh-sweets-genuine.json';
const own = (d: D, type?: string) => d.transactions.filter((t: D) => t.merchantId === d.merchant.id && (!type || t.type === type));

interface Case { name: string; base: string; should: 'OPEN_CASE' | 'NO_CASE' | 'REJECT' | 'NO_CRASH'; mutate: (d: D) => void; known?: string }
const CASES: Case[] = [
  { name: 'baseline: betting front unchanged', base: BET, should: 'OPEN_CASE', mutate: () => {} },
  { name: 'baseline: genuine sweets unchanged', base: GOOD, should: 'NO_CASE', mutate: () => {} },
  // Evasion 1: fraudster declares a profile wide enough to swallow its own anomalies.
  { name: 'evasion: betting front declares NATIONAL catchment, 0-24h, ticket 1-100000', base: BET, should: 'OPEN_CASE',
    mutate: d => { Object.assign(d.merchant, { catchment: 'NATIONAL', hours: [0, 24], ticketMin: 1, ticketMax: 100000, expectedRoundShare: 0.5 }); } },
  // Evasion 2: inflate seasonalMultiplier so the volume residual vanishes.
  { name: 'evasion: betting front sets seasonalMultiplier = actual/baseline', base: BET, should: 'OPEN_CASE',
    mutate: d => { d.weeklySales.forEach((w: D) => { if (w.actual != null) w.seasonalMultiplier = w.actual / d.merchant.baselineWeekly; }); } },
  // Robustness: zero-amount / malformed edge cases must not crash or yield NaN.
  { name: 'robustness: purchaserVerification contacted=0', base: GOOD, should: 'NO_CRASH',
    mutate: d => { d.purchaserVerification = { contacted: 0, confirmed: 0 }; d.dataAvailability = { ...d.dataAvailability, verification: 'AVAILABLE' }; } },
  { name: 'quiet launderer: betting front with refunds, transfers removed', base: BET, should: 'OPEN_CASE',
    mutate: d => { d.transactions = d.transactions.filter((t: D) => !(t.merchantId === d.merchant.id && (t.type === 'REFUND' || t.type === 'TRANSFER'))); } },
  { name: 'quiet launderer: + single stable beneficiary', base: BET, should: 'OPEN_CASE',
    mutate: d => { d.transactions = d.transactions.filter((t: D) => !(t.merchantId === d.merchant.id && (t.type === 'REFUND' || t.type === 'TRANSFER'))); own(d, 'SETTLEMENT').forEach((t: D) => { t.beneficiaryAccount = 'BEN-STABLE'; }); } },
  { name: 'quiet launderer: + website feed missing', base: BET, should: 'OPEN_CASE',
    known: 'fixed in S2 (Bayesian fusion + provenance gate)', mutate: d => { d.transactions = d.transactions.filter((t: D) => !(t.merchantId === d.merchant.id && (t.type === 'REFUND' || t.type === 'TRANSFER'))); own(d, 'SETTLEMENT').forEach((t: D) => { t.beneficiaryAccount = 'BEN-STABLE'; }); d.dataAvailability = { ...d.dataAvailability, website: 'MISSING' }; delete d.website; } },
  { name: 'quiet launderer: + no match calendar', base: BET, should: 'OPEN_CASE',
    known: 'fixed in S2 (Bayesian fusion + provenance gate)', mutate: d => { d.transactions = d.transactions.filter((t: D) => !(t.merchantId === d.merchant.id && (t.type === 'REFUND' || t.type === 'TRANSFER'))); own(d, 'SETTLEMENT').forEach((t: D) => { t.beneficiaryAccount = 'BEN-STABLE'; }); d.dataAvailability = { ...d.dataAvailability, website: 'MISSING' }; delete d.website; d.matchFixtures = []; d.dataAvailability.calendar = 'MISSING'; } },
  { name: 'acquirer-only feed: betting front, every non-acquiring source MISSING', base: BET, should: 'OPEN_CASE',
    mutate: d => { d.dataAvailability = { acquiring: 'AVAILABLE', website: 'MISSING', orders: 'MISSING', bank: 'MISSING', fulfillment: 'MISSING', calendar: 'MISSING', verification: 'MISSING' }; delete d.website; d.orders = []; d.bankCredits = []; d.purchaserVerification = null; d.matchFixtures = []; } },
  { name: 'threshold-hugging: betting sales re-amounted to non-round values', base: BET, should: 'OPEN_CASE',
    mutate: d => { own(d, 'SALE').forEach((t: D) => { if (t.amount >= 500 && t.amount % 500 === 0) t.amount += 37; }); } },
  { name: 'threshold-hugging: off-hours betting sales shifted to 21:00 local', base: BET, should: 'OPEN_CASE',
    mutate: d => { own(d, 'SALE').forEach((t: D) => { const istHour = (new Date(t.time).getTime() / 3600000 + 5.5) % 24; if (istHour < 7 || istHour >= 22) t.time = new Date(new Date(t.time).getTime() - ((istHour - 21 + 24) % 24) * 3600000).toISOString(); }); } },
  { name: 'false positive: genuine sweets gets new bank account mid-period', base: GOOD, should: 'NO_CASE',
    known: 'fixed in S2 (Bayesian fusion + provenance gate)', mutate: d => { const s = own(d, 'SETTLEMENT').sort((a: D, b: D) => new Date(a.time).getTime() - new Date(b.time).getTime()); s.forEach((t: D, i: number) => { if (i >= s.length / 2) t.beneficiaryAccount = 'BEN-NEWBANK'; }); } },
  { name: 'false positive: genuine sweets near a college, 30% payers from 5 other states', base: GOOD, should: 'NO_CASE',
    mutate: d => { own(d, 'SALE').forEach((t: D, i: number) => { if (i % 3 === 0) t.payerState = ['MH', 'TN', 'DL', 'UP', 'WB'][i % 5]; }); } },
  { name: 'false positive: genuine sweets gift-box season, 30% sales at 500/1000', base: GOOD, should: 'NO_CASE',
    mutate: d => { own(d, 'SALE').forEach((t: D, i: number) => { if (i % 3 === 0) t.amount = i % 2 ? 500 : 1000; }); } },
  { name: 'false positive: genuine sweets late-night delivery app, 30% sales 22:00-23:30', base: GOOD, should: 'NO_CASE',
    mutate: d => { own(d, 'SALE').forEach((t: D, i: number) => { if (i % 3 === 0) t.time = t.time.slice(0, 10) + 'T22:30:00+05:30'; }); } },
  { name: 'false positive: genuine diwali + one bank change + 3 refunds to UPI wallet', base: DIWALI, should: 'NO_CASE',
    known: 'fixed in S2 (Bayesian fusion + provenance gate)', mutate: d => { const s = own(d, 'SETTLEMENT'); s.forEach((t: D, i: number) => { if (i >= s.length / 2) t.beneficiaryAccount = 'BEN-NEW'; }); own(d, 'REFUND').slice(0, 3).forEach((t: D) => { t.paidTo = 'WALLET-X'; }); } },
  { name: 'robustness: merchant with zero SALEs but refunds', base: GOOD, should: 'REJECT',
    mutate: d => { d.transactions = d.transactions.filter((t: D) => !(t.merchantId === d.merchant.id && t.type === 'SALE')); } },
  { name: 'robustness: negative amount', base: GOOD, should: 'REJECT',
    mutate: d => { own(d, 'SALE')[0].amount = -100; } },
  { name: 'robustness: ticketMin > ticketMax', base: GOOD, should: 'NO_CRASH',
    mutate: d => { d.merchant.ticketMin = 5000; d.merchant.ticketMax = 10; } },
  { name: 'robustness: hours [22,6] overnight business', base: GOOD, should: 'NO_CASE',
    mutate: d => { d.merchant.hours = [22, 6]; } },
  { name: 'robustness: all weeklySales actual null', base: GOOD, should: 'NO_CRASH',
    mutate: d => { d.weeklySales.forEach((w: D) => { w.actual = null; }); } },
  { name: 'robustness: seasonalMultiplier 0', base: GOOD, should: 'NO_CRASH',
    mutate: d => { d.weeklySales.forEach((w: D) => { w.seasonalMultiplier = 0; }); } },
  { name: 'robustness: purchaserVerification confirmed > contacted', base: GOOD, should: 'REJECT',
    mutate: d => { d.purchaserVerification = { contacted: 10, confirmed: 50 }; d.dataAvailability.verification = 'AVAILABLE'; } },
  { name: 'robustness: 1 sale only', base: GOOD, should: 'NO_CRASH',
    mutate: d => { const keep = own(d, 'SALE')[0]; d.transactions = d.transactions.filter((t: D) => t === keep || t.type !== 'SALE'); } },
  { name: 'robustness: duplicate payment split into 50 rupee-1 sales same payer same second', base: GOOD, should: 'NO_CRASH',
    mutate: d => { const s0 = own(d, 'SALE')[0]; for (let i = 0; i < 50; i++) d.transactions.push({ ...s0, id: s0.id + '-dup' + i, amount: 1 }); } },
  { name: 'scale: 50k sales runtime under 5s', base: GOOD, should: 'NO_CRASH',
    mutate: d => { const s0 = own(d, 'SALE')[0]; for (let i = 0; i < 50000; i++) d.transactions.push({ ...s0, id: s0.id + '-s' + i }); } },
  // ADD MORE CASES BELOW (copy the shape above exactly)
];

const rows: string[] = [];
let weak = 0;
for (const c of CASES) {
  const d = load(c.base);
  let got: string, detail = '';
  try {
    c.mutate(d);
    const r = analyzeDataset(d);
    if (!r.ok) { got = 'REJECT'; detail = r.errors.slice(0, 2).join(' | '); }
    else {
      const f = r.result.fusion;
      const nan = JSON.stringify(r.result.evidence.map(e => e.strength)).includes('null') || Number.isNaN(f.priorityScore);
      got = f.decision; detail = `${f.priority} score=${f.priorityScore.toFixed(2)} fam=${f.independentFamilies.join('')} sys=${f.systems.length} ill=${r.result.evidence.filter(e => e.status === 'ILLICIT').map(e => e.id).join(',')}${nan ? ' NaN!' : ''}`;
      if (nan) got = 'NAN';
    }
  } catch (e) { got = 'CRASH'; detail = (e as Error).message.slice(0, 120); }
  const pass = c.should === 'NO_CRASH' ? !['CRASH', 'NAN'].includes(got) : got === c.should;
  if (!pass && !c.known) weak++;
  rows.push(`${pass ? 'PASS' : c.known ? 'KNOWN' : 'WEAK'} | ${c.name} | want ${c.should} got ${got} | ${detail}${!pass && c.known ? ` | ${c.known}` : ''}`);
  if (pass && c.known) { weak++; rows.push(`STALE | ${c.name} now passes: remove its "known" marker`); }
}
console.log(rows.join('\n'));
console.log(`\n${CASES.length - weak}/${CASES.length} robust, ${weak} weaknesses`);
process.exit(weak ? 1 : 0);
