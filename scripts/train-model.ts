/**
 * Train and honestly evaluate the second opinion. No Python, no downloads.
 * Usage: npx tsx scripts/train-model.ts
 * Training, test and leave-one-kind-out use different seeds. The 0.5 bar was fixed before looking at results.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { analyze } from '../engine/index';
import { linearScore, MODEL_FEATURES, modelVector } from '../engine/model';
import { FRONTS, makeSuite, type SyntheticMerchant } from '../engine/synthetic';
import { rate } from './lib';

interface Row { x: number[]; y: number; kind: string; engine: boolean }
const BAR = 0.5;

function rowsOf(suite: SyntheticMerchant[], mutate?: (m: SyntheticMerchant) => void): Row[] {
  return suite.map(m => {
    const copy = mutate ? structuredClone(m) : m;
    mutate?.(copy);
    const r = analyze(copy.dataset);
    if (!r.ok) throw new Error(r.errors.join(' '));
    return { x: modelVector(r.result), y: m.label, kind: m.kind, engine: r.result.fusion.decision === 'OPEN_CASE' };
  });
}

/** L2 logistic regression by gradient descent, weights projected onto >= 0. */
function fit(rows: Row[]): { intercept: number; weights: number[] } {
  const d = MODEL_FEATURES.length, w = Array<number>(d).fill(0);
  let b = -2;
  for (let step = 0; step < 3000; step++) {
    const g = Array<number>(d).fill(0);
    let gb = 0;
    for (const { x, y } of rows) {
      const err = linearScore(x, b, w) - y;
      gb += err;
      for (let j = 0; j < d; j++) g[j] += err * x[j];
    }
    b -= 0.15 * gb / rows.length;
    for (let j = 0; j < d; j++) w[j] = Math.max(0, w[j] - 0.15 * (g[j] / rows.length + 0.02 * w[j]));
  }
  return { intercept: b, weights: w };
}

const train = rowsOf(makeSuite(34, 101)), m = fit(train);
const flag = (r: Row, f = m) => linearScore(r.x, f.intercept, f.weights) >= BAR;
const count = (rows: Row[], label: number, hit: (r: Row) => boolean) => { const xs = rows.filter(r => r.y === label); return rate(xs.filter(r => hit(r)).length, xs.length); };

const suite = makeSuite(20, 202), test = rowsOf(suite);
const noGeo = rowsOf(suite, s => s.dataset.transactions.forEach(t => { delete t.payerState; }));
const noPayer = rowsOf(suite, s => s.dataset.transactions.forEach(t => { delete t.payerState; delete t.payerId; }));
const unseen = FRONTS.map(k => {
  const f = fit(train.filter(r => r.kind !== k.name)), xs = test.filter(r => r.kind === k.name);
  return `| ${k.name} | ${rate(xs.filter(r => flag(r, f)).length, xs.length)} |`;
});

mkdirSync('ml/models', { recursive: true });
writeFileSync('ml/models/linear-v1.json', JSON.stringify({
  version: 'linear-v1', trainedOn: 'engine/synthetic.ts makeSuite(34, 101). Synthetic.', threshold: BAR,
  intercept: +m.intercept.toFixed(6), weights: Object.fromEntries(MODEL_FEATURES.map((id, i) => [id, +m.weights[i].toFixed(6)])),
}, null, 2) + '\n');
mkdirSync('reports', { recursive: true });
const text = `# Second-opinion model (synthetic)

**Synthetic, and written by the same people as the rules. Not real-world accuracy.**

linear-v1 replaces m1-v0 (LightGBM) and nn-v0 (neural network), which were withdrawn: their training data gave away the label
(account age, bank feed and purchaser-verification presence each separated the classes perfectly), and with purchaser
verification removed the tree model flagged 928 of 928 honest merchants.

The new model is logistic regression with non-negative weights on fired payment signals. It cannot read account age, feed
availability or the category, and a missing feed is a zero. Trained on seed 101, tested on seed 202, bar ${BAR} fixed in advance.

| Test | Measured | Wilson 95% |
|---|---|---|
| Fronts flagged by the model | ${count(test, 1, flag)} |
| Honest flagged by the model | ${count(test, 0, flag)} |
| Fronts opened by the engine | ${count(test, 1, r => r.engine)} |
| Honest opened by the engine | ${count(test, 0, r => r.engine)} |
| No payer location: fronts flagged | ${count(noGeo, 1, flag)} |
| No payer location: honest flagged | ${count(noGeo, 0, flag)} |
| No location or payer id: fronts flagged | ${count(noPayer, 1, flag)} |
| No location or payer id: honest flagged | ${count(noPayer, 0, flag)} |

## A kind of front it never saw in training

| Kind left out | Flagged | Wilson 95% |
|---|---|---|
${unseen.join('\n')}

It does not choose the action.
`;
writeFileSync('reports/model-comparison.md', text);
console.log(text);
