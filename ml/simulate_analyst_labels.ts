/**
 * Continuous-learning experiment, step 1: analysts meet a fraud pattern and label cases through the real workflow.
 *
 *   MRE_DB_FILE=<scratch .db> npx tsx ml/simulate_analyst_labels.ts [kind] [labelled-per-class] [eval-per-class]
 *
 * Every case is opened with openInvestigation and labelled with labelInvestigation: an analyst proposes, a different
 * reviewer confirms (the two-person rule). Nothing is written into the label table directly. A separate, fresh batch of
 * the same pattern is written to ml/data/eval_new_pattern.csv so the effect can be measured on merchants no one labelled.
 *
 * It refuses to run against the default case database: it must be pointed at a scratch file.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dbFile = process.env.MRE_DB_FILE;
if (!dbFile || resolve(dbFile) === resolve('backend/data/mre.db')) {
  console.error('Set MRE_DB_FILE to a scratch database. This script never touches backend/data/mre.db.');
  process.exit(2);
}

const { createUser } = await import('../backend/src/auth');
const { labelInvestigation, openInvestigation } = await import('../backend/src/workflow');
const { analyze, behavioralFeatures, features } = await import('../engine/index');
const { FRONTS, HONEST, makeMerchant } = await import('../engine/synthetic');

const kindName = process.argv[2] ?? 'small side-stream';
const nLabel = Number(process.argv[3] ?? 40);
const nEval = Number(process.argv[4] ?? 60);
const kind = FRONTS.find(k => k.name === kindName);
if (!kind) { console.error(`Unknown fraud kind "${kindName}". Options: ${FRONTS.map(k => k.name).join(', ')}`); process.exit(2); }

const pw = () => randomBytes(18).toString('base64url');
const analyst = createUser(`sim-analyst-${randomBytes(3).toString('hex')}`, pw(), 'analyst');
const reviewer = createUser(`sim-reviewer-${randomBytes(3).toString('hex')}`, pw(), 'reviewer');

function honestKind(i: number) { return HONEST[i % HONEST.length]; }

let labelled = 0, proposedThenConfirmed = 0, failures = 0;
function labelCase(id: string, label: 'CONFIRMED_ILLICIT' | 'ADJUDICATED_BENIGN') {
  let r = labelInvestigation(id, { label }, analyst);
  if (r.status !== 200) { failures++; console.error(`propose failed ${id}: ${JSON.stringify(r.body).slice(0, 200)}`); return; }
  const pending = (r.body as { user?: { label?: string } }).user?.label !== label;
  if (pending) {
    r = labelInvestigation(id, { label }, reviewer);
    if (r.status !== 200) { failures++; console.error(`confirm failed ${id}: ${JSON.stringify(r.body).slice(0, 200)}`); return; }
    proposedThenConfirmed++;
  }
  labelled++;
}

for (let i = 0; i < nLabel; i++) {
  for (const [k, label] of [[kind, 1], [honestKind(i), 0]] as const) {
    const m = makeMerchant(k, label, { id: `SIM-L-${label}-${i}`, seed: 90_000 + i * 2 + label });
    const opened = openInvestigation(m.dataset, analyst);
    if (opened.status !== 200) { failures++; console.error(`open failed: ${JSON.stringify(opened.body).slice(0, 200)}`); continue; }
    labelCase(String(opened.body.id), label ? 'CONFIRMED_ILLICIT' : 'ADJUDICATED_BENIGN');
  }
}

// A fresh batch nobody labelled, for measuring whether the labels taught the model the pattern.
const rows: string[] = [];
let cols: string[] = [];
for (let i = 0; i < nEval; i++) {
  for (const [k, label] of [[kind, 1], [honestKind(i + 7), 0]] as const) {
    const m = makeMerchant(k, label, { id: `SIM-E-${label}-${i}`, seed: 190_000 + i * 2 + label });
    const r = analyze(m.dataset);
    if (!r.ok) continue;
    const f = { ...features(r.result), ...behavioralFeatures(r.result) };
    if (!cols.length) cols = Object.keys(f);
    rows.push([m.dataset.merchant.id, label, JSON.stringify(m.kind), ...cols.map(c => f[c] ?? 0)].join(','));
  }
}
const out = join(import.meta.dirname, 'data');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'eval_new_pattern.csv'), [['merchant_id', 'label', 'kind', ...cols].join(','), ...rows].join('\n') + '\n');

console.log(`Pattern "${kindName}": ${labelled} cases labelled through the workflow (${proposedThenConfirmed} needed a second reviewer), ${failures} failures.`);
console.log(`Wrote ${rows.length} fresh, unlabelled merchants to ml/data/eval_new_pattern.csv.`);
