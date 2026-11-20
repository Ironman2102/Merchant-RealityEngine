/** Two PA layouts must score like the original sample after the same pseudonymisation. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCsv, toCsv } from '../../adapters/csv';
import { mapExport } from '../../adapters/mapExport';
import { pseudonymize } from '../../backend/src/adapters/canonicalDataset';
import { analyze } from '../../engine/index';
import { readdirSync, readFileSync } from 'node:fs';

const KEY = Buffer.from('adapter-test-key', 'utf8');

const SAMPLES = readdirSync('frontend/public/samples').filter(f => /^0[1-9]-/.test(f)).sort();

export default function (): number {
  const prev = process.env.MRE_HASH_KEY;
  process.env.MRE_HASH_KEY = 'adapter-test-key';
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); } else console.log(`  ✓ ${name}`); };

  const round = '"a,b","say ""hi""",plain,\r\n1,2,3,4\r\n';
  const parsed = parseCsv(round);
  check('csv quotes', parsed.length === 2 && parsed[0][0] === 'a,b' && parsed[0][1] === 'say "hi"' && parsed[0][2] === 'plain' && parsed[0][3] === '');
  check('csv numbers', parsed[1].join('|') === '1|2|3|4');
  const semi = parseCsv(toCsv([['a;b', 'c"d'], ['', 'z']], ';'), ';');
  check('csv semicolon round trip', semi[0][0] === 'a;b' && semi[0][1] === 'c"d' && semi[1][0] === '' && semi[1][1] === 'z');

  for (const file of SAMPLES) {
    const original = JSON.parse(readFileSync(`frontend/public/samples/${file}`, 'utf8')) as { merchant: { id: string }; transactions: { payerId?: string }[] };
    const expected = analyze(pseudonymize(original));
    check(`${file} original analyzes`, expected.ok);
    if (!expected.ok) continue;
    const rawIds = [...new Set(original.transactions.map(t => t.payerId).filter((x): x is string => !!x))];
    for (const layout of ['examples/generic-pa', 'examples/alt-pa'] as const) {
      const mapping = layout.endsWith('alt-pa') ? 'adapters/mappings/alt-pa-example.json' : 'adapters/mappings/generic-pa-v1.json';
      const { datasets, warnings } = mapExport(layout, mapping, KEY);
      const dataset = datasets.find(d => d.merchant.id === original.merchant.id);
      check(`${file} ${layout} present`, !!dataset, warnings.slice(0, 3).join('; '));
      if (!dataset) continue;
      const got = analyze(dataset);
      check(`${file} ${layout} analyzes`, got.ok, got.ok ? '' : got.errors.slice(0, 4).join('; '));
      if (!got.ok) continue;
      check(`${file} ${layout} decision`, got.result.fusion.decision === expected.result.fusion.decision, `${got.result.fusion.decision} vs ${expected.result.fusion.decision}`);
      check(`${file} ${layout} posterior`, Math.abs(got.result.fusion.posterior - expected.result.fusion.posterior) <= 1e-9,
        `${got.result.fusion.posterior} vs ${expected.result.fusion.posterior}`);
      const blob = JSON.stringify(dataset);
      check(`${file} ${layout} no raw payer`, rawIds.every(id => !blob.includes(id)));
    }
  }

  const dir = mkdtempSync(join(tmpdir(), 'mre-csv-'));
  writeFileSync(join(dir, 'note.csv'), toCsv([['a', 'b,c'], ['1', '2']]));
  check('temp wrote', parseCsv(readFileSync(join(dir, 'note.csv'), 'utf8'))[0][1] === 'b,c');
  if (prev === undefined) delete process.env.MRE_HASH_KEY;
  else process.env.MRE_HASH_KEY = prev;
  return bad;
}
