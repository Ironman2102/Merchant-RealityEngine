/**
 * Score the synthetic portfolio and write reports/benchmark.md.
 * The portfolio is synthetic. Intervals are Wilson 95%.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mapExport } from '../adapters/mapExport';
import { loadHashKey } from '../adapters/pseudonym';
import { analyze, FEATURE_COLUMNS, features } from '../engine/index';
import { scorePortfolio, type PortfolioRow } from '../engine/portfolio';

function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 1];
  const p = k / n, den = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / den;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / den;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}
const fmt = (x: number) => x.toFixed(3);
const ci = (pair: [number, number]) => `${fmt(pair[0])}–${fmt(pair[1])}`;

const truth = readFileSync('examples/portfolio-truth/truth.csv', 'utf8').trim().split('\n').slice(1).map(line => {
  const [id, label, typology, tier] = line.split(',');
  return { id, label: Number(label), typology, tier: Number(tier) };
});
const byId = new Map(truth.map(t => [t.id, t]));
const { datasets } = mapExport('examples/portfolio', 'adapters/mappings/generic-pa-v1.json', loadHashKey());
const rows: PortfolioRow[] = [];
const scored: { id: string; posterior: number; decision: string; mcc: string; age: number }[] = [];
const featLines = [`merchant_id,label,${FEATURE_COLUMNS.join(',')}`];
for (const d of datasets) {
  const ran = analyze(d);
  if (!ran.ok) continue;
  const feat = features(ran.result);
  const label = byId.get(d.merchant.id)?.label ?? 0;
  featLines.push([d.merchant.id, label, ...FEATURE_COLUMNS.map(c => feat[c])].join(','));
  const f = ran.result.fusion;
  const action = f.decisionAnalysis.actions.find(a => a.level === f.decisionAnalysis.recommended);
  rows.push({
    merchantId: d.merchant.id, name: d.merchant.name, posterior: f.posterior, ci: f.posteriorCi,
    expectedLoss: action?.expectedLoss ?? 0, action: f.decisionAnalysis.recommended, decision: f.decision,
  });
  scored.push({ id: d.merchant.id, posterior: f.posterior, decision: f.decision, mcc: d.merchant.mcc, age: d.merchant.accountAgeDays });
}
const queue = scorePortfolio(rows);
const opened = new Set(queue.queue.map(r => r.merchantId));
const y = (id: string) => byId.get(id)?.label ?? 0;
const tp = scored.filter(s => opened.has(s.id) && y(s.id) === 1).length;
const fp = scored.filter(s => opened.has(s.id) && y(s.id) === 0).length;
const fn = scored.filter(s => !opened.has(s.id) && y(s.id) === 1).length;
const tn = scored.filter(s => !opened.has(s.id) && y(s.id) === 0).length;
const fronts = tp + fn, genuine = fp + tn;
const recall = wilson(tp, fronts), prec = wilson(tp, tp + fp), fpr = wilson(fp, genuine);
const sat = scored.filter(s => s.posterior > 0.999).length;
const lines = [
  '# Benchmark (synthetic)',
  '',
  '**Synthetic portfolio derived from 9 hand-built samples; this measures robustness to variation, not real-world accuracy.**',
  '',
  `Merchants ${scored.length}. Opened ${queue.opened}. Expected false alarms ${queue.expectedFalseAlarms.toFixed(2)} (sum of 1−P over the opened queue).`,
  '',
  '| Metric | Value | Wilson 95% |',
  '|---|---|---|',
  `| Recall | ${fmt(tp / (fronts || 1))} (${tp}/${fronts}) | ${ci(recall)} |`,
  `| Precision | ${fmt(tp / ((tp + fp) || 1))} (${tp}/${tp + fp}) | ${ci(prec)} |`,
  `| Genuine-merchant false-positive rate | ${fmt(fp / (genuine || 1))} (${fp}/${genuine}) | ${ci(fpr)} |`,
  '',
  '## Per-typology recall',
  '',
];
const typos = [...new Set(truth.map(t => t.typology))].filter(t => t !== 'genuine').sort();
for (const typ of typos) {
  const ids = truth.filter(t => t.typology === typ);
  const hit = ids.filter(t => opened.has(t.id)).length;
  lines.push(`- ${typ}: ${fmt(hit / ids.length)} (${hit}/${ids.length}), Wilson ${ci(wilson(hit, ids.length))}`);
}
lines.push('', '## Confusion', '', `| | opened | not opened |`, `|---|---|---|`, `| front | ${tp} | ${fn} |`, `| genuine | ${fp} | ${tn} |`, '');
lines.push('## Other synthetic measurements', '');
lines.push(`- Saturation (posterior > 0.999): ${(sat / scored.length).toFixed(3)} (${sat}/${scored.length}).`);
const top = [...scored].sort((a, b) => b.posterior - a.posterior);
for (const k of [10, 50]) {
  const slice = top.slice(0, Math.min(k, top.length));
  const good = slice.filter(s => y(s.id) === 1).length;
  lines.push(`- Top-${k} precision: ${fmt(good / slice.length)} (${good}/${slice.length}), Wilson ${ci(wilson(good, slice.length))}.`);
}
const band = (age: number) => age < 90 ? '<90d' : age < 365 ? '90–365d' : '≥365d';
for (const [title, keyOf] of [['MCC', (s: typeof scored[0]) => s.mcc], ['Account age', (s: typeof scored[0]) => band(s.age)], ['City tier', (s: typeof scored[0]) => String(byId.get(s.id)?.tier ?? '?')]] as const) {
  lines.push('', `### False-positive rate by ${title}`);
  const groups = [...new Set(scored.filter(s => y(s.id) === 0).map(keyOf))].sort();
  for (const g of groups) {
    const members = scored.filter(s => y(s.id) === 0 && keyOf(s) === g);
    const bad = members.filter(s => opened.has(s.id)).length;
    lines.push(`- ${g}: ${fmt(bad / (members.length || 1))} (${bad}/${members.length}), Wilson ${ci(wilson(bad, members.length))}`);
  }
}
lines.push('');
mkdirSync('reports', { recursive: true });
mkdirSync('ml/data', { recursive: true });
writeFileSync('ml/data/features.csv', featLines.join('\n') + '\n');
writeFileSync('reports/benchmark.md', lines.join('\n'));
writeFileSync('reports/portfolio-queue.json', JSON.stringify({ opened: queue.opened, expectedFalseAlarms: queue.expectedFalseAlarms, queue: queue.queue.slice(0, 50) }, null, 2));
console.log(`benchmark wrote reports/benchmark.md · opened ${queue.opened} · expected FA ${queue.expectedFalseAlarms.toFixed(2)}`);
