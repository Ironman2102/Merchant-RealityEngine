/** Merchant Reality Engine command line. */
import { parseArgs } from 'node:util';
import { loadHashKey } from '../adapters/pseudonym';
import { mapExport } from '../adapters/mapExport';
import { createServiceKey } from '../backend/src/serviceKeys';
import { analyze } from '../engine/index';
import { loadWorkflow, validateWorkflow } from '../engine/workflowConfig';
import { runBatch } from './batch';

const [cmd, ...rest] = process.argv.slice(2);
const later = new Set(['features', 'serve', 'demo', 'verify-audit', 'user:add']);

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
} else if (cmd === 'validate-config') {
  const { values } = parseArgs({
    args: rest,
    options: { workflow: { type: 'string' }, mapping: { type: 'string' }, in: { type: 'string' } },
    strict: true,
  });
  if (!values.workflow || !values.mapping || !values.in) { console.error('mre validate-config --workflow <dir> --mapping <file> --in <dir>'); process.exit(2); }
  try {
    const cfg = loadWorkflow(values.workflow);
    const errors = validateWorkflow(cfg);
    if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
    const { datasets, warnings } = mapExport(values.in, values.mapping, loadHashKey());
    const sample = datasets.slice(0, 3);
    let opened = 0;
    for (const d of sample) {
      const ran = analyze(d);
      if (!ran.ok) { console.error(ran.errors.join(' ')); process.exit(1); }
      if (ran.result.fusion.decision === 'OPEN_CASE') opened++;
      console.log(`${d.merchant.id} ${ran.result.fusion.decision} P=${ran.result.fusion.posterior.toFixed(4)}`);
    }
    if (warnings.length) console.log(`${warnings.length} mapping warnings`);
    console.log(`workflow ${cfg.responses.map(r => r.id).join(', ')} · ${sample.length} merchants · ${opened} cases`);
  } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
} else if (cmd === 'key:create') {
  const name = rest[0], scopes = (rest[1] ?? '').split(',').filter(Boolean);
  if (!name || !scopes.length) { console.error('mre key:create <name> <scopes,comma>'); process.exit(2); }
  try {
    const made = createServiceKey(name, scopes);
    console.log(made.key);
  } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
} else if (later.has(cmd)) {
  console.error(`mre ${cmd} is not implemented yet`);
  process.exit(2);
} else {
  console.error(`unknown command ${cmd}`);
  process.exit(2);
}
