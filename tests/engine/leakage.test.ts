/** The first dataset gave away the label and the model learned it. These tests fail if that returns. */
import fs from 'node:fs';
import path from 'node:path';
import { analyze, BEHAVIORAL_FEATURE_COLUMNS } from '../../engine/index';
import { makeContextSuite, makeSuite, type SyntheticMerchant } from '../../engine/synthetic';

/** Best separation any single cut on a label-irrelevant field achieves (Youden's J: 0 = none, 1 = perfect leak). */
function separation(suite: SyntheticMerchant[], value: (m: SyntheticMerchant) => number): number {
  const xs = suite.map(m => ({ v: value(m), y: m.label })), fronts = xs.filter(x => x.y).length, honest = xs.length - fronts;
  let best = 0;
  for (const cut of new Set(xs.map(x => x.v))) {
    const tp = xs.filter(x => x.y && x.v <= cut).length, fp = xs.filter(x => !x.y && x.v <= cut).length;
    best = Math.max(best, Math.abs(tp / fronts - fp / honest));
  }
  return best;
}

const LEAKY_COLUMNS = new Set(['account_age_days', 'prior', 'posterior', 'logodds_total']);
const isSafeFeature = (col: string) => !LEAKY_COLUMNS.has(col) && !col.startsWith('cov_') && !col.startsWith('unk_');

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); } else console.log(`  ✓ ${name}`); };
  const suite = makeSuite(14, 909);
  const fields: Record<string, (m: SyntheticMerchant) => number> = {
    'account age': m => m.dataset.merchant.accountAgeDays,
    'calendar feed': m => Number(m.dataset.dataAvailability?.calendar === 'AVAILABLE'),
    'location feed': m => Number(m.dataset.transactions.some(t => t.payerState)),
    'bank feed': m => Number(m.dataset.dataAvailability?.bank === 'AVAILABLE'),
    'purchaser panel': m => Number(!!m.dataset.purchaserVerification),
  };
  for (const [name, f] of Object.entries(fields)) { const j = separation(suite, f); check(`${name} does not reveal the label`, j < 0.25, j.toFixed(2)); }
  // The training-only context generator must not give the label away through which feeds exist either.
  const ctx = makeContextSuite(10, 515);
  const ctxFields: Record<string, (m: SyntheticMerchant) => number> = {
    'context: website feed': m => Number(m.dataset.dataAvailability?.website === 'AVAILABLE'),
    'context: orders feed': m => Number(m.dataset.dataAvailability?.orders === 'AVAILABLE'),
    'context: purchaser panel': m => Number(!!m.dataset.purchaserVerification),
    'context: account age': m => m.dataset.merchant.accountAgeDays,
  };
  for (const [name, f] of Object.entries(ctxFields)) { const j = separation(ctx, f); check(`${name} does not reveal the label`, j < 0.25, j.toFixed(2)); }
  const ledgers = new Set(suite.map(m => JSON.stringify(m.dataset.transactions.map(t => [t.amount, t.time]))));
  check('no two merchants share a ledger', ledgers.size === suite.length);
  check('behavioral feature schema has no age, prior or feed input', BEHAVIORAL_FEATURE_COLUMNS.every(isSafeFeature));

  for (const modelDir of ['m1-v0', 'nn-v0', 'classical-v0']) {
    const base = path.resolve(process.cwd(), 'ml/models', modelDir);
    const metaPath = modelDir === 'm1-v0' ? path.join(base, 'features.json') : modelDir === 'nn-v0' ? path.join(base, 'network.json') : path.join(base, 'metadata.json');
    if (fs.existsSync(metaPath)) {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const cols: string[] = Array.isArray(parsed) ? parsed : (parsed.features ?? []);
      check(`${modelDir} has no age, prior or feed input`, cols.length > 0 && cols.every(isSafeFeature));
    }
  }

  let flagged = 0, n = 0;
  for (const m of suite.filter(x => x.label === 0)) {
    const d = structuredClone(m.dataset);
    d.matchFixtures = [];
    d.dataAvailability = { ...d.dataAvailability, calendar: 'MISSING' };
    d.transactions.forEach(t => { delete t.payerState; delete t.payerId; });
    const r = analyze(d);
    if (!r.ok) continue;
    n++;
    if (r.result.fusion.decision === 'OPEN_CASE') flagged++;
  }
  check('stripping feeds does not make the engine flag honest merchants', flagged / Math.max(1, n) <= 0.05, `${flagged}/${n}`);
  return bad;
}
