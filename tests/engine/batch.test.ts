/** Batch mode is deterministic and agrees with analyze-after-pseudonymisation. */
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mapExport } from '../../adapters/mapExport';
import { pseudonymize } from '../../backend/src/adapters/canonicalDataset';
import { runBatch } from '../../cli/batch';
import { analyze } from '../../engine/index';

const KEY = Buffer.from('batch-test-key', 'utf8');

export default function (): number {
  const prev = process.env.MRE_HASH_KEY;
  process.env.MRE_HASH_KEY = 'batch-test-key';
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); } else console.log(`  ✓ ${name}`); };
  const a = mkdtempSync(join(tmpdir(), 'mre-batch-a-'));
  const b = mkdtempSync(join(tmpdir(), 'mre-batch-b-'));
  const opts = { inDir: 'examples/generic-pa', mappingPath: 'adapters/mappings/generic-pa-v1.json', key: KEY };
  runBatch({ ...opts, outDir: a });
  runBatch({ ...opts, outDir: b });
  const scoresA = readFileSync(join(a, 'scores.csv'), 'utf8');
  const scoresB = readFileSync(join(b, 'scores.csv'), 'utf8');
  const casesA = readFileSync(join(a, 'cases.jsonl'), 'utf8');
  const casesB = readFileSync(join(b, 'cases.jsonl'), 'utf8');
  check('scores byte-identical', scoresA === scoresB);
  check('cases byte-identical', casesA === casesB);
  check('scores have rows', scoresA.split('\n').length > 9);

  const samples = readdirSync('frontend/public/samples').filter(f => /^\d\d-/.test(f));
  const { datasets } = mapExport('examples/generic-pa', opts.mappingPath, KEY);
  for (const file of samples) {
    const original = JSON.parse(readFileSync(`frontend/public/samples/${file}`, 'utf8')) as { merchant: { id: string } };
    const expected = analyze(pseudonymize(original));
    const dataset = datasets.find(d => d.merchant.id === original.merchant.id);
    const got = dataset ? analyze(dataset) : undefined;
    check(`${file} batch decision`, !!expected.ok && !!got?.ok && got.result.fusion.decision === expected.result.fusion.decision);
  }
  if (prev === undefined) delete process.env.MRE_HASH_KEY;
  else process.env.MRE_HASH_KEY = prev;
  return bad;
}
