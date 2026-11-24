/**
 * One-shot multi-dataset suspicion & full 7-layer (L1–L7) verification suite.
 * Loads all 24 synthetic merchants in `tests/datasets/` (15 distinct front typologies + 9 genuine shops),
 * verifies suspicion detection, portfolio FDR ranking, 100% detector coverage (all 25 detectors A1–K1),
 * and every layer L1 through L7 end-to-end.
 * Returns the number of failed assertions.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeDataset } from '../../backend/src/algorithms/analyze';
import { createUser } from '../../backend/src/auth';
import { resetDb } from '../../backend/src/db';
import { templateSummary, verifySummary } from '../../backend/src/llm';
import { verifyAudit } from '../../backend/src/store';
import { approveInvestigation, labelInvestigation, openInvestigation, respondInvestigation, reviewInvestigation } from '../../backend/src/workflow';
import { buildPack, features, FEATURE_COLUMNS } from '../../engine/index';
import { behavioralFeatures, BEHAVIORAL_FEATURE_COLUMNS } from '../../engine/features';
import { scorePortfolio, type PortfolioRow } from '../../engine/portfolio';
import { DETECTORS } from '../../frontend/src/engines/detectors';
import { actionLog, planResponse } from '../../frontend/src/engines/responseEngine';
import { buildTrace } from '../../frontend/src/engines/traceEngine';
import { RULES } from '../../rules/index';

interface ManifestEntry {
  file: string;
  merchantId: string;
  mcc: string;
  kind: 'front' | 'genuine';
  typology: string;
  expectedDecision: 'OPEN_CASE' | 'NO_CASE';
  expectedMechanism: string | null;
}

export default function (): number {
  const prevKey = process.env.MRE_HASH_KEY;
  const prevStore = process.env.MRE_CASE_STORE;
  process.env.MRE_HASH_KEY = 'one-shot-test-hash-key';
  process.env.MRE_CASE_STORE = 'memory';

  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); }
    else console.log(`  ✓ ${name}`);
  };

  try {
    const dir = 'tests/datasets';
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as ManifestEntry[];
    check('manifest contains 24 diverse datasets (15 fronts + 9 genuine)',
      manifest.length === 24 && manifest.filter(m => m.kind === 'front').length === 15 && manifest.filter(m => m.kind === 'genuine').length === 9);

    const portfolioRows: PortfolioRow[] = [];
    const detectorsFiredEver = new Set<string>();
    const rawDatasets = new Map<string, Record<string, unknown>>();

    // ==================== ONE-SHOT EVALUATION ACROSS ALL 24 DATASETS (L1–L6 + ML FEATURES) ====================
    for (const entry of manifest) {
      const raw = JSON.parse(readFileSync(join(dir, entry.file), 'utf8')) as Record<string, unknown>;
      rawDatasets.set(entry.file, raw);
      const ran = analyzeDataset(raw);
      check(`${entry.file}: L1 parse & analyze succeeds`, ran.ok, ran.ok ? '' : ran.errors.join('; '));
      if (!ran.ok) continue;

      const res = ran.result;
      const f = res.fusion;

      // L1: no raw payer PII in events or evidence pack
      const pack = buildPack(res, { caseId: null, createdAt: new Date(0).toISOString(), datasetSha256: '0'.repeat(64), generatedBy: null, engineVersion: f.rulesVersion });
      const packJson = JSON.stringify(pack);
      check(`${entry.file}: L1 pseudonymised (no raw CUST-/TG-DEP-/SPLIT-PAYER- in pack)`,
        !/CUST-|TG-DEP-|SPLIT-PAYER-|COHORT-P-|OTC-TRADER-/.test(packJson));

      // L2: finite weekly residuals & peak
      check(`${entry.file}: L2 volume rows & CUSUM finite`,
        res.l2.rows.length > 0 && res.l2.cusum.every(c => Number.isFinite(c.s)));

      // L3: all 25 detectors present; MISSING -> UNKNOWN/0; PARTIAL -> reliability 0.7
      check(`${entry.file}: L3 all 25 detectors emitted`, res.evidence.length === 25);
      for (const e of res.evidence) {
        if (e.status === 'ILLICIT') detectorsFiredEver.add(e.id);
        const hasMissing = e.requires.some(k => res.scenario.coverage[k] === 'MISSING');
        if (hasMissing && (e.status !== 'UNKNOWN' || e.llr !== 0)) {
          check(`${entry.file}: L3 ${e.id} MISSING feed stayed UNKNOWN`, false, `${e.status} ${e.llr}`);
        }
      }

      // L4: suspicion decision, CI bracketing, mechanism normalization
      const [lo, hi] = f.posteriorCi;
      const mechSum = Object.values(f.mechanismPosterior).reduce((s, v) => s + v, 0);
      check(`${entry.file}: L4 decision === ${entry.expectedDecision}`,
        f.decision === entry.expectedDecision,
        `got ${f.decision} P=${f.posterior.toFixed(4)} fired=[${res.evidence.filter(e => e.status === 'ILLICIT').map(e => e.id).join(',')}]`);
      check(`${entry.file}: L4 CI brackets posterior & mech sums to 1`,
        lo <= f.posterior + 1e-12 && f.posterior <= hi + 1e-12 && Math.abs(mechSum - 1) < 1e-12,
        `P=${f.posterior} CI=[${lo},${hi}] mechSum=${mechSum}`);
      if (entry.expectedMechanism) {
        check(`${entry.file}: L4 top mechanism === ${entry.expectedMechanism}`,
          f.mechanisms[0]?.id === entry.expectedMechanism,
          `got ${f.mechanisms[0]?.id}`);
      }

      // L5: trace waterfall + counterfactuals + VOI + summary verification
      const trace = buildTrace(res);
      const lastWf = trace.waterfall[trace.waterfall.length - 1];
      const summary = templateSummary(trace);
      check(`${entry.file}: L5 trace waterfall matches posterior & summary verifies`,
        Math.abs(lastWf.probability - f.posterior) < 1e-12 &&
        trace.valueOfInformation.every(v => v.voiRupees >= 0) &&
        verifySummary(summary, trace).ok);

      // L6: response ceiling & legal/label guardrails
      const autoPlan = planResponse(res, { chosenLevel: null, legalVerified: false, escrowConfirmed: false, label: 'UNRESOLVED', notes: '', clarification: '', executed: false, audit: [] });
      check(`${entry.file}: L6 auto recommendation obeys ceiling (${f.decision === 'OPEN_CASE' ? '<=L3' : '<=L1'})`,
        f.decision === 'OPEN_CASE' ? autoPlan.recommended <= 'L3' : autoPlan.recommended <= 'L1',
        autoPlan.recommended);

      // ML feature extraction parity
      const feat = features(res);
      const bfeat = behavioralFeatures(res);
      check(`${entry.file}: L7 ML feature vectors finite`,
        FEATURE_COLUMNS.every(c => Number.isFinite(feat[c])) &&
        BEHAVIORAL_FEATURE_COLUMNS.every(c => Number.isFinite(bfeat[c])));

      portfolioRows.push({
        merchantId: res.scenario.profile.id,
        name: res.scenario.profile.name,
        posterior: f.posterior,
        ci: f.posteriorCi,
        expectedLoss: f.decisionAnalysis.actions.find(a => a.level === res.review.recommended)?.expectedLoss ?? 0,
        action: res.review.recommended,
        decision: f.decision,
      });
    }

    // ==================== CROSS-PORTFOLIO COVERAGE & FDR QUEUE CHECKS ====================
    const missingDetectors = DETECTORS.map(d => d.id).filter(id => !detectorsFiredEver.has(id));
    check('all 25 detectors (A1..K1) fired across the 24-dataset test pack',
      missingDetectors.length === 0,
      `never fired: [${missingDetectors.join(', ')}]`);

    const fdr = scorePortfolio(portfolioRows, RULES.engine.portfolio.fdrQ);
    const frontIds = new Set(manifest.filter(m => m.kind === 'front').map(m => m.merchantId));
    const genuineIds = new Set(manifest.filter(m => m.kind === 'genuine').map(m => m.merchantId));
    const openedFronts = fdr.queue.filter(r => frontIds.has(r.merchantId)).length;
    const openedGenuine = fdr.queue.filter(r => genuineIds.has(r.merchantId)).length;
    check('one-shot portfolio FDR queue catches all 15 fronts with 0 genuine false positives',
      openedFronts === 15 && openedGenuine === 0,
      `openedFronts=${openedFronts}/15 openedGenuine=${openedGenuine}/9 fdrOpened=${fdr.opened}`);

    // ==================== DEDUPLICATION, PARTIAL SCALING & L6 HOLD GUARDRAILS ====================
    {
      const r14 = analyzeDataset(rawDatasets.get('front-14-partial-degraded-feeds.json')!)!;
      if (r14.ok) {
        check('front-14 L1 deduplicated 3 exact duplicate sales (60 unique remain)',
          r14.result.l1.counts.SALE.n === 60, `got ${r14.result.l1.counts.SALE.n}`);
        const partialItems = r14.result.evidence.filter(e => e.status !== 'UNKNOWN');
        check('front-14 PARTIAL coverage sets reliability=0.7 on active detectors',
          partialItems.length > 0 && partialItems.every(e => e.reliability === 0.7));
      }

      const r01 = analyzeDataset(rawDatasets.get('front-01-betting-web-embed.json')!)!;
      if (r01.ok) {
        const l4Blocked = planResponse(r01.result, { chosenLevel: 'L4', legalVerified: false, escrowConfirmed: false, label: 'UNRESOLVED', notes: '', clarification: '', executed: false, audit: [] });
        const l4Allowed = planResponse(r01.result, { chosenLevel: 'L4', legalVerified: true, escrowConfirmed: true, label: 'UNRESOLVED', notes: '', clarification: '', executed: false, audit: [] });
        const l5Blocked = planResponse(r01.result, { chosenLevel: 'L5', legalVerified: true, escrowConfirmed: true, label: 'UNRESOLVED', notes: '', clarification: '', executed: false, audit: [] });
        const log = actionLog(r01.result, l4Allowed, 0);
        check('L6 blocks L4 without legal+escrow authority', l4Blocked.blocked.length >= 2 && l4Blocked.hold === null);
        check('L6 mints HoldRecord on L4 with verified legal+escrow over unsettled PL-BET funds',
          l4Allowed.blocked.length === 0 && l4Allowed.hold !== null && l4Allowed.hold.amount > 0 && log.length === l4Allowed.actions.length);
        check('L6 blocks L5 termination without CONFIRMED_ILLICIT label', l5Blocked.blocked.length >= 1);
      }
    }

    // ==================== L7 WORKFLOW, MAKER/CHECKER & HASH-CHAINED AUDIT ====================
    {
      resetDb();
      const analyst = createUser('os-analyst', 'os-pass-1', 'analyst');
      const reviewer = createUser('os-reviewer', 'os-pass-2', 'reviewer');
      const legal = createUser('os-legal', 'os-pass-3', 'legal');

      const opened = openInvestigation(rawDatasets.get('front-01-betting-web-embed.json')!, analyst);
      const caseId = String(opened.body.id);
      check('L7 opens backend case with server-minted INV-* id', opened.status === 200 && /^INV-[0-9a-f]{8}$/.test(caseId));

      const rev = reviewInvestigation(caseId, { note: 'Confirmed gambling embed + pre-match burst', legitDecision: 'FAILED' }, analyst);
      check('L7 analyst review recorded', rev.status === 200);

      const propL3 = respondInvestigation(caseId, { level: 'L3', note: 'Disable PL-BET link' }, analyst);
      check('L7 analyst proposes L3 (needs checker approval)', propL3.status === 200);

      const selfApp = approveInvestigation(caseId, { decision: 'APPROVE', note: 'self' }, analyst);
      check('L7 maker/checker blocks self-approval of L3', selfApp.status === 403);

      const revApp = approveInvestigation(caseId, { decision: 'APPROVE', note: 'approved L3' }, reviewer);
      check('L7 separate reviewer approves L3', revApp.status === 200);

      const lbl1 = labelInvestigation(caseId, { label: 'CONFIRMED_ILLICIT', note: 'analyst label' }, analyst);
      const lbl2 = labelInvestigation(caseId, { label: 'CONFIRMED_ILLICIT', note: 'legal second check' }, legal);
      check('L7 two-person CONFIRMED_ILLICIT adjudication succeeds', lbl1.status === 200 && lbl2.status === 200);

      const auditCheck = verifyAudit(caseId);
      check('L7 hash-chained audit trail verifies intact', auditCheck.ok && auditCheck.entries >= 6, JSON.stringify(auditCheck));
    }
  } finally {
    resetDb();
    if (prevKey === undefined) delete process.env.MRE_HASH_KEY; else process.env.MRE_HASH_KEY = prevKey;
    if (prevStore === undefined) delete process.env.MRE_CASE_STORE; else process.env.MRE_CASE_STORE = prevStore;
  }

  return bad;
}
