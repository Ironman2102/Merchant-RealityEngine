/** One test for each defect found in the 22 Nov 2026 audit, so none can come back quietly. */
import { readFileSync } from 'node:fs';
import { analyze } from '../../engine/index';
import { merchantLetter } from '../../engine/outreach';
import { HONEST, makeMerchant } from '../../engine/synthetic';
import { autoDetectMapping, buildDatasetFromCsv, parseCsvText, type CsvMerchantMeta } from '../../frontend/src/utils/csvToDataset';
import { parseTime, stateCode } from '../../frontend/src/utils/ingest';
import type { MreDataset } from '../../frontend/src/data/dataset';
import type { InvestigationResult } from '../../frontend/src/types/investigation';

const load = (f: string) => JSON.parse(readFileSync(`frontend/public/samples/${f}`, 'utf8')) as MreDataset;
const META: CsvMerchantMeta = { id: 'M', name: 'Steady Bakery', category: 'Bakeries', mcc: '5462', city: 'Bengaluru', state: 'KA', catchment: 'LOCAL', ticketMin: 150, ticketMax: 1200, openHour: 7, closeHour: 22, accountAgeDays: 700 };

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); } else console.log(`  ✓ ${name}`); };
  const run = (d: unknown): InvestigationResult => { const r = analyze(d); if (!r.ok) throw new Error(r.errors.join(' ')); return r.result; };

  // CSV
  const amounts = [420, 515, 380, 650, 555, 610, 470, 720, 340, 590, 810, 530, 445, 495];
  let csv = 'txn_id,amount,txn_date,payer_state,status\n';
  for (let d = 1; d <= 28; d++) for (let i = 0; i < 12; i++) csv += `${d}x${i},${amounts[(d + i) % 14]},${String(d).padStart(2, '0')}/09/2026 ${String(8 + i).padStart(2, '0')}:15:00,KA,SUCCESS\n`;
  const parsed = parseCsvText(csv), map = autoDetectMapping(parsed.headers), built = buildDatasetFromCsv(parsed, map, META);
  check('payer_state is not the payer id', map.payerId === '' && map.payerState === 'payer_state');
  check('Indian dates are read day first', built.dataset.transactions[0].time.startsWith('2026-09-01T08:15:00'));
  const ledger = built.dataset.transactions.reduce((s, t) => s + t.amount, 0), stated = built.dataset.weeklySales.reduce((s, w) => s + (w.actual ?? 0), 0);
  check('CSV history is the ledger, not invented', built.dataset.weeklySales.length === 4 && Math.abs(ledger - stated) < 1, `${ledger} vs ${stated}`);
  const steady = run(built.dataset);
  check('steady CSV bakery: no case, no question', steady.fusion.decision === 'NO_CASE' && steady.fusion.followUp === 'NONE');
  check('failed payments are not sales', buildDatasetFromCsv(parseCsvText(csv.replaceAll('SUCCESS', 'FAILED')), map, META).errors.length > 0);
  check('missing time column is refused', buildDatasetFromCsv(parsed, { ...map, time: '' }, META).errors.length > 0);
  check('impossible date is refused', parseTime('31/02/2026') === null && parseTime('12 pm') === null);
  check('state names map to codes', stateCode('Maharashtra') === 'MH' && stateCode('nowhere') === undefined);

  // Missing data
  const none = load('07-udupi-tiffin-steady.json');
  none.transactions = none.transactions.filter(t => t.type !== 'TRANSFER');
  check('no payout feed is UNKNOWN, weight 0', run(none).evidence.filter(e => e.id === 'I2' || e.id === 'I3').every(e => e.status === 'UNKNOWN' && e.llr === 0));
  const big = load('07-udupi-tiffin-steady.json');
  big.transactions.find(t => t.type === 'SETTLEMENT')!.amount = 1_200_000;
  check('a ₹12 lakh settlement is accepted', analyze(big).ok);

  // Category
  const odd = load('06-shree-ganesh-sweets-genuine.json');
  odd.merchant.mcc = '9999';
  check('unknown category abstains', run(odd).evidence.filter(e => ['A1', 'A4', 'B6', 'C2', 'K1'].includes(e.id)).every(e => e.status === 'UNKNOWN'));
  const camouflage = load('09-telegram-betting-no-website.json');
  Object.assign(camouflage.merchant, { mcc: '5712', catchment: 'NATIONAL' });
  const cam = run(camouflage);
  check('a furniture label cannot silence conduct', cam.evidence.some(e => e.status === 'ILLICIT' && e.signal === 'conduct'));

  // Change is not misconduct
  for (const name of ['bakery midnight delivery', 'fuel station', 'temple trust', 'online apparel', 'coaching fees']) {
    let opened = 0;
    for (let i = 0; i < 6; i++) if (run(makeMerchant(HONEST.find(k => k.name === name)!, 0, { id: `M-HON-${i}`, seed: 600 + i, geo: true }).dataset).fusion.decision === 'OPEN_CASE') opened++;
    check(`honest ${name}: no case`, opened === 0, `${opened}/6`);
  }
  const changed = load('11-moonlight-bakes-honest-change.json'), asked = run(changed);
  check('honest change: a question, not a case', asked.fusion.decision === 'NO_CASE' && asked.fusion.followUp === 'ASK' && asked.review.recommended === 'L1');
  changed.contextPassports![0].status = 'VERIFIED';
  const cleared = run(changed);
  check('verified passport clears the change', cleared.fusion.followUp === 'NONE' && cleared.review.recommended === 'L0');

  // Per QR
  const side = load('10-golden-oven-betting-on-the-side.json'), found = run(side);
  check('side business found on its own link', found.fusion.decision === 'OPEN_CASE' && found.scope.id === 'PL-GOB-03');
  check('only that link is restricted', found.suspectLinks.join() === 'PL-GOB-03' && found.review.recommended === 'L3');
  side.contextPassports = [{ id: 'CP-X', reason: 'new product', linkId: 'PL-GOB-03', from: '2026-10-01', document: 'x', hours: [0, 24], states: ['*'], ticketBand: [1, 99999], volumeUplift: 3, status: 'VERIFIED' }];
  check('a passport cannot excuse conduct', run(side).evidence.some(e => e.status === 'ILLICIT' && e.signal === 'conduct') || run(side).streams.some(s => s.followUp === 'ASK' || s.decision === 'OPEN_CASE'));
  const oneQr = load('09-telegram-betting-no-website.json');
  oneQr.transactions.forEach(t => { if (t.paymentLinkId) t.paymentLinkId = 'QR-ONLY'; });
  const whole = run(oneQr);
  check('the main QR is never disabled as a fallback', whole.suspectLinks.length === 0 && whole.review.recommended <= 'L2');

  // Tipping off
  const letters = [load('01-sweet-crumbs-betting-front.json'), load('06-shree-ganesh-sweets-genuine.json')].map(d => merchantLetter({ ...d.merchant, id: 'M', name: 'Same', category: 'Same' }));
  check('letter is the same whatever fired', letters[0] === letters[1]);
  check('letter names no signal', !/match|betting|gambl|round|suspic|undeclared|risk|fraud|STR\b/i.test(letters[0]));

  // Samples
  const files = ['01-sweet-crumbs-betting-front.json', '04-anand-sweets-diwali-genuine.json', '05-chai-corner-night-betting.json', '06-shree-ganesh-sweets-genuine.json', '07-udupi-tiffin-steady.json', '08-nandi-kirana-genuine.json', '09-telegram-betting-no-website.json'];
  check('samples reconcile with their ledgers', files.every(f => run(load(f)).scenario.weeklyReconciled === true));
  check('no two samples share a ledger', new Set(files.map(f => load(f).transactions.filter(t => t.type === 'SALE').map(t => t.amount).join())).size === files.length);
  return bad;
}
