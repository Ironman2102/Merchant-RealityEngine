/** Merchant Reality Engine command line. */
import { parseArgs } from 'node:util';
import { loadHashKey } from '../adapters/pseudonym';
import { runBatch } from './batch';

const [cmd, ...rest] = process.argv.slice(2);
const later = new Set(['features', 'serve', 'demo', 'validate-config', 'verify-audit', 'user:add', 'key:create']);

if (!cmd || cmd === '--help') {
  console.log('mre batch | features | serve | demo | validate-config | verify-audit | user:add | key:create');
  process.exit(cmd ? 0 : 2);
}

if (cmd === 'batch') {
  const { values } = parseArgs({
    args: rest,
    options: { in: { type: 'string' }, mapping: { type: 'string' }, out: { type: 'string' }, ml: { type: 'boolean' } },
    strict: true,
  });
  if (!values.in || !values.mapping || !values.out) { console.error('mre batch --in <dir> --mapping <file> --out <dir>'); process.exit(2); }
  if (values.ml) console.error('mre batch --ml is not implemented yet');
  let key: Buffer;
  try { key = loadHashKey(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
  const { merchants, opened } = runBatch({ inDir: values.in, mappingPath: values.mapping, outDir: values.out, key });
  console.log(`scored ${merchants} merchants, opened ${opened}`);
} else if (later.has(cmd)) {
  console.error(`mre ${cmd} is not implemented yet`);
  process.exit(2);
} else {
  console.error(`unknown command ${cmd}`);
  process.exit(2);
}
