/**
 * Red team: take DISTINCT fronts the engine catches and try to make each one get away.
 * Every operator runs on every merchant, so a rate here is over different merchants, not copies of one.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { DatasetTransaction, MreDataset } from '../frontend/src/data/dataset';
import { toIst } from '../frontend/src/data/dataset';
import { analyze } from '../engine/index';
import { makeSuite } from '../engine/synthetic';
import { mulberry32, type Rng } from '../frontend/src/utils/prng';
import { rate } from './lib';

type Operator = (sales: DatasetTransaction[], r: Rng, d: MreDataset) => void;
// The attacker changes only its own payments: the side-stream where there is one, otherwise the whole account.
const illicit = (d: MreDataset) => {
  const sales = d.transactions.filter(t => t.type === 'SALE'), side = sales.filter(t => t.payerId?.startsWith('b'));
  return side.length ? side : sales;
};
const OPS: Record<string, Operator> = {
  'nudge round amounts': (xs, r) => xs.forEach(t => { if (t.amount % 50 === 0) t.amount += 1 + Math.floor(r() * 48); }),
  'move into shop hours': (xs, r) => xs.forEach(t => { t.time = toIst(Date.parse(`${t.time.slice(0, 10)}T09:00:00+05:30`) + r() * 11 * 3600000); }),
  'use local mules': (xs, _r, d) => xs.forEach(t => { if (t.payerState) t.payerState = d.merchant.localStates[0]; }),
  'never reuse a payer': xs => xs.forEach((t, i) => { t.payerId = `fresh${i}`; }),
  'hide in the main QR': xs => xs.forEach(t => { t.paymentLinkId = 'QR-MAIN'; }),
  'rotate links every 20 payments': xs => xs.forEach((t, i) => { t.paymentLinkId = `ROT-${Math.floor(i / 20)}`; }),
  'thin to a tenth': (xs, _r, d) => {
    const gone = new Set(xs.filter((_, i) => i % 10 !== 0).map(t => t.id));
    d.transactions = d.transactions.filter(t => !gone.has(t.id) && !(t.refundOfTransactionId && gone.has(t.refundOfTransactionId)));
  },
};
OPS['all of the first four'] = (xs, r, d) => ['nudge round amounts', 'move into shop hours', 'use local mules', 'never reuse a payer'].forEach(k => OPS[k](xs, r, d));

const decide = (d: MreDataset) => { const r = analyze(d); if (!r.ok) throw new Error(r.errors.join(' ')); return r.result.fusion; };
const targets = makeSuite(12, 31, { geo: true }).filter(m => m.label === 1 && decide(m.dataset).decision === 'OPEN_CASE');
const rows: string[] = [], log: string[] = [];
Object.entries(OPS).forEach(([name, op], i) => {
  let evaded = 0, silent = 0;
  targets.forEach((m, k) => {
    const d = structuredClone(m.dataset);
    op(illicit(d), mulberry32(9000 + i * 1000 + k), d);
    const f = decide(d);
    if (f.decision === 'NO_CASE') { evaded++; if (f.followUp === 'NONE') silent++; }
    log.push(JSON.stringify({ merchantId: d.merchant.id, kind: m.kind, operator: name, posterior: +f.posterior.toFixed(6), decision: f.decision, followUp: f.followUp }));
  });
  rows.push(`| ${name} | ${rate(evaded, targets.length)} | ${silent}/${targets.length} |`);
});
const text = `# Red team (synthetic)

**Synthetic.** ${targets.length} different fronts that the engine catches, each attacked with ${Object.keys(OPS).length} operators. Not a live attacker.

| Attack | Case avoided | Wilson 95% | Not even asked |
|---|---|---|---|
${rows.join('\n')}

These are open weaknesses. An attacker who does everything at once looks like a shop in payment data and needs outside-in
evidence to find. A threshold fix is proposed only if it passes the honest-merchant holdout in engine/improver.ts.
`;
mkdirSync('reports', { recursive: true });
mkdirSync('examples/redteam', { recursive: true });
writeFileSync('reports/redteam.md', text);
writeFileSync('examples/redteam/evasions.jsonl', log.join('\n') + '\n');
console.log(text);
