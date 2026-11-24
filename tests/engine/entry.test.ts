/** Public engine entry: analyze is the same investigation the server already runs, and the pack omits the audit. */
import { readdirSync, readFileSync } from 'node:fs';
import { analyzeDataset } from '../../backend/src/algorithms/analyze';
import { analyze, buildPack, FEATURE_COLUMNS, features } from '../../engine/index';

const SAMPLES = readdirSync('frontend/public/samples').filter(f => /^\d\d-/.test(f)).sort();

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); } else console.log(`  ✓ ${name}`); };
  check('eleven samples', SAMPLES.length === 11, String(SAMPLES.length));
  for (const file of SAMPLES) {
    const raw = JSON.parse(readFileSync(`frontend/public/samples/${file}`, 'utf8'));
    const got = analyze(raw);
    const prev = analyzeDataset(raw);
    check(`${file} analyzes`, got.ok && prev.ok);
    if (!got.ok || !prev.ok) continue;
    check(`${file} decision`, got.result.fusion.decision === prev.result.fusion.decision, `${got.result.fusion.decision} vs ${prev.result.fusion.decision}`);
    check(`${file} posterior within 1e-9`, Math.abs(got.result.fusion.posterior - prev.result.fusion.posterior) < 1e-12, `${got.result.fusion.posterior} vs ${prev.result.fusion.posterior}`);
    const pack = buildPack(got.result, { caseId: null, createdAt: '2026-01-01T00:00:00.000Z', datasetSha256: 'abc', generatedBy: null });
    check(`${file} pack has no audit`, !('audit' in pack) && !('auditVerification' in pack) && pack.packVersion === 'mre-evidence-pack/1');
    const row = features(got.result);
    check(`${file} features`, FEATURE_COLUMNS.every(k => Number.isFinite(row[k])) && Object.keys(row).length === FEATURE_COLUMNS.length);
  }
  return bad;
}
