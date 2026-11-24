/**
 * Extended adversarial evasion, false-positive trap, and stress tests across all 9 sample archetypes.
 * Supplements scripts/adversarial.ts inside the automated `npm test` / `npm run test:stats` suite.
 * Returns the number of failed assertions.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { analyze } from '../../engine/index';
import { RULES } from '../../rules/index';

type D = Record<string, any>;
const load = (f: string): D => JSON.parse(readFileSync(`frontend/public/samples/${f}`, 'utf8'));
const SAMPLES = readdirSync('frontend/public/samples').filter(f => /^0[1-9]-/.test(f)).sort();

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); }
    else console.log(`  ✓ ${name}`);
  };

  // 1. All 9 sample baseline outcomes & structural invariants
  const expectedOpen = new Set([
    '01-sweet-crumbs-betting-front.json',
    '02-merchant-rotation.json',
    '03-fabricated-online-store.json',
    '05-chai-corner-night-betting.json',
    '09-telegram-betting-no-website.json',
  ]);
  for (const file of SAMPLES) {
    const r = analyze(load(file));
    check(`${file} parses cleanly`, r.ok);
    if (!r.ok) continue;
    const want = expectedOpen.has(file) ? 'OPEN_CASE' : 'NO_CASE';
    check(`${file} baseline decision === ${want}`, r.result.fusion.decision === want, `got ${r.result.fusion.decision} P=${r.result.fusion.posterior.toFixed(4)}`);
    check(`${file} trace waterfall matches fusion posterior`, Math.abs(r.trace.waterfall[r.trace.waterfall.length - 1].probability - r.result.fusion.posterior) < 1e-12);
    check(`${file} no NaN/Inf in evidence or fusion`, Number.isFinite(r.result.fusion.posterior) && r.result.evidence.every(e => Number.isFinite(e.llr)));

    // Degrading all AVAILABLE sources to PARTIAL must not crash or produce NaN
    const dPart = load(file);
    dPart.dataAvailability = Object.fromEntries(
      Object.entries(dPart.dataAvailability ?? {}).map(([k, v]) => [k, v === 'AVAILABLE' ? 'PARTIAL' : v]),
    );
    const rPart = analyze(dPart);
    check(`${file} PARTIAL coverage no crash/NaN`, rPart.ok && Number.isFinite(rPart.result.fusion.posterior));

    // Stripping all optional feeds (acquirer-only) must never crash or produce NaN
    const dAcq = load(file);
    dAcq.dataAvailability = { acquiring: 'AVAILABLE', website: 'MISSING', orders: 'MISSING', bank: 'MISSING', fulfillment: 'MISSING', calendar: 'MISSING', verification: 'MISSING' };
    delete dAcq.website;
    dAcq.orders = [];
    dAcq.bankCredits = [];
    dAcq.purchaserVerification = null;
    dAcq.matchFixtures = [];
    const rAcq = analyze(dAcq);
    check(`${file} acquirer-only no crash/NaN`, rAcq.ok && Number.isFinite(rAcq.result.fusion.posterior));
  }

  // 2. Evasion: threshold-hugging amounts just below ₹500 roundMin (e.g. ₹495 / ₹497) + 7 repeats/week
  {
    const d = load('01-sweet-crumbs-betting-front.json');
    const ownSales = d.transactions.filter((t: D) => t.merchantId === d.merchant.id && t.type === 'SALE');
    ownSales.forEach((t: D, i: number) => {
      if (t.amount >= 500 && t.amount % 500 === 0) t.amount = 495 + (i % 3); // avoid 499 bonus tier & 500 round step
    });
    const r = analyze(d);
    check('evasion: threshold-hugging ₹495-497 still caught on remaining families', r.ok && r.result.fusion.decision === 'OPEN_CASE', r.ok ? `${r.result.fusion.decision} P=${r.result.fusion.posterior.toFixed(3)}` : '');
  }

  // 3. Evasion: split-account stealth — betting front removes website & calendar AND splits payers to stay < 8 repeats/wk
  {
    const d = load('01-sweet-crumbs-betting-front.json');
    d.dataAvailability = { ...d.dataAvailability, website: 'MISSING', calendar: 'MISSING' };
    delete d.website;
    d.matchFixtures = [];
    let k = 0;
    d.transactions.forEach((t: D) => {
      if (t.merchantId === d.merchant.id && t.type === 'SALE') t.payerId = `SPLIT-${k++}`;
    });
    const r = analyze(d);
    check('evasion: split-payer + no-website + no-calendar betting front still caught', r.ok && r.result.fusion.decision === 'OPEN_CASE', r.ok ? `${r.result.fusion.decision} P=${r.result.fusion.posterior.toFixed(3)}` : '');
  }

  // 4. False-positive trap: genuine merchant with 100% of sales to its own mobile-linked alternate refund accounts
  {
    const d = load('06-shree-ganesh-sweets-genuine.json');
    const sales = d.transactions.filter((t: D) => t.merchantId === d.merchant.id && t.type === 'SALE');
    sales.slice(0, 10).forEach((s: D, i: number) => {
      s.payerMobile = `98000000${String(i).padStart(2, '0')}`;
      d.transactions.push({
        id: `SELF-REF-${i}`,
        merchantId: d.merchant.id,
        type: 'REFUND',
        amount: 2000,
        time: new Date(Date.parse(s.time) + 3600000).toISOString(),
        channel: 'UPI_LINK',
        payerId: s.payerId,
        refundOfTransactionId: s.id,
        paidTo: `ALT-ACC-${i}`,
        destHolder: s.payerMobile,
      });
    });
    const r = analyze(d);
    check('false positive: mobile-linked self-refunds >= ₹5k do not open case', r.ok && r.result.fusion.decision === 'NO_CASE', r.ok ? `${r.result.fusion.decision} P=${r.result.fusion.posterior.toFixed(4)}` : '');
  }

  // 5. False-positive trap: genuine merchant with bonus-tier prices explicitly listed in website catalogue
  {
    const d = load('06-shree-ganesh-sweets-genuine.json');
    d.website = d.website ?? { embeds: [], catalogue: [] };
    d.website.catalogue.push(
      { sku: 'BOX-199', name: 'Mini Box', price: 199, inCategory: true, dupImage: false },
      { sku: 'BOX-499', name: 'Festive Box', price: 499, inCategory: true, dupImage: false },
      { sku: 'BOX-999', name: 'Family Box', price: 999, inCategory: true, dupImage: false },
    );
    d.transactions.filter((t: D) => t.merchantId === d.merchant.id && t.type === 'SALE').forEach((t: D, i: number) => {
      t.amount = [199, 499, 999][i % 3];
    });
    const r = analyze(d);
    check('false positive: catalogue-listed 199/499/999 prices do not fire A5 or open case',
      r.ok && r.result.fusion.decision === 'NO_CASE' && r.result.evidence.find(e => e.id === 'A5')!.status !== 'ILLICIT');
  }

  // 6. False-positive trap: genuine merchant with all payers from neighbouring states (rules/states.json)
  {
    const d = load('06-shree-ganesh-sweets-genuine.json');
    const home = d.merchant.localStates[0];
    const nbrs = [home, ...RULES.neighbours(home)];
    d.transactions.filter((t: D) => t.merchantId === d.merchant.id && t.type === 'SALE').forEach((t: D, i: number) => {
      t.payerState = nbrs[i % nbrs.length];
    });
    const r = analyze(d);
    check('false positive: 100% neighbouring-state payers stay NO_CASE and B6 calm',
      r.ok && r.result.fusion.decision === 'NO_CASE' && r.result.evidence.find(e => e.id === 'B6')!.status === 'BENIGN');
  }

  // 7. False-positive trap: genuine merchant on non-local NATIONAL MCC (5712) with nationwide buyers
  {
    const d = load('06-shree-ganesh-sweets-genuine.json');
    d.merchant.mcc = '5712';
    d.merchant.catchment = 'NATIONAL';
    d.merchant.hours = [0, 24];
    d.transactions.filter((t: D) => t.merchantId === d.merchant.id && t.type === 'SALE').forEach((t: D, i: number) => {
      t.payerId = `FURN-CUST-${i}`;
      t.payerState = ['DL', 'MH', 'WB', 'TN', 'RJ'][i % 5];
      t.amount = 3500 + (i % 5) * 400;
    });
    const r = analyze(d);
    check('false positive: NATIONAL MCC 5712 with nationwide ₹3.5k-5k sales stays NO_CASE',
      r.ok && r.result.fusion.decision === 'NO_CASE' && r.result.evidence.find(e => e.id === 'B6')!.status === 'UNKNOWN');
  }

  // 8. Rotation scenario (02): removing peer cohort turns rotation signals UNKNOWN but keeps no crash
  {
    const d = load('02-merchant-rotation.json');
    d.peers = [];
    const r = analyze(d);
    check('rotation sample without peers: E3 & F2 become UNKNOWN without crash',
      r.ok && r.result.evidence.find(e => e.id === 'E3')!.status === 'UNKNOWN' && r.result.evidence.find(e => e.id === 'F2')!.status === 'UNKNOWN');
  }

  // 9. Telegram no-website sample (09): must open case even with website & orders & bank & fulfillment MISSING
  {
    const d = load('09-telegram-betting-no-website.json');
    const r = analyze(d);
    check('telegram sample opens case with >= 0.50 posterior and no website',
      r.ok && r.result.fusion.decision === 'OPEN_CASE' && r.result.fusion.posterior >= 0.50 && r.result.scenario.coverage.website === 'MISSING');
  }

  return bad;
}
