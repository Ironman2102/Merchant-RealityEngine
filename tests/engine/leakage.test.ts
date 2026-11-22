/** The first dataset gave away the label and the model learned it. These tests fail if that returns. */
import { analyze } from '../../engine/index';
import { MODEL_FEATURES, secondOpinion } from '../../engine/model';
import { makeSuite, type SyntheticMerchant } from '../../engine/synthetic';

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
  const ledgers = new Set(suite.map(m => JSON.stringify(m.dataset.transactions.map(t => [t.amount, t.time]))));
  check('no two merchants share a ledger', ledgers.size === suite.length);
  check('the model has no age, prior or feed input', MODEL_FEATURES.every(id => /^[A-Z]\d+$/.test(id)));

  let flagged = 0, n = 0;
  for (const m of suite.filter(x => x.label === 0)) {
    const d = structuredClone(m.dataset);
    d.matchFixtures = [];
    d.dataAvailability = { ...d.dataAvailability, calendar: 'MISSING' };
    d.transactions.forEach(t => { delete t.payerState; delete t.payerId; });
    const r = analyze(d);
    if (!r.ok) continue;
    n++;
    const s = secondOpinion(r.result);
    if (s.p >= s.threshold) flagged++;
  }
  check('stripping feeds does not make the model flag honest merchants', flagged / n <= 0.05, `${flagged}/${n}`);
  return bad;
}
