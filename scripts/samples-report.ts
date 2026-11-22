/** One line per sample: decision, posterior with 90% interval, firing detectors. Run: npx tsx scripts/samples-report.ts [-v] */
import { readdirSync, readFileSync } from 'node:fs';
import { analyzeDataset } from '../backend/src/algorithms/analyze';
const verbose = process.argv.includes('-v');
for (const f of readdirSync('frontend/public/samples').filter(f => /^\d\d-.*\.json$/.test(f))) {
  const r = analyzeDataset(JSON.parse(readFileSync(`frontend/public/samples/${f}`, 'utf8')));
  if (!r.ok) { console.log(f, 'REJECT', r.errors[0]); continue; }
  const fu = r.result.fusion, ev = r.result.evidence;
  console.log(`${f.padEnd(40)} ${fu.decision.padEnd(9)} P=${fu.posterior.toFixed(3)} [${fu.posteriorCi.map(x => x.toFixed(3)).join('–')}] prior=${fu.prior.toFixed(3)} → ${r.result.review.recommended} | fire ${ev.filter(e => e.status === 'ILLICIT').map(e => `${e.id}${e.llr.toFixed(1)}`).join(' ')}`);
  if (verbose) ev.forEach(e => console.log(`   ${e.id.padEnd(4)} ${e.status.padEnd(8)} llr=${e.llr.toFixed(2).padStart(6)} p=${e.p === null ? '   —   ' : e.p.toExponential(1)} eff=${e.effect === null ? '—' : e.effect.toFixed(2)} n=${e.n} | ${e.observed.slice(0, 90)}`));
}
