import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCanonicalDataset } from '../backend/src/adapters/canonicalDataset';
import { runInvestigation } from '../frontend/src/engines/investigationEngine';
import { features } from '../engine/features';

// Curated synthetic examples only. Filename labels document the scenario's intended outcome.
const root = join(import.meta.dirname, '..');
const samples = join(root, 'frontend/public/samples');
const files = readdirSync(samples).filter(name => /^\d\d-.*\.json$/.test(name)).sort();
const rows: Array<{ merchant_id: string; label: number; features: Record<string, number> }> = [];
for (const name of files) {
  const raw = JSON.parse(readFileSync(join(samples, name), 'utf8')) as Record<string, any>;
  // Fixtures can have several thousand events. Keep a deterministic uniform subset for the
  // tiny bootstrap corpus; full runtime analysis still uses the complete uploaded ledger.
  if (Array.isArray(raw.transactions) && raw.transactions.length > 500) {
    const stride = raw.transactions.length / 500;
    raw.transactions = Array.from({ length: 500 }, (_, i) => raw.transactions[Math.floor(i * stride)]);
  }
  const parsed = parseCanonicalDataset(raw);
  if (!parsed.ok || !parsed.scenario) throw new Error(`Could not parse synthetic sample ${name}: ${parsed.errors.join('; ')}`);
  const label = /betting|fabricated|rotation/i.test(name) ? 1 : 0;
  // Training data export needs point statistics, not 1,500 Monte Carlo CI draws per fixture.
  const result = runInvestigation(parsed.scenario, { posteriorDraws: 0 });
  rows.push({ merchant_id: name.replace(/\.json$/, ''), label, features: features(result) });
}
if (rows.length < 4 || new Set(rows.map(r => r.label)).size !== 2) throw new Error('Need at least four labeled samples from both classes.');
const cols = [...new Set(rows.flatMap(r => Object.keys(r.features)))].sort();
const csv = [ ['merchant_id', 'label', ...cols].join(','), ...rows.map(r => [r.merchant_id, r.label, ...cols.map(c => r.features[c] ?? 0)].join(',')) ].join('\n') + '\n';
const out = join(root, 'ml/data'); mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'synthetic_features.csv'), csv);
writeFileSync(join(out, 'synthetic_features.meta.json'), JSON.stringify({ synthetic: true, rows: rows.length, positive: rows.filter(r => r.label).length, negative: rows.filter(r => !r.label).length, source: 'frontend/public/samples/*.json' }, null, 2));
console.log(`Wrote ${rows.length} synthetic merchant examples (${rows.filter(r => r.label).length} front, ${rows.filter(r => !r.label).length} genuine).`);
