/**
 * Continuous learning, step 1: turn analyst-labelled cases into training rows for Stage 2.
 *
 *   npx tsx ml/export_labels.ts [out.csv]  # reads the case database (MRE_DB_FILE or backend/data/mre.db)
 *   python -m ml.train_stage2              # trains a candidate with these labels weighted 5x
 *   python -m ml.train_stage2 --promote    # promotes it only if it is not worse than the current model
 *
 * Only final labels count: CONFIRMED_ILLICIT is a front, ADJUDICATED_BENIGN is honest, UNRESOLVED is skipped (an unresolved
 * case is not evidence of innocence). Features are recomputed from the stored engine result with the same functions the
 * server uses at scoring time, so training and serving cannot drift apart. Merchant ids are hashed; nothing else leaves.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { behavioralFeatures, features } from '../engine/features';
import { listCases } from '../backend/src/store';

const root = join(import.meta.dirname, '..');
const rows: { id: string; label: number; f: Record<string, number> }[] = [];
let skipped = 0;
for (const rec of listCases()) {
  const label = rec.user?.label;
  if (label !== 'CONFIRMED_ILLICIT' && label !== 'ADJUDICATED_BENIGN') continue;
  try {
    const f = { ...features(rec.result), ...behavioralFeatures(rec.result) };
    if (Object.values(f).some(v => !Number.isFinite(v))) { skipped++; continue; }
    const merchant = rec.result.scenario.profile.id ?? rec.id;
    rows.push({ id: createHash('sha256').update(String(merchant)).digest('hex').slice(0, 16), label: label === 'CONFIRMED_ILLICIT' ? 1 : 0, f });
  } catch { skipped++; }
}

// One row per merchant: the latest labelled case wins, so a merchant cannot be counted twice.
const byMerchant = new Map(rows.map(r => [r.id, r]));
const out = join(root, 'ml', 'data');
mkdirSync(out, { recursive: true });
const cols = byMerchant.size ? Object.keys([...byMerchant.values()][0].f) : [];
const target = process.argv[2] ?? join(out, 'labelled_cases.csv');
writeFileSync(target, [
  ['merchant_id', 'label', ...cols].join(','),
  ...[...byMerchant.values()].map(r => [r.id, r.label, ...cols.map(c => r.f[c] ?? 0)].join(',')),
].join('\n') + '\n');
const fronts = [...byMerchant.values()].filter(r => r.label === 1).length;
console.log(`Exported ${byMerchant.size} labelled merchants (${fronts} fronts, ${byMerchant.size - fronts} honest) to ${target}; skipped ${skipped}.`);
if (byMerchant.size === 0) console.log('No final labels yet. Stage 2 trains on synthetic data only until analysts label cases.');
