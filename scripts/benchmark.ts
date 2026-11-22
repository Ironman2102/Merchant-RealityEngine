/**
 * Score a synthetic portfolio and write reports/benchmark.md plus the queue the console shows.
 * Synthetic. Intervals are Wilson 95%. Shortfalls are printed, not hidden.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { analyze } from '../engine/index';
import { makePortfolio, makeSuite, type SyntheticMerchant } from '../engine/synthetic';
import { scorePortfolio, type PortfolioRow } from '../engine/portfolio';
import { rate } from './lib';

const SEED = 7, N = 1000;
interface Scored { m: SyntheticMerchant; open: boolean; ask: boolean; l3: boolean; row: PortfolioRow }
function score(m: SyntheticMerchant): Scored {
  const ran = analyze(m.dataset);
  if (!ran.ok) throw new Error(ran.errors.join(' '));
  const r = ran.result, f = r.fusion, sales = r.events.filter(e => e.type === 'SALE'), action = r.review.recommended;
  const inScope = r.scope.kind === 'link' ? sales.filter(e => e.linkId === r.scope.id) : sales;
  const value = inScope.reduce((s, e) => s + e.amount, 0) * (r.scope.kind === 'repeat-payers' ? r.scope.share : 1);
  return {
    m, open: f.decision === 'OPEN_CASE', ask: f.followUp === 'ASK', l3: f.decision === 'OPEN_CASE' && action === 'L3',
    row: { merchantId: m.dataset.merchant.id, name: m.dataset.merchant.name, posterior: f.posterior, ci: f.posteriorCi, decision: f.decision, action,
      expectedLoss: f.decisionAnalysis.actions.find(a => a.level === action)!.expectedLoss, exposure: Math.round(f.posterior * value), scope: r.scope.label },
  };
}

const all = makePortfolio(N, SEED).map(score), queue = scorePortfolio(all.map(s => s.row));
const opened = new Set(queue.queue.map(r => r.merchantId)), inQueue = (s: Scored) => opened.has(s.row.merchantId);
const fronts = all.filter(s => s.m.label === 1), honest = all.filter(s => s.m.label === 0);
const tp = fronts.filter(inQueue).length, fp = honest.filter(inQueue).length;

const kinds = makeSuite(20, 77).map(score), noGeo = makeSuite(20, 77, { geo: false }).map(score);
const table = (rows: Scored[], label: 0 | 1) => [...new Set(rows.filter(s => s.m.label === label).map(s => s.m.kind))].map(kind => {
  const xs = rows.filter(s => s.m.kind === kind);
  return `| ${kind} | ${xs.filter(s => s.open).length}/${xs.length} | ${xs.filter(s => s.ask).length}/${xs.length} | ${xs.filter(s => !s.open && !s.ask).length}/${xs.length} |`;
});
const HEAD = '| Kind | Case opened | Asked to explain | Nothing |\n|---|---|---|---|';

const text = `# Benchmark (synthetic)

**Synthetic merchants from engine/synthetic.ts, written by the same people as the rules. Not real-world accuracy.**
Account age, feeds and format are drawn the same way for honest merchants and fronts, so behaviour is the only difference.

Merchants ${N} (seed ${SEED}). Opened ${queue.opened}. Expected false alarms ${queue.expectedFalseAlarms.toFixed(2)}; actual ${fp}.

| Metric | Measured | Wilson 95% |
|---|---|---|
| Recall: fronts in the case queue | ${rate(tp, fronts.length)} |
| Fronts opened or asked to explain | ${rate(fronts.filter(s => s.open || s.ask).length, fronts.length)} |
| Precision of the queue | ${rate(tp, tp + fp)} |
| Honest merchants wrongly opened | ${rate(fp, honest.length)} |
| Honest merchants recommended for restriction | ${rate(honest.filter(s => s.l3).length, honest.length)} |
| Honest merchants asked to explain | ${rate(honest.filter(s => s.ask).length, honest.length)} |

"Asked to explain" restricts nothing, but it is still scrutiny, so it is reported.

## By kind of front (location present for about 60%)

${HEAD}
${table(kinds, 1).join('\n')}

## By kind of honest merchant

${HEAD}
${table(kinds, 0).join('\n')}

## Fronts when no payer location exists (a UPI ID does not carry one)

${HEAD}
${table(noGeo, 1).join('\n')}

## What it does not catch

- A perfect mimic of the shop's amounts, hours, places and payer mix. Payment data alone cannot find this; it needs outside-in
  evidence such as test purchases, crawls, sightings or complaints.
- Small side-streams and thin split accounts mostly become a question to the merchant, not a case.
- Without payer location, several camouflage categories become a question, not a case.
`;

mkdirSync('reports', { recursive: true });
writeFileSync('reports/benchmark.md', text);
const label = new Map(all.map(s => [s.row.merchantId, s.m.label === 1]));
const out = JSON.stringify({
  synthetic: true, merchants: N, fronts: fronts.length, genuine: honest.length, opened: queue.opened, falseAlarms: fp,
  expectedFalseAlarms: queue.expectedFalseAlarms, queue: queue.queue.map(r => ({ ...r, plantedFront: label.get(r.merchantId) })),
}, null, 1) + '\n';
writeFileSync('reports/portfolio-queue.json', out);
writeFileSync('frontend/public/portfolio-queue.json', out);
mkdirSync('examples/portfolio-truth', { recursive: true });
writeFileSync('examples/portfolio-truth/truth.csv', ['merchant_id,label,kind', ...all.map(s => `${s.row.merchantId},${s.m.label},${s.m.kind}`)].join('\n') + '\n');
console.log(text);
