/** Merchant Reality Engine command line. */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { loadHashKey } from '../adapters/pseudonym';
import { mapExport } from '../adapters/mapExport';
import { createUser, ROLES, type Role } from '../backend/src/auth';
import { createServiceKey } from '../backend/src/serviceKeys';
import { verifyAudit } from '../backend/src/store';
import { openInvestigation } from '../backend/src/workflow';
import { analyze, FEATURE_COLUMNS, features } from '../engine/index';
import { loadWorkflow, validateWorkflow } from '../engine/workflowConfig';
import { demoLearn } from '../scripts/demo-learn';
import { rollbackRulesLive } from '../backend/src/improverApi';
import { runBatch } from './batch';

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === '--help') {
  console.log('mre batch | features | serve | demo | demo:learn | rollback | validate-config | verify-audit | user:add | key:create');
  process.exit(cmd ? 0 : 2);
}

if (cmd === 'batch') {
  const { values } = parseArgs({
    args: rest,
    options: { in: { type: 'string' }, mapping: { type: 'string' }, out: { type: 'string' }, ml: { type: 'boolean' } },
    strict: true,
  });
  if (!values.in || !values.mapping || !values.out) { console.error('mre batch --in <dir> --mapping <file> --out <dir> [--ml]'); process.exit(2); }
  let key: Buffer;
  try { key = loadHashKey(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
  const { merchants, opened } = runBatch({ inDir: values.in, mappingPath: values.mapping, outDir: values.out, key, ml: !!values.ml });
  console.log(`scored ${merchants} merchants, opened ${opened}${values.ml ? ' (with ML second opinion)' : ''}`);
} else if (cmd === 'features') {
  const { values } = parseArgs({
    args: rest,
    options: { in: { type: 'string' }, mapping: { type: 'string' }, labels: { type: 'string' }, out: { type: 'string' } },
    strict: true,
  });
  if (!values.in || !values.mapping || !values.labels || !values.out) {
    console.error('mre features --in <dir> --mapping <file> --labels <truth.csv> --out <csv>');
    process.exit(2);
  }
  const truth = new Map<string, number>();
  for (const line of readFileSync(values.labels, 'utf8').trim().split('\n').slice(1)) {
    const [id, label] = line.split(',');
    if (id) truth.set(id.trim(), Number(label));
  }
  const { datasets } = mapExport(values.in, values.mapping, loadHashKey());
  const lines = [`merchant_id,label,${FEATURE_COLUMNS.join(',')}`];
  for (const d of datasets) {
    const ran = analyze(d);
    if (!ran.ok) continue;
    const row = features(ran.result);
    const label = truth.get(d.merchant.id) ?? 0;
    lines.push([d.merchant.id, label, ...FEATURE_COLUMNS.map(c => row[c])].join(','));
  }
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, lines.join('\n') + '\n');
  console.log(`wrote ${lines.length - 1} feature rows to ${values.out}`);
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
} else if (cmd === 'serve') {
  const i = rest.indexOf('--port');
  const child = spawn(process.execPath, ['--import', 'tsx', 'backend/src/server.ts'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: i >= 0 ? rest[i + 1] : (process.env.PORT || '8787') },
  });
  child.on('exit', code => process.exit(code ?? 0));
} else if (cmd === 'demo') {
  const { ensureDevUsers } = await import('../scripts/dev-users');
  const analyst = ensureDevUsers();
  const showcase = [
    'frontend/public/samples/01-sweet-crumbs-betting-front.json',
    'frontend/public/samples/09-telegram-betting-no-website.json',
    'frontend/public/samples/04-anand-sweets-diwali-genuine.json',
  ];
  for (const file of showcase) {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const res = openInvestigation(raw, analyst);
    if (res.status === 200) {
      console.log(`seeded case ${res.body.id} (${(res.body.merchant as { name: string }).name}) → ${(res.body.result as { decision: string }).decision}`);
    }
  }
  console.log('demo ready: run `npm run mre -- serve` (http://127.0.0.1:8787) or `npm run dev` (http://localhost:5173)');
} else if (cmd === 'demo:learn') {
  process.exit(demoLearn());
} else if (cmd === 'rollback') {
  rollbackRulesLive({ id: 0, username: 'cli-operator', role: 'admin' });
  console.log('live rules rolled back to the committed base; the step is in the rules audit');
} else if (cmd === 'verify-audit') {
  const { values } = parseArgs({ args: rest, options: { case: { type: 'string' } }, strict: true });
  if (!values.case) { console.error('mre verify-audit --case <INV-id>'); process.exit(2); }
  const status = verifyAudit(values.case);
  console.log(JSON.stringify(status));
  process.exit(status.ok ? 0 : 1);
} else if (cmd === 'user:add') {
  const username = rest[0], role = rest[1] as Role;
  if (!username || !ROLES.includes(role)) { console.error(`mre user:add <username> <${ROLES.join('|')}>`); process.exit(2); }
  const password = randomBytes(15).toString('base64url');
  const actor = createUser(username, password, role);
  console.log(`created ${actor.username} (${actor.role}) password: ${password}`);
} else if (cmd === 'key:create') {
  const name = rest[0], scopes = (rest[1] ?? '').split(',').filter(Boolean);
  if (!name || !scopes.length) { console.error('mre key:create <name> <scopes,comma>'); process.exit(2); }
  try {
    const made = createServiceKey(name, scopes);
    console.log(made.key);
  } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
} else {
  console.error(`unknown command ${cmd}`);
  process.exit(2);
}
