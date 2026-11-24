/**
 * One-shot multi-dataset suspicion scanner with snapshot saving and before/after diffing.
 * Feeds an entire folder of `mre-dataset/v1` JSON files into the full 7-layer engine in one shot,
 * reports which shops have suspicion, ranks them through the Bayesian FDR portfolio queue, and
 * optionally saves a JSON snapshot (`--save <path>`) or compares against a prior run (`--compare <path>`).
 *
 * Run:
 *   npx tsx scripts/oneshot-report.ts [--dir tests/datasets] [--save reports/oneshot-baseline.json] [--compare reports/oneshot-baseline.json]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { analyzeDataset } from '../backend/src/algorithms/analyze';
import { scorePortfolio, type PortfolioRow } from '../engine/portfolio';
import { RULES } from '../rules/index';

interface SavedRow {
  file: string;
  merchantId: string;
  name: string;
  decision: string;
  priority: string;
  posterior: number;
  ci: [number, number];
  action: string;
  mechanism: string;
  fired: string[];
  expectedDecision?: string;
}

interface SavedSnapshot {
  generatedAt: string;
  rulesVersion: string;
  dir: string;
  summary: { total: number; suspicious: number; cleared: number; tp: number; fp: number; fn: number; tn: number; fdrOpened: number; expectedFalseAlarms: number };
  rows: SavedRow[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dir = arg('--dir') ?? 'tests/datasets';
const savePath = arg('--save');
const comparePath = arg('--compare');
const files = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'manifest.json').sort();
const manifestPath = join(dir, 'manifest.json');
const manifest = existsSync(manifestPath)
  ? new Map((JSON.parse(readFileSync(manifestPath, 'utf8')) as { file: string; expectedDecision: string }[]).map(m => [m.file, m]))
  : null;

const rows: PortfolioRow[] = [];
const savedRows: SavedRow[] = [];
const lines: string[] = [];
let tp = 0, fp = 0, fn = 0, tn = 0, errors = 0;

for (const file of files) {
  const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const ran = analyzeDataset(raw);
  if (!ran.ok) {
    errors++;
    lines.push(`ERROR | ${file} | ${ran.errors.join('; ')}`);
    continue;
  }
  const res = ran.result;
  const f = res.fusion;
  const expected = manifest?.get(file)?.expectedDecision;
  if (expected) {
    if (f.decision === 'OPEN_CASE' && expected === 'OPEN_CASE') tp++;
    else if (f.decision === 'OPEN_CASE' && expected === 'NO_CASE') fp++;
    else if (f.decision === 'NO_CASE' && expected === 'OPEN_CASE') fn++;
    else tn++;
  }
  const firedList = res.evidence.filter(e => e.status === 'ILLICIT').map(e => e.id);
  const fired = firedList.join(',') || 'none';
  const mech = f.mechanisms[0]?.id ?? '—';
  const act = res.review.recommended;
  const ci = `[${f.posteriorCi[0].toFixed(4)}, ${f.posteriorCi[1].toFixed(4)}]`;
  const tag = f.decision === 'OPEN_CASE' ? 'SUSPICIOUS' : 'CLEAR     ';
  const match = expected ? (f.decision === expected ? 'OK' : `MISMATCH(want ${expected})`) : '';
  lines.push(`${tag} | ${file.padEnd(46)} | ${f.priority.padEnd(6)} | P=${f.posterior.toFixed(4)} ${ci} | ${act} | ${mech.padEnd(22)} | ${fired} ${match}`);
  rows.push({
    merchantId: res.scenario.profile.id,
    name: res.scenario.profile.name,
    posterior: f.posterior,
    ci: f.posteriorCi,
    expectedLoss: f.decisionAnalysis.actions.find(a => a.level === act)?.expectedLoss ?? 0,
    action: act,
    decision: f.decision,
  });
  savedRows.push({
    file,
    merchantId: res.scenario.profile.id,
    name: res.scenario.profile.name,
    decision: f.decision,
    priority: f.priority,
    posterior: f.posterior,
    ci: f.posteriorCi,
    action: act,
    mechanism: mech,
    fired: firedList,
    ...(expected ? { expectedDecision: expected } : {}),
  });
}

const fdr = scorePortfolio(rows, RULES.engine.portfolio.fdrQ);
const suspicious = rows.filter(r => r.decision === 'OPEN_CASE');
const snapshot: SavedSnapshot = {
  generatedAt: new Date().toISOString(),
  rulesVersion: RULES.version,
  dir,
  summary: {
    total: files.length,
    suspicious: suspicious.length,
    cleared: rows.length - suspicious.length,
    tp, fp, fn, tn,
    fdrOpened: fdr.opened,
    expectedFalseAlarms: fdr.expectedFalseAlarms,
  },
  rows: savedRows,
};

console.log(`\nOne-Shot Multi-Shop Suspicion Scan (${files.length} datasets from ${dir}, rules=${RULES.version})\n`);
console.log(lines.join('\n'));
console.log(`\nFlagged suspicious: ${suspicious.length}/${files.length} shops | Cleared: ${rows.length - suspicious.length}/${files.length} | Parse errors: ${errors}`);
console.log(`Bayesian FDR queue (q=${RULES.engine.portfolio.fdrQ}): opened=${fdr.opened}, expectedFalseAlarms=${fdr.expectedFalseAlarms.toFixed(3)}`);
if (manifest) {
  console.log(`Confusion vs manifest: TP=${tp} FP=${fp} FN=${fn} TN=${tn} | Recall=${(tp / Math.max(1, tp + fn)).toFixed(3)} Precision=${(tp / Math.max(1, tp + fp)).toFixed(3)}`);
}

if (savePath) {
  mkdirSync(dirname(savePath), { recursive: true });
  writeFileSync(savePath, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`\nSaved run snapshot -> ${savePath}`);
}

if (comparePath) {
  const prev = JSON.parse(readFileSync(comparePath, 'utf8')) as SavedSnapshot;
  const prevByFile = new Map(prev.rows.map(r => [r.file, r]));
  const diffs: string[] = [];
  for (const cur of savedRows) {
    const old = prevByFile.get(cur.file);
    if (!old) { diffs.push(`NEW     | ${cur.file} | ${cur.decision} P=${cur.posterior.toFixed(4)}`); continue; }
    const decChanged = old.decision !== cur.decision;
    const actChanged = old.action !== cur.action;
    const pDelta = cur.posterior - old.posterior;
    const firedChanged = old.fired.join(',') !== cur.fired.join(',');
    if (decChanged || actChanged || Math.abs(pDelta) >= 0.005 || firedChanged) {
      diffs.push(`${cur.file} | decision: ${old.decision} -> ${cur.decision} | P: ${old.posterior.toFixed(4)} -> ${cur.posterior.toFixed(4)} (${pDelta >= 0 ? '+' : ''}${pDelta.toFixed(4)}) | act: ${old.action} -> ${cur.action} | fired: [${old.fired.join(',')}] -> [${cur.fired.join(',')}]`);
    }
  }
  console.log(`\nComparison vs ${comparePath} (${prev.generatedAt}, rules=${prev.rulesVersion}):`);
  console.log(`  Prev: TP=${prev.summary.tp} FP=${prev.summary.fp} FN=${prev.summary.fn} TN=${prev.summary.tn}`);
  console.log(`  Curr: TP=${tp} FP=${fp} FN=${fn} TN=${tn}`);
  if (diffs.length === 0) console.log('  No score/decision deltas >= 0.005.');
  else diffs.forEach(d => console.log('  * ' + d));
}
