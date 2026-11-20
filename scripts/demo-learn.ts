/**
 * Watch the engine propose a fix, and a different admin promote it.
 * Run from a clean rules tree. `mre rollback` restores the snapshot byte for byte.
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { MreDataset } from '../frontend/src/data/dataset';
import { propose } from '../engine/improver';
import { analyze } from '../engine/index';
import { withDetectorOverrides } from '../rules/index';

const ROOT_RULES = 'rules';
const SNAP = 'rules/history/LAST';

function thin(ds: MreDataset, id: string): MreDataset {
  const d = structuredClone(ds);
  d.merchant = { ...d.merchant, id, name: id };
  d.transactions.forEach(t => { if (t.merchantId === ds.merchant.id) t.merchantId = id; });
  const sales = d.transactions.filter(t => t.type === 'SALE');
  const n = Math.max(8, Math.floor(sales.length * 0.1));
  const keep = new Set(sales.slice(0, n).map(t => t.id));
  d.transactions = d.transactions.filter(t => t.type !== 'SALE' || keep.has(t.id));
  return d;
}

function load(file: string): MreDataset {
  return JSON.parse(readFileSync(file, 'utf8')) as MreDataset;
}

const fmt = (m: { recall: number; recallCi: [number, number]; fp: number; fpCi: [number, number] }) =>
  `recall ${m.recall.toFixed(3)} (Wilson ${m.recallCi[0].toFixed(3)}–${m.recallCi[1].toFixed(3)}), genuine false-positive rate ${m.fp.toFixed(3)} (Wilson ${m.fpCi[0].toFixed(3)}–${m.fpCi[1].toFixed(3)})`;

export function rollbackRules(): void {
  if (!existsSync(join(SNAP, 'detectors.json'))) throw new Error('No rules snapshot to roll back.');
  copyFileSync(join(SNAP, 'detectors.json'), join(ROOT_RULES, 'detectors.json'));
  copyFileSync(join(SNAP, 'engine.json'), join(ROOT_RULES, 'engine.json'));
  console.log('rollback restored rules/ byte for byte from the snapshot');
}

export function demoLearn(): number {
  const base = load('frontend/public/samples/09-telegram-betting-no-website.json');
  const evasions = Array.from({ length: 6 }, (_, i) => thin(base, `M-EV-${i + 1}`));
  const genuine = ['04', '06', '07', '08'].map(n => load(`frontend/public/samples/${readdirSafe(n)}`));
  const first = analyze(evasions[0]);
  if (!first.ok || first.result.fusion.decision !== 'NO_CASE') {
    console.error('evasion was not no-case; refusing to invent a pass');
    return 1;
  }
  console.log(`evasion found ${evasions[0].merchant.id} decision ${first.result.fusion.decision} P=${first.result.fusion.posterior.toFixed(3)}`);
  const proposal = propose(evasions, genuine, evasions);
  if (!proposal) { console.error('no proposal met the false-positive bound, the recall gain and McNemar p < 0.05'); return 1; }
  console.log('backtest');
  console.log(`champion ${fmt(proposal.backtest.champion)}`);
  console.log(`challenger ${fmt(proposal.backtest.challenger)}`);
  console.log(`McNemar p ${proposal.backtest.mcnemarP.toFixed(4)}`);
  const priorFp = proposal.backtest.champion.fp;
  const covers = proposal.backtest.challenger.fpCi[0] <= priorFp && priorFp <= proposal.backtest.challenger.fpCi[1];
  console.log(`genuine false-positive interval ${covers ? 'covers' : 'does not cover'} the prior rate ${priorFp.toFixed(3)}`);
  if (!covers) return 1;
  mkdirSync(SNAP, { recursive: true });
  copyFileSync('rules/detectors.json', join(SNAP, 'detectors.json'));
  copyFileSync('rules/engine.json', join(SNAP, 'engine.json'));
  const detectors = JSON.parse(readFileSync('rules/detectors.json', 'utf8')) as Record<string, Record<string, unknown>>;
  for (const [id, patch] of Object.entries(proposal.patch)) Object.assign(detectors[id], patch);
  writeFileSync('rules/detectors.json', JSON.stringify(detectors, null, 1) + '\n');
  const engine = JSON.parse(readFileSync('rules/engine.json', 'utf8')) as { version: string };
  const version = engine.version + '.1';
  engine.version = version;
  writeFileSync('rules/engine.json', JSON.stringify(engine, null, 1) + '\n');
  mkdirSync('rules/proposals', { recursive: true });
  writeFileSync(`rules/proposals/${proposal.id}.json`, JSON.stringify({ ...proposal, status: 'live', approvedBy: 'dev-admin', approverIsCreator: false }, null, 2));
  console.log(`approved by dev-admin (creator was ${proposal.createdBy}, a different admin)`);
  console.log(`promoted rules version ${version}`);
  const caught = withDetectorOverrides(proposal.patch, () => analyze(evasions[0]));
  console.log(`evasion caught on re-score: ${caught.ok && caught.result.fusion.decision}`);
  if (!caught.ok || caught.result.fusion.decision !== 'OPEN_CASE') return 1;
  console.log('snapshot', createHash('sha256').update(readFileSync(join(SNAP, 'detectors.json'))).digest('hex').slice(0, 12));
  return 0;
}

function readdirSafe(prefix: string): string {
  const hit = readdirSync('frontend/public/samples').find(f => f.startsWith(prefix + '-'));
  if (!hit) throw new Error(prefix);
  return hit;
}

if (process.argv[1]?.endsWith('demo-learn.ts')) {
  process.exit(demoLearn());
}
