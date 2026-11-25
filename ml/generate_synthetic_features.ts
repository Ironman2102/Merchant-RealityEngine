import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCanonicalDataset } from '../backend/src/adapters/canonicalDataset';
import { runInvestigation } from '../frontend/src/engines/investigationEngine';
import { analyze, behavioralFeatures, modelFeatures } from '../engine/index';
import { makeContextPortfolio, makeContextSuite, makePortfolio, makeSuite } from '../engine/synthetic';

// 1. Curated synthetic sample fixtures (uses behavioralFeatures — no age/prior/feed shortcuts).
const root = join(import.meta.dirname, '..');
const samples = join(root, 'frontend/public/samples');
const files = readdirSync(samples).filter(name => /^\d\d-.*\.json$/.test(name)).sort();
const sampleRows: Array<{ merchant_id: string; label: number; features: Record<string, number> }> = [];
for (const name of files) {
  const raw = JSON.parse(readFileSync(join(samples, name), 'utf8')) as Record<string, any>;
  if (Array.isArray(raw.transactions) && raw.transactions.length > 500) {
    const stride = raw.transactions.length / 500;
    raw.transactions = Array.from({ length: 500 }, (_, i) => raw.transactions[Math.floor(i * stride)]);
  }
  const parsed = parseCanonicalDataset(raw);
  if (!parsed.ok || !parsed.scenario) throw new Error(`Could not parse synthetic sample ${name}: ${parsed.errors.join('; ')}`);
  const label = /betting|fabricated|rotation/i.test(name) ? 1 : 0;
  const result = runInvestigation(parsed.scenario, { posteriorDraws: 0 });
  sampleRows.push({ merchant_id: name.replace(/\.json$/, ''), label, features: behavioralFeatures(result) });
}
if (sampleRows.length < 4 || new Set(sampleRows.map(r => r.label)).size !== 2) {
  throw new Error('Need at least four labeled samples from both classes.');
}
const sampleCols = Object.keys(sampleRows[0].features);
const sampleCsv = [
  ['merchant_id', 'label', ...sampleCols].join(','),
  ...sampleRows.map(r => [r.merchant_id, r.label, ...sampleCols.map(c => r.features[c] ?? 0)].join(',')),
].join('\n') + '\n';

const out = join(root, 'ml/data');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'synthetic_features.csv'), sampleCsv);
writeFileSync(
  join(out, 'synthetic_features.meta.json'),
  JSON.stringify(
    {
      synthetic: true,
      rows: sampleRows.length,
      positive: sampleRows.filter(r => r.label).length,
      negative: sampleRows.filter(r => !r.label).length,
      source: 'frontend/public/samples/*.json',
    },
    null,
    2,
  ),
);

// 2. Leak-free behavioral corpus from engine/synthetic.ts (no cloned samples, no feed/age leakage).
// The context suite and portfolio add website, order, delivery and purchaser feeds (half of merchants, independent of
// the label) and fabricated-store fronts, which the payment-only generator above cannot represent.
const syntheticMerchants = [...makeSuite(12, 42), ...makePortfolio(240, 77, 0.25), ...makeContextSuite(8, 4242), ...makeContextPortfolio(400, 31337)];
const portfolioRows: Array<{ merchant_id: string; label: number; features: Record<string, number> }> = [];
for (const m of syntheticMerchants) {
  const analyzed = analyze(m.dataset, { posteriorDraws: 0 });
  if (!analyzed.ok) continue;
  const merged = modelFeatures(analyzed.result);
  portfolioRows.push({ merchant_id: m.dataset.merchant.id, label: m.label, features: merged });
}
const portCols = Object.keys(portfolioRows[0].features);
const portCsv = [
  ['merchant_id', 'label', ...portCols].join(','),
  ...portfolioRows.map(r => [r.merchant_id, r.label, ...portCols.map(c => r.features[c] ?? 0)].join(',')),
].join('\n') + '\n';
writeFileSync(join(out, 'features.csv'), portCsv);

console.log(
  `Wrote ${sampleRows.length} sample rows -> synthetic_features.csv; ` +
  `${portfolioRows.length} leak-free synthetic merchants (${portfolioRows.filter(r => r.label).length} front, ${portfolioRows.filter(r => !r.label).length} genuine) -> features.csv`,
);
