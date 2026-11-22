/** Deterministic batch scoring, under the same promoted rules and verified passports as the server. timings live only in run.json, which callers may ignore. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapExport } from '../adapters/mapExport';
import { toCsv } from '../adapters/csv';
import { analyseCanonical } from '../backend/src/algorithms/analyze';
import { syncLiveRules } from '../backend/src/rulesState';
import { buildPack, RULES } from '../engine/index';
import { secondOpinion } from '../engine/model';

const num = (n: number) => Number.isFinite(n) ? n.toFixed(12) : '';

export interface BatchOptions { /** Set when a service client runs it: only that client's passports and the operator's apply. */ client?: string; inDir: string; mappingPath: string; outDir: string; key: Buffer; ml?: boolean }

export function runBatch(opts: BatchOptions): { merchants: number; opened: number; failed: number } {
  const started = Date.now();
  syncLiveRules();
  const { datasets, warnings } = mapExport(opts.inDir, opts.mappingPath, opts.key);
  const header = [
    'merchant_id', 'name', 'mcc', 'decision', 'p_front', 'p_lo', 'p_hi', 'priority', 'recommended', 'mechanism', 'top_reasons', 'rules_version', 'follow_up', 'scope', 'passport_answered',
    ...(opts.ml ? ['ml_p', 'ml_top_drivers'] : []),
  ];
  const scoreRows: (string | number | null)[][] = [header];
  let failed = 0;
  const packNames = new Set<string>();
  const cases: string[] = [];
  mkdirSync(join(opts.outDir, 'packs'), { recursive: true });
  let opened = 0;
  for (const dataset of datasets) {
    const ran = analyseCanonical(dataset, opts.client);
    if (!ran.ok) {
      failed++;
      scoreRows.push([dataset.merchant.id, dataset.merchant.name, dataset.merchant.mcc, 'ERROR', '', '', '', '', '', '', ran.errors.join(' | '), RULES.version, '', '', '', ...(opts.ml ? ['', ''] : [])]);
      continue;
    }
    const ml = opts.ml ? secondOpinion(ran.result) : null;
    const f = ran.result.fusion;
    const fired = ran.result.evidence.filter(e => e.status === 'ILLICIT').sort((a, b) => b.llr - a.llr || a.id.localeCompare(b.id)).slice(0, 3);
    const top = fired.map(e => `${e.id}: ${e.observed}`).join(' | ');
    const mechanism = [...f.mechanisms].sort((a, b) => b.score - a.score)[0]?.id ?? '';
    scoreRows.push([
      dataset.merchant.id, dataset.merchant.name, dataset.merchant.mcc, f.decision,
      num(f.posterior), num(f.posteriorCi[0]), num(f.posteriorCi[1]), f.priority, ran.result.review.recommended,
      mechanism, top, f.rulesVersion, f.followUp, ran.result.scope.id, (ran.result.passportAnswered ?? []).join('|'),
      ...(ml ? [num(ml.p), ml.drivers.map(d => `${d.feature}:+${d.weight.toFixed(2)}`).join('|')] : []),
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
