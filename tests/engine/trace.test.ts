/**
 * The reasoning trace must be checkable by hand. For every sample:
 *  - the waterfall's last step equals the engine's posterior (the steps really add up);
 *  - removing a fired signal never raises the posterior; value of information is never negative;
 *  - every number and detector id in the case summary appears in the trace (plan check D8);
 * and the verifier must reject a summary that invents a number or an id.
 * Returns the number of failures.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { analyzeDataset } from '../../backend/src/algorithms/analyze';
import { buildTrace } from '../../frontend/src/engines/traceEngine';
import { templateSummary, verifySummary } from '../../backend/src/llm';

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); } };
  const files = readdirSync('frontend/public/samples').filter(f => /^0\d-.*\.json$/.test(f));
  for (const f of files) {
    const r = analyzeDataset(JSON.parse(readFileSync(`frontend/public/samples/${f}`, 'utf8')));
    if (!r.ok) { check(`${f} parses`, false); continue; }
    const t = buildTrace(r.result), last = t.waterfall[t.waterfall.length - 1];
    check(`${f}: waterfall adds up to the posterior`, Math.abs(last.probability - r.result.fusion.posterior) < 1e-9, `${last.probability} vs ${r.result.fusion.posterior}`);
    check(`${f}: waterfall starts at the base rate`, Math.abs(t.waterfall[0].probability - r.result.fusion.prior) < 1e-9);
    for (const c of t.counterfactuals) check(`${f}: ${c.what} cannot raise P`, c.posterior <= r.result.fusion.posterior + 1e-9);
    for (const v of t.valueOfInformation) check(`${f}: VOI of ${v.feed} is not negative`, v.voiRupees >= 0 && v.pFire >= 0 && v.pFire <= 1);
    const s = templateSummary(t), v = verifySummary(s, t);
    check(`${f}: summary is fully traceable`, v.ok, v.unsupported.join(', '));
  }
  const r = analyzeDataset(JSON.parse(readFileSync('frontend/public/samples/01-sweet-crumbs-betting-front.json', 'utf8')));
  if (r.ok) {
    const t = buildTrace(r.result);
    check('verifier rejects an invented amount', !verifySummary('Collections of ₹9,87,654 were found.', t).ok);
    check('verifier rejects an invented detector id', !verifySummary('Detector J9 fired.', t).ok);
    check('verifier accepts a real detector id', verifySummary('Detector A4 fired.', t).ok);
    check('missing feeds get a value-of-information line', t.valueOfInformation.length > 0);
  }
  return bad;
}
