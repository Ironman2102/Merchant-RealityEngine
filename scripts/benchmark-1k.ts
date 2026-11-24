/**
 * 1,200-case stress benchmark across:
 * - Bayesian Engine (all 25 detectors, fusion, CI containment, verifySummary, Bayesian FDR queue)
 * - Cross-merchant Ring Detector (`detectRings`)
 * - Behavioral & full feature export for ML dual-model evaluation (M1 LightGBM + NN MLP)
 *
 * Outputs detailed per-category, per-typology, per-MCC, and difficulty-tier metrics,
 * plus saves `reports/benchmark-1k-results.json` and `reports/benchmark-1k.md`.
 *
 * Run: npx tsx scripts/benchmark-1k.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeDataset } from '../backend/src/algorithms/analyze';
import { templateSummary, verifySummary } from '../backend/src/llm';
import { behavioralFeatures, BEHAVIORAL_FEATURE_COLUMNS, features, FEATURE_COLUMNS } from '../engine/features';
import { scorePortfolio, type PortfolioRow } from '../engine/portfolio';
import { detectRings } from '../engine/ringDetector';
import { buildTrace } from '../frontend/src/engines/traceEngine';
import type { Scenario } from '../frontend/src/types/merchant';
import { RULES } from '../rules/index';

interface ManifestRow {
  file: string;
  merchantId: string;
  mcc: string;
  kind: 'front' | 'genuine';
  category: string;
  typology: string;
  difficulty: 'standard' | 'hard';
}

interface StatBucket { n: number; tp: number; fp: number; fn: number; tn: number }

const t0 = Date.now();
const dir = 'tests/datasets-1k';
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as ManifestRow[];

const portfolioRows: PortfolioRow[] = [];
const scenariosForRings: Scenario[] = [];
const mlRows: string[] = [`merchant_id,label,${FEATURE_COLUMNS.join(',')},${BEHAVIORAL_FEATURE_COLUMNS.filter(c => !FEATURE_COLUMNS.includes(c)).join(',')}`];
const extraCols = BEHAVIORAL_FEATURE_COLUMNS.filter(c => !FEATURE_COLUMNS.includes(c));
const resultRows: Record<string, unknown>[] = [];

const byCategory = new Map<string, StatBucket>();
const byTypology = new Map<string, StatBucket>();
const byMcc = new Map<string, StatBucket>();
const byDifficulty = new Map<string, StatBucket>();

const bump = (map: Map<string, StatBucket>, key: string, kind: 'front' | 'genuine', open: boolean) => {
  const b = map.get(key) ?? { n: 0, tp: 0, fp: 0, fn: 0, tn: 0 };
  b.n++;
  if (kind === 'front' && open) b.tp++;
  else if (kind === 'front' && !open) b.fn++;
  else if (kind === 'genuine' && open) b.fp++;
  else b.tn++;
  map.set(key, b);
};

let parseErrors = 0, nanErrors = 0, ciViolations = 0, summaryFails = 0;
let tp = 0, fp = 0, fn = 0, tn = 0;

for (const m of manifest) {
  const raw = JSON.parse(readFileSync(join(dir, m.file), 'utf8'));
  const ran = analyzeDataset(raw);
  if (!ran.ok) { parseErrors++; continue; }

  const res = ran.result;
  const f = res.fusion;
  const open = f.decision === 'OPEN_CASE';
  if (!Number.isFinite(f.posterior) || res.evidence.some(e => !Number.isFinite(e.llr))) nanErrors++;
  if (!(f.posteriorCi[0] <= f.posterior + 1e-12 && f.posterior <= f.posteriorCi[1] + 1e-12)) ciViolations++;

  const trace = buildTrace(res);
  if (!verifySummary(templateSummary(trace), trace).ok) summaryFails++;

  if (m.kind === 'front' && open) tp++;
  else if (m.kind === 'front' && !open) fn++;
  else if (m.kind === 'genuine' && open) fp++;
  else tn++;

  bump(byCategory, `${m.kind.toUpperCase()}: ${m.category}`, m.kind, open);
  bump(byTypology, `${m.kind}: ${m.typology}`, m.kind, open);
  bump(byMcc, m.mcc, m.kind, open);
  bump(byDifficulty, `${m.kind} (${m.difficulty})`, m.kind, open);

  if (m.category === 'Rotation & Phoenix Fronts' || m.typology === 'clean-standard') {
    if (scenariosForRings.length < 150) scenariosForRings.push(res.scenario);
  }

  portfolioRows.push({
    merchantId: res.scenario.profile.id,
    name: res.scenario.profile.name,
    posterior: f.posterior,
    ci: f.posteriorCi,
    expectedLoss: f.decisionAnalysis.actions.find(a => a.level === res.review.recommended)?.expectedLoss ?? 0,
    action: res.review.recommended,
    decision: f.decision,
  });

  const feat = features(res);
  const bfeat = behavioralFeatures(res);
  const label = m.kind === 'front' ? 1 : 0;
  mlRows.push([
    m.merchantId,
    label,
    ...FEATURE_COLUMNS.map(c => feat[c]),
    ...extraCols.map(c => bfeat[c]),
  ].join(','));

  resultRows.push({
    file: m.file,
    merchantId: m.merchantId,
    kind: m.kind,
    category: m.category,
    typology: m.typology,
    difficulty: m.difficulty,
    mcc: m.mcc,
    decision: f.decision,
    posterior: f.posterior,
    ci: f.posteriorCi,
    action: res.review.recommended,
    fired: res.evidence.filter(e => e.status === 'ILLICIT').map(e => e.id),
  });
}

const fdr = scorePortfolio(portfolioRows, RULES.engine.portfolio.fdrQ);
const rings = detectRings(scenariosForRings);
const recall = tp / Math.max(1, tp + fn);
const precision = tp / Math.max(1, tp + fp);
const fpr = fp / Math.max(1, fp + tn);
const f1 = (2 * precision * recall) / Math.max(1e-12, precision + recall);
const elapsedSec = ((Date.now() - t0) / 1000).toFixed(2);

const fmtBucket = (k: string, b: StatBucket) => {
  const rate = b.tp + b.fn > 0
    ? `Recall=${(b.tp / (b.tp + b.fn)).toFixed(3)} (${b.tp}/${b.tp + b.fn})`
    : `FPR=${(b.fp / Math.max(1, b.fp + b.tn)).toFixed(3)} (${b.fp}/${b.fp + b.tn})`;
  return `| ${k} | ${b.n} | ${b.tp} | ${b.fp} | ${b.fn} | ${b.tn} | ${rate} |`;
};

const mdLines = [
  `# 1,200-Case Stress Benchmark Report`,
  ``,
  `- **Runtime:** ${elapsedSec}s for ${manifest.length} datasets (` + `rules=${RULES.version})`,
  `- **Confusion:** TP=${tp}, FP=${fp}, FN=${fn}, TN=${tn}`,
  `- **Metrics:** Recall=${recall.toFixed(4)}, Precision=${precision.toFixed(4)}, FPR=${fpr.toFixed(4)}, F1=${f1.toFixed(4)}`,
  `- **Bayesian FDR Queue (q=${RULES.engine.portfolio.fdrQ}):** opened=${fdr.opened}, expectedFalseAlarms=${fdr.expectedFalseAlarms.toFixed(2)}`,
  `- **Integrity:** parseErrors=${parseErrors}, nanErrors=${nanErrors}, ciViolations=${ciViolations}, verifySummaryFails=${summaryFails}`,
  `- **Cross-Merchant Ring Detector:** ${rings.rings.length} ring links across ${rings.linkedMerchantIds.length} linked merchants`,
  ``,
  `## By Difficulty`,
  `| Group | N | TP | FP | FN | TN | Rate |`,
  `|---|---:|---:|---:|---:|---:|---|`,
  ...[...byDifficulty.entries()].sort().map(([k, b]) => fmtBucket(k, b)),
  ``,
  `## By Category`,
  `| Category | N | TP | FP | FN | TN | Rate |`,
  `|---|---:|---:|---:|---:|---:|---|`,
  ...[...byCategory.entries()].sort().map(([k, b]) => fmtBucket(k, b)),
  ``,
  `## By Typology`,
  `| Typology | N | TP | FP | FN | TN | Rate |`,
  `|---|---:|---:|---:|---:|---:|---|`,
  ...[...byTypology.entries()].sort().map(([k, b]) => fmtBucket(k, b)),
  ``,
  `## By MCC`,
  `| MCC | N | TP | FP | FN | TN | Rate |`,
  `|---|---:|---:|---:|---:|---:|---|`,
  ...[...byMcc.entries()].sort().map(([k, b]) => fmtBucket(k, b)),
];

mkdirSync('reports', { recursive: true });
writeFileSync('reports/benchmark-1k.md', mdLines.join('\n') + '\n');
writeFileSync('reports/benchmark-1k-features.csv', mlRows.join('\n') + '\n');
writeFileSync('reports/benchmark-1k-results.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  rulesVersion: RULES.version,
  elapsedSec: Number(elapsedSec),
  summary: { total: manifest.length, tp, fp, fn, tn, recall, precision, fpr, f1, fdrOpened: fdr.opened, expectedFalseAlarms: fdr.expectedFalseAlarms, parseErrors, nanErrors, ciViolations, summaryFails, ringLinks: rings.rings.length },
  rows: resultRows,
}, null, 2) + '\n');

console.log(mdLines.join('\n'));
