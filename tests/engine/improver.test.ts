/** Bands, zero labels, and unresolved labels. */
import { readFileSync } from 'node:fs';
import { analyze } from '../../engine/index';
import { insideBand } from '../../engine/improver';
import { effectiveRates } from '../../engine/learnedRates';
import { RULES } from '../../rules/index';

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); } else console.log(`  ✓ ${name}`); };
  const a4 = RULES.detector('A4');
  check('minEffect inside the band', insideBand('A4', { minEffect: a4.minEffect }));
  check('minEffect outside the band is rejected', !insideBand('A4', { minEffect: a4.minEffect * 3 }));
  const prior = effectiveRates('A4', []);
  check('zero labels keep the prior', prior.sensitivity === a4.sensitivity && prior.falsePositive === a4.falsePositive && prior.nPos === 0);
  const unresolved = effectiveRates('A4', [{ detectorId: 'A4', fired: true, label: 'UNRESOLVED' }]);
  check('unresolved labels change nothing', unresolved.sensitivity === prior.sensitivity && unresolved.falsePositive === prior.falsePositive);
  const raw = JSON.parse(readFileSync('frontend/public/samples/04-anand-sweets-diwali-genuine.json', 'utf8'));
  const once = analyze(raw), twice = analyze(raw);
  check('zero-label rescore is identical', once.ok && twice.ok && once.result.fusion.posterior === twice.result.fusion.posterior && once.result.fusion.decision === twice.result.fusion.decision);
  return bad;
}
