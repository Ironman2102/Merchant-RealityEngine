/** Deterministic batch scoring, under the same promoted rules and verified passports as the server. timings live only in run.json, which callers may ignore. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapExport } from '../adapters/mapExport';
import { scrub } from '../adapters/privacy';
import { parseCsv, toCsv } from '../adapters/csv';
import { analyseCanonical } from '../backend/src/algorithms/analyze';
import { syncLiveRules } from '../backend/src/rulesState';
import { buildPack, MODEL_FEATURE_COLUMNS, modelFeatures, RULES } from '../engine/index';

const num = (n: number) => Number.isFinite(n) ? n.toFixed(12) : '';

export interface BatchOptions { /** Set when a service client runs it: only that client's passports and the operator's apply. */ client?: string; inDir: string; mappingPath: string; outDir: string; key: Buffer; ml?: boolean }

export function runBatch(opts: BatchOptions): { merchants: number; opened: number; failed: number } {
  const started = Date.now();
  syncLiveRules();
  const { datasets, warnings, skipped, core } = mapExport(opts.inDir, opts.mappingPath, opts.key);
  const header = [
    'merchant_id', 'name', 'mcc', 'decision', 'p_front', 'p_lo', 'p_hi', 'priority', 'recommended', 'mechanism', 'top_reasons', 'rules_version', 'follow_up', 'scope', 'passport_answered', 'rows_skipped', 'context_ignored',
    ...(opts.ml ? ['ml_p', 'ml_top_drivers'] : []),
  ];
  const scoreRows: (string | number | null)[][] = [header];
  const featLines: string[] = [`merchant_id,${MODEL_FEATURE_COLUMNS.join(',')}`];
  let failed = 0;
  const packNames = new Set<string>();
  const cases: string[] = [];
  mkdirSync(join(opts.outDir, 'packs'), { recursive: true });
  let opened = 0;
  for (const mapped of datasets) {
    let dataset = mapped, contextIgnored = false;
    let ran = analyseCanonical(dataset, opts.client);
    if (!ran.ok && core.has(mapped)) {
      const plain = core.get(mapped)!(), again = analyseCanonical(plain, opts.client);
      if (again.ok) {
        warnings.push(`merchant ${mapped.merchant.id}: its context.json entry could not be used (${scrub(ran.errors.join(' '), () => opts.key)}). Scored from the CSVs alone.`);
        dataset = plain; ran = again; contextIgnored = true;
      }
    }
    const rowsSkipped = skipped.get(mapped.merchant.id) ?? 0;
    if (!ran.ok) {
      failed++;
      scoreRows.push([dataset.merchant.id, dataset.merchant.name, dataset.merchant.mcc, 'ERROR', '', '', '', '', '', '', scrub(ran.errors.join(' | '), () => opts.key), RULES.version, '', '', '', rowsSkipped, '', ...(opts.ml ? ['', ''] : [])]);
      continue;
    }
    if (opts.ml) {
      const feat = modelFeatures(ran.result);
      featLines.push([dataset.merchant.id, ...MODEL_FEATURE_COLUMNS.map(c => feat[c])].join(','));
    }
    const f = ran.result.fusion;
    const fired = ran.result.evidence.filter(e => e.status === 'ILLICIT').sort((a, b) => b.llr - a.llr || a.id.localeCompare(b.id)).slice(0, 3);
    const top = fired.map(e => `${e.id}: ${e.observed}`).join(' | ');
    const mechanism = [...f.mechanisms].sort((a, b) => b.score - a.score)[0]?.id ?? '';
    scoreRows.push([
      dataset.merchant.id, dataset.merchant.name, dataset.merchant.mcc, f.decision,
      num(f.posterior), num(f.posteriorCi[0]), num(f.posteriorCi[1]), f.priority, ran.result.review.recommended,
      mechanism, top, f.rulesVersion, f.followUp, ran.result.scope.id, (ran.result.passportAnswered ?? []).join('|'), rowsSkipped, contextIgnored ? 'yes' : '',
      ...(opts.ml ? ['', ''] : []),
    ]);
    let safe = dataset.merchant.id.replace(/[^A-Za-z0-9._-]/g, '_');
    // Two ids can clean to one name, and some file systems ignore case. Neither may overwrite the other's evidence.
    while (packNames.has(safe.toLowerCase())) safe += `-${createHash('sha256').update(`${packNames.size}:${dataset.merchant.id}`).digest('hex').slice(0, 8)}`;
    packNames.add(safe.toLowerCase());
    writeFileSync(join(opts.outDir, 'packs', `${safe}.json`), JSON.stringify(buildPack(ran.result, {
      caseId: null, createdAt: new Date(started).toISOString(), datasetSha256: createHash('sha256').update(JSON.stringify(dataset)).digest('hex'),
      hashBasis: 'SHA-256 of this merchant\'s mapped, pseudonymised dataset (JSON). run.json holds the hashes of the raw export files.',
      generatedBy: null, engineVersion: RULES.version,
    })));
    if (f.decision === 'OPEN_CASE') {
      opened++;
      cases.push(JSON.stringify({
        merchantId: dataset.merchant.id,
        posterior: f.posterior,
        ci: f.posteriorCi,
        recommended: ran.result.review.recommended,
        scope: ran.result.scope,
        suspectLinks: ran.result.suspectLinks,
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
    failed,
    warningCount: warnings.length,
    warnings: warnings.slice(0, 1000),
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    msTotal: finished - started,
  }, null, 2));
  return { merchants: datasets.length, opened, failed };
}
