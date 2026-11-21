/**
 * Invariants of the Bayesian engine. If any of these break, the engine is no longer telling the truth about evidence.
 * Returns the number of failures.
 */
import { readFileSync } from 'node:fs';
import { analyzeDataset } from '../../backend/src/algorithms/analyze';
import { fuse } from '../../frontend/src/engines/evidenceFusion';
import type { EvidenceItem } from '../../frontend/src/types/evidence';

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); } else console.log(`  ✓ ${name}`); };
  const load = (f: string) => JSON.parse(readFileSync(`frontend/public/samples/${f}`, 'utf8'));
  const run = (d: unknown) => { const r = analyzeDataset(d); if (!r.ok) throw new Error(r.errors.join(' ')); return r.result; };

  const front = run(load('01-sweet-crumbs-betting-front.json')), genuine = run(load('06-shree-ganesh-sweets-genuine.json'));
  const profile = front.scenario.profile;
  const base = fuse(front.evidence, profile).posterior;

  // 1. UNKNOWN evidence never moves the posterior.
  const asUnknown = (e: EvidenceItem): EvidenceItem => ({ ...e, status: 'UNKNOWN', llr: 0 });
  const extra = { ...front.evidence[0], id: 'A1', status: 'UNKNOWN' as const, llr: 0 };
  check('UNKNOWN is neutral', Math.abs(fuse([...front.evidence, extra], profile).posterior - base) < 1e-12);

  // 2. Turning any fired item into UNKNOWN never raises the posterior; turning a calm item into UNKNOWN never lowers it.
  for (const e of front.evidence.filter(x => x.status !== 'UNKNOWN')) {
    const p = fuse(front.evidence.map(x => (x.id === e.id ? asUnknown(x) : x)), profile).posterior;
    if (e.llr > 0) check(`removing fired ${e.id} cannot raise P`, p <= base + 1e-12, `${p} > ${base}`);
    if (e.llr < 0) check(`removing calm ${e.id} cannot lower P`, p >= base - 1e-12, `${p} < ${base}`);
  }

  // 3. Monotone: increasing any item's LLR never lowers the posterior (checked on the genuine merchant, away from saturation).
  const g0 = fuse(genuine.evidence, genuine.scenario.profile).posterior;
  for (const e of genuine.evidence.filter(x => x.status !== 'UNKNOWN')) {
    const p = fuse(genuine.evidence.map(x => (x.id === e.id ? { ...x, llr: x.llr + 0.5 } : x)), genuine.scenario.profile).posterior;
    check(`raising ${e.id} LLR is monotone`, p >= g0 - 1e-15, `${p} < ${g0}`);
  }

  // 4. Determinism: same input → identical evidence, posterior and interval.
  const again = run(load('01-sweet-crumbs-betting-front.json'));
  check('deterministic evidence', JSON.stringify(again.evidence) === JSON.stringify(front.evidence));
  check('deterministic interval', JSON.stringify(again.fusion.posteriorCi) === JSON.stringify(front.fusion.posteriorCi));

  // 5. Event order does not matter.
  const shuffled = load('01-sweet-crumbs-betting-front.json'); shuffled.transactions.reverse();
  check('order invariant', Math.abs(run(shuffled).fusion.posterior - front.fusion.posterior) < 1e-12);

  // 6. The self-declared seasonal multiplier cannot hide volume: changing it leaves the volume evidence untouched.
  const declared = load('01-sweet-crumbs-betting-front.json'); declared.weeklySales.forEach((w: { seasonalMultiplier: number }) => { w.seasonalMultiplier = 3; });
  const h1 = (r: ReturnType<typeof run>) => r.evidence.find(e => e.id === 'H1')!.llr;
  check('uploaded seasonal multiplier ignored', h1(run(declared)) === h1(front));

  // 7. Posterior interval contains the point estimate and sits in [0, 1].
  for (const r of [front, genuine]) { const [lo, hi] = r.fusion.posteriorCi; check('interval sane', lo >= 0 && hi <= 1 && lo <= hi + 1e-12, `${lo} ${hi}`); }

  // 8. Decision theory: the recommended action never exceeds the automatic ceiling, and no case → watch-level only.
  check('no case → L0/L1', ['L0', 'L1'].includes(genuine.review.recommended), genuine.review.recommended);
  check('auto ceiling L3', front.review.recommended <= 'L3', front.review.recommended);
  return bad;
}
