/** Deterministic batch scoring. timings live only in run.json, which callers may ignore. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapExport } from '../adapters/mapExport';
import { parseCsv, toCsv } from '../adapters/csv';
import { analyze, buildPack, FEATURE_COLUMNS, features, RULES } from '../engine/index';

const num = (n: number) => Number.isFinite(n) ? n.toFixed(12) : '';

export interface BatchOptions { inDir: string; mappingPath: string; outDir: string; key: Buffer; ml?: boolean }

export function runBatch(opts: BatchOptions): { merchants: number; opened: number } {
  const started = Date.now();
  const { datasets } = mapExport(opts.inDir, opts.mappingPath, opts.key);
  const header = [
    'merchant_id', 'name', 'mcc', 'decision', 'p_front', 'p_lo', 'p_hi', 'priority', 'recommended', 'mechanism', 'top_reasons', 'rules_version',
    ...(opts.ml ? ['ml_p', 'ml_top_drivers'] : []),
  ];
  const scoreRows: (string | number | null)[][] = [header];
  const featLines: string[] = [`merchant_id,${FEATURE_COLUMNS.join(',')}`];
  const cases: string[] = [];
  mkdirSync(join(opts.outDir, 'packs'), { recursive: true });
  let opened = 0;
  for (const dataset of datasets) {
    const ran = analyze(dataset);
    if (!ran.ok) {
      scoreRows.push([dataset.merchant.id, dataset.merchant.name, dataset.merchant.mcc, 'ERROR', '', '', '', '', '', '', ran.errors.join(' | '), RULES.version, ...(opts.ml ? ['', ''] : [])]);
      continue;
    }
    if (opts.ml) {
      const feat = features(ran.result);
      featLines.push([dataset.merchant.id, ...FEATURE_COLUMNS.map(c => feat[c])].join(','));
    }
    const f = ran.result.fusion;
    const fired = ran.result.evidence.filter(e => e.status === 'ILLICIT').sort((a, b) => b.llr - a.llr || a.id.localeCompare(b.id)).slice(0, 3);
    const top = fired.map(e => `${e.id}: ${e.observed}`).join(' | ');
    const mechanism = [...f.mechanisms].sort((a, b) => b.score - a.score)[0]?.id ?? '';
    scoreRows.push([
      dataset.merchant.id, dataset.merchant.name, dataset.merchant.mcc, f.decision,
      num(f.posterior), num(f.posteriorCi[0]), num(f.posteriorCi[1]), f.priority, f.decisionAnalysis.recommended,
      mechanism, top, f.rulesVersion,
      ...(opts.ml ? ['', ''] : []),
    ]);
    const safe = dataset.merchant.id.replace(/[^A-Za-z0-9._-]/g, '_');
    writeFileSync(join(opts.outDir, 'packs', `${safe}.json`), JSON.stringify(buildPack(ran.result, {
      caseId: null, createdAt: new Date(0).toISOString(), datasetSha256: createHash('sha256').update(JSON.stringify(dataset.merchant.id)).digest('hex'),
      generatedBy: null, engineVersion: RULES.version,
    })));
    if (f.decision === 'OPEN_CASE') {
      opened++;
      cases.push(JSON.stringify({
        merchantId: dataset.merchant.id,
        posterior: f.posterior,
        ci: f.posteriorCi,
        recommended: f.decisionAnalysis.recommended,
        gateReason: f.gateReason,
        fired: fired.map(e => ({ id: e.id, name: e.name, observed: e.observed, llr: e.llr })),
      }));
    }
  }
  if (opts.ml && featLines.length > 1) {
    const featPath = join(opts.outDir, '_features.tmp.csv');
    const mlOutPath = join(opts.outDir, '_ml_scores.tmp.csv');
    writeFileSync(featPath, featLines.join('\n') + '\n');
    const py = existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python3';
    try {
      execFileSync(py, ['-m', 'ml.score', '--features', featPath, '--model', 'ml/models/m1-v0', '--out', mlOutPath], { stdio: 'ignore' });
      const parsed = parseCsv(readFileSync(mlOutPath, 'utf8'));
      const byId = new Map<string, { p: string; drivers: string }>();
      for (const r of parsed.slice(1)) {
        if (r[0]) byId.set(r[0], { p: r[2] ?? '', drivers: r[3] ?? '' });
      }
      for (let i = 1; i < scoreRows.length; i++) {
        const id = String(scoreRows[i][0]);
        const hit = byId.get(id);
        if (hit) {
          scoreRows[i][scoreRows[i].length - 2] = hit.p;
          scoreRows[i][scoreRows[i].length - 1] = hit.drivers;
        }
      }
    } catch { /* fallback: keep empty ml columns if python unavailable */ }
  }
  writeFileSync(join(opts.outDir, 'scores.csv'), toCsv(scoreRows));
  writeFileSync(join(opts.outDir, 'cases.jsonl'), cases.join('\n') + (cases.length ? '\n' : ''));
  const inputSha256: Record<string, string> = {};
  for (const name of readdirSync(opts.inDir)) {
    const p = join(opts.inDir, name);
    try { inputSha256[name] = createHash('sha256').update(readFileSync(p)).digest('hex'); } catch { /* skip dirs */ }
  }
  const finished = Date.now();
  writeFileSync(join(opts.outDir, 'run.json'), JSON.stringify({
    rulesVersion: RULES.version,
    mapping: opts.mappingPath,
    inputSha256,
    merchants: datasets.length,
    opened,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    msTotal: finished - started,
  }, null, 2));
  return { merchants: datasets.length, opened };
}
