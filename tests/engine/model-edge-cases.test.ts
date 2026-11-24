/**
 * Comprehensive unit & edge-case suite for validation, judge(), fuse(), decide(),
 * volumeModel(), cusum(), cohortContinuity(), scorePortfolio(), and ML feature parity.
 * Returns the number of failed assertions.
 */
import { readFileSync } from 'node:fs';
import { datasetToScenario, DATASET_FORMAT } from '../../frontend/src/data/dataset';
import { judge, fireLlr, calmLlr } from '../../frontend/src/engines/judge';
import { fuse, priorFor } from '../../frontend/src/engines/evidenceFusion';
import { decide } from '../../frontend/src/engines/decision';
import { volumeModel } from '../../frontend/src/engines/residualEngine';
import { cusum } from '../../frontend/src/engines/cusumEngine';
import { cohortContinuity } from '../../frontend/src/engines/cohortContinuity';
import { scorePortfolio } from '../../engine/portfolio';
import { analyze, features, FEATURE_COLUMNS } from '../../engine/index';
import { behavioralFeatures, BEHAVIORAL_FEATURE_COLUMNS } from '../../engine/features';
import { RULES } from '../../rules/index';
import type { EvidenceItem, Family, Mechanism, Provenance } from '../../frontend/src/types/evidence';
import type { MerchantProfile } from '../../frontend/src/types/merchant';
import type { WeeklyRow } from '../../frontend/src/types/investigation';

interface RawTx {
  id: string; merchantId: string; type: string; amount: number; time: string; channel: string;
  payerId?: string; payerState?: string;
}
interface RawDataset {
  format: string;
  merchant: Record<string, unknown> & { ticketMin: number; ticketMax: number; baselineWeekly: number; accountAgeDays: number; hours: number[]; mcc: string };
  weeklySales: { week: string; actual: number | null; seasonalMultiplier: number }[];
  transactions: RawTx[];
  [key: string]: unknown;
}

function validRawDataset(): RawDataset {
  return {
    format: DATASET_FORMAT,
    merchant: {
      id: 'M-VAL',
      name: 'Valid Shop',
      city: 'Bengaluru, KA',
      mcc: '5462',
      category: 'Bakeries and sweet shops',
      ticketMin: 50,
      ticketMax: 1000,
      baselineWeekly: 40000,
      accountAgeDays: 200,
      hours: [7, 22],
      localStates: ['KA'],
    },
    weeklySales: Array.from({ length: 8 }, (_, i) => ({
      week: `W${i + 1}`,
      actual: 40000,
      seasonalMultiplier: 1,
    })),
    transactions: [
      {
        id: 'TX-1',
        merchantId: 'M-VAL',
        type: 'SALE',
        amount: 500,
        time: '2026-06-01T12:00:00+05:30',
        channel: 'UPI_LINK',
        payerId: 'PAYER-1',
        payerState: 'KA',
      },
    ],
  };
}

function mkEvidenceItem(id: string, overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  const cfg = RULES.detector(id);
  return {
    id,
    name: cfg.name,
    family: cfg.family as Family,
    status: 'UNKNOWN',
    strength: 0,
    reliability: 1,
    fakeDifficulty: cfg.fakeDifficulty,
    lineage: cfg.lineage,
    system: cfg.provenance,
    requires: cfg.requires as EvidenceItem['requires'],
    affinity: {
      ROTATION: cfg.affinity[0],
      TRANSACTION_LAUNDERING: cfg.affinity[1],
      FABRICATED_SUBSTANCE: cfg.affinity[2],
      OTHER_ABUSE: cfg.affinity[3],
    } as Record<Mechanism, number>,
    observed: '',
    expected: '',
    explanation: '',
    metrics: {},
    records: [],
    llr: 0,
    provenance: cfg.provenance as Provenance,
    signal: cfg.class,
    test: cfg.test,
    p: null,
    effect: null,
    effectLabel: '',
    ci: null,
    n: 0,
    expectedSource: '',
    ...overrides,
  };
}

const TEST_PROFILE: MerchantProfile = {
  id: 'M-FUSE',
  name: 'Fusion Test',
  city: 'Bengaluru, KA',
  mcc: '5462',
  category: 'Bakeries and sweet shops',
  products: [],
  ticketMin: 50,
  ticketMax: 1500,
  hours: [7, 22],
  catchment: 'LOCAL',
  localStates: ['KA'],
  expectedRoundShare: 0.06,
  seasonalPeak: 1,
  baselineWeekly: 50000,
  accountAgeDays: 200,
  declaredDomains: [],
  declaredChannels: ['UPI_LINK'],
  declaredActivity: [],
};

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); }
    else console.log(`  ✓ ${name}`);
  };

  // ==================== 1. DATASET VALIDATION & EDGE CASES ====================
  check('rejects null root', !datasetToScenario(null).ok);
  check('rejects primitive root', !datasetToScenario('hello').ok);

  {
    const d = validRawDataset();
    d.merchant.ticketMin = 0;
    check('accepts ticketMin === 0', datasetToScenario(d).ok);
  }
  {
    const d = validRawDataset();
    d.merchant.ticketMin = 500; d.merchant.ticketMax = 500;
    check('rejects ticketMin === ticketMax', !datasetToScenario(d).ok);
  }
  {
    const d = validRawDataset();
    d.merchant.accountAgeDays = 0;
    check('accepts accountAgeDays === 0', datasetToScenario(d).ok);
  }
  {
    const d = validRawDataset();
    d.merchant.accountAgeDays = -1;
    check('rejects accountAgeDays < 0', !datasetToScenario(d).ok);
  }
  {
    const d = validRawDataset();
    d.merchant.baselineWeekly = 0;
    check('rejects baselineWeekly <= 0', !datasetToScenario(d).ok);
  }
  {
    const d = validRawDataset();
    d.merchant.hours = [7, 7];
    check('rejects equal hours [7,7]', !datasetToScenario(d).ok);
    d.merchant.hours = [0, 24];
    check('accepts 24h hours [0,24]', datasetToScenario(d).ok);
    d.merchant.hours = [22, 6];
    check('accepts overnight hours [22,6]', datasetToScenario(d).ok);
    d.merchant.hours = [-1, 12];
    check('rejects negative hour [-1,12]', !datasetToScenario(d).ok);
    d.merchant.hours = [7.5, 22];
    check('rejects fractional hour [7.5,22]', !datasetToScenario(d).ok);
  }
  {
    const d = validRawDataset();
    d.transactions[0].amount = 0;
    check('accepts amount === 0', datasetToScenario(d).ok);
    d.transactions[0].amount = 20_000_000;
    check('accepts amount === 20,000,000 boundary', datasetToScenario(d).ok);
    d.transactions[0].amount = 20_000_001;
    check('rejects amount > 20,000,000', !datasetToScenario(d).ok);
    d.transactions[0].amount = Number.NaN;
    check('rejects amount === NaN', !datasetToScenario(d).ok);
  }
  {
    const d = validRawDataset();
    d.transactions[0].channel = 'upi';
    const r1 = datasetToScenario(d);
    check('normalizes legacy "upi" -> UPI_LINK', r1.ok && r1.scenario!.events[0].channel === 'UPI_LINK');
    d.transactions[0].channel = 'upi-collect';
    const r2 = datasetToScenario(d);
    check('normalizes "upi-collect" -> UPI_COLLECT', r2.ok && r2.scenario!.events[0].channel === 'UPI_COLLECT');
    d.transactions[0].channel = 'CRYPTO_WALLET';
    check('rejects invalid channel', !datasetToScenario(d).ok);
  }
  {
    // Duplicate deduction WITH payerId vs WITHOUT payerId
    const dWithPayer = validRawDataset();
    dWithPayer.transactions.push({ ...dWithPayer.transactions[0], id: 'TX-2' });
    const rDup = datasetToScenario(dWithPayer);
    check('drops exact duplicate when payerId present', rDup.ok && rDup.scenario!.events.length === 1 && rDup.warnings.some(w => w.includes('duplicate')));

    const dAnon = validRawDataset();
    delete dAnon.transactions[0].payerId;
    dAnon.transactions.push({ ...dAnon.transactions[0], id: 'TX-2' });
    const rAnon = datasetToScenario(dAnon);
    check('keeps same-second same-amount anonymous sales (no payerId)', rAnon.ok && rAnon.scenario!.events.length === 2);
  }
  {
    const d = validRawDataset();
    d.transactions[0].merchantId = 'OTHER-MERCHANT';
    check('rejects dataset with zero transactions for primary merchant', !datasetToScenario(d).ok);
  }
  {
    const d = validRawDataset();
    d.weeklySales[0].seasonalMultiplier = 0.2;
    d.weeklySales[1].seasonalMultiplier = 6.0;
    check('accepts seasonalMultiplier at [0.2, 6.0] boundaries', datasetToScenario(d).ok);
    d.weeklySales[0].seasonalMultiplier = 0.19;
    check('rejects seasonalMultiplier < 0.2', !datasetToScenario(d).ok);
    d.weeklySales[0].seasonalMultiplier = 6.01;
    check('rejects seasonalMultiplier > 6.0', !datasetToScenario(d).ok);
  }
  {
    const d = validRawDataset() as Record<string, unknown>;
    d.purchaserVerification = { contacted: 5, confirmed: 0 };
    check('accepts purchaserVerification confirmed=0, contacted=5', datasetToScenario(d).ok);
    d.purchaserVerification = { contacted: 5, confirmed: 6 };
    check('rejects purchaserVerification confirmed > contacted', !datasetToScenario(d).ok);
    d.purchaserVerification = { contacted: 5.5, confirmed: 2 };
    check('rejects non-integer purchaserVerification', !datasetToScenario(d).ok);
  }
  {
    const d = validRawDataset();
    d.merchant.mcc = '9999'; // Unknown MCC
    const res = analyze(d);
    check('unknown MCC 9999 falls back cleanly without crash/NaN', res.ok && Number.isFinite(res.result.fusion.posterior));
  }
  {
    // >25 transaction errors truncation
    const d = validRawDataset();
    d.transactions = Array.from({ length: 30 }, (_, i) => ({
      id: `BAD-${i}`, merchantId: 'M-VAL', type: 'SALE', amount: -5, time: 'not-a-date', channel: 'UPI_LINK',
    }));
    const r = datasetToScenario(d);
    check('truncates >25 validation errors cleanly', !r.ok && r.errors.length <= 26 && r.errors[r.errors.length - 1].includes('not shown'));
  }

  // ==================== 2. JUDGE() BOUNDARIES ====================
  {
    const cfg = RULES.detector('A4'); // alpha=0.001, minEffect=0.08, effectFull=0.25, minN=30
    const jMinN = judge(cfg, { p: 0, effect: 1, n: cfg.minN - 1, effectLabel: 'x', observed: '', expected: '', explanation: '', expectedSource: '' });
    check('judge: n < minN -> UNKNOWN llr=0', jMinN.status === 'UNKNOWN' && jMinN.llr === 0);

    const jGrey = judge(cfg, { p: 0.05, effect: 0.15, n: 100, effectLabel: 'x', observed: '', expected: '', explanation: '', expectedSource: '' });
    check('judge: p in (alpha, 0.2] & effect >= 0.5*minEffect -> grey-zone UNKNOWN', jGrey.status === 'UNKNOWN' && jGrey.llr === 0);

    const jTinyEff = judge(cfg, { p: 1e-10, effect: cfg.minEffect * 0.49, n: 100000, effectLabel: 'x', observed: '', expected: '', explanation: '', expectedSource: '' });
    check('judge: p <= alpha but trivial effect < 0.5*minEffect -> BENIGN', jTinyEff.status === 'BENIGN' && jTinyEff.llr < 0);

    const jLowGrade = judge(cfg, { p: cfg.alpha, effect: cfg.minEffect, n: 100, effectLabel: 'x', observed: '', expected: '', explanation: '', expectedSource: '' });
    check('judge: grade clamped at >= 0.5', jLowGrade.status === 'ILLICIT' && jLowGrade.grade === 0.5);

    const jHighGrade = judge(cfg, { p: 1e-9, effect: cfg.effectFull * 10, n: 100, effectLabel: 'x', observed: '', expected: '', explanation: '', expectedSource: '' });
    check('judge: grade clamped at <= 1.25', jHighGrade.status === 'ILLICIT' && jHighGrade.grade === 1.25);
    check('judge: fire LLR = ln(s/f) * grade', Math.abs(jHighGrade.llr - fireLlr(cfg.sensitivity, cfg.falsePositive) * 1.25) < 1e-12);

    const jCalm = judge(cfg, { p: 0.9, effect: 0, n: 100, effectLabel: 'x', observed: '', expected: '', explanation: '', expectedSource: '' });
    check('judge: calm LLR >= benignLlrFloor', jCalm.status === 'BENIGN' && jCalm.llr >= RULES.engine.benignLlrFloor);
    check('judge: calm LLR matches calmLlr * tau', Math.abs(jCalm.llr - Math.max(RULES.engine.benignLlrFloor, calmLlr(cfg.sensitivity, cfg.falsePositive) * jCalm.tau)) < 1e-12);
  }

  // ==================== 3. FUSE(), OVERRIDES, GATE & PRIORITIES ====================
  {
    // Exact shrinkage math: within family A (A1, A4, A5) with rho = 0.3
    const rho = RULES.engine.familyRho;
    const ev: EvidenceItem[] = [
      mkEvidenceItem('A1', { status: 'ILLICIT', llr: 2.0 }),
      mkEvidenceItem('A4', { status: 'ILLICIT', llr: 1.0 }),
      mkEvidenceItem('A5', { status: 'BENIGN', llr: -0.6 }),
      mkEvidenceItem('B6', { status: 'BENIGN', llr: -0.8 }),
    ];
    const f = fuse(ev, TEST_PROFILE, { draws: 10 });
    const famA = f.logOdds.families.find(x => x.family === 'A')!.llr;
    const expectedFamA = 2.0 + rho * 1.0 + (-0.6);
    check('fuse: family shrinkage rho applied to positives and negatives separately', Math.abs(famA - expectedFamA) < 1e-12, `${famA} vs ${expectedFamA}`);
  }
  {
    // Override R-01 triggers ONLY when G6 ILLICIT AND effect >= 1.25
    const g6Generic = mkEvidenceItem('G6', { status: 'ILLICIT', llr: 4.0, effect: 0.6 });
    const fGen = fuse([g6Generic], TEST_PROFILE, { draws: 5 });
    check('override R-01 does NOT trigger for G6 effect=0.6', fGen.logOdds.overrides.length === 0);

    const g6Bet = mkEvidenceItem('G6', { status: 'ILLICIT', llr: 4.0, effect: 1.25 });
    const fBet = fuse([g6Bet], TEST_PROFILE, { draws: 5 });
    check('override R-01 triggers for G6 effect=1.25', fBet.logOdds.overrides.some(o => o.id === 'R-01'));
  }
  {
    // Governance gate: 1 provenance & 2 families with high P -> NO_CASE!
    const twoFamSameProv = [
      mkEvidenceItem('A4', { status: 'ILLICIT', llr: 5.0 }), // family A, provenance payments
      mkEvidenceItem('C2', { status: 'ILLICIT', llr: 5.0 }), // family C, provenance payments
    ];
    const fBlock = fuse(twoFamSameProv, TEST_PROFILE, { draws: 5 });
    check('gate blocks high P from 1 provenance & only 2 families', fBlock.posterior > 0.5 && fBlock.gatePassed === false && fBlock.decision === 'NO_CASE');

    // 1 provenance & 3 strong families -> OPEN_CASE!
    const threeFamSameProv = [
      ...twoFamSameProv,
      mkEvidenceItem('I2', { status: 'ILLICIT', llr: 5.0 }), // family I, provenance payments
    ];
    const f3Fam = fuse(threeFamSameProv, TEST_PROFILE, { draws: 5 });
    check('gate opens high P from 1 provenance & 3 strong families', f3Fam.gatePassed === true && f3Fam.decision === 'OPEN_CASE');

    // 2 provenances & 2 strong families -> OPEN_CASE!
    const twoProv = [
      mkEvidenceItem('A4', { status: 'ILLICIT', llr: 4.0 }), // provenance payments
      mkEvidenceItem('B9', { status: 'ILLICIT', llr: 4.0 }), // provenance panel
    ];
    const f2Prov = fuse(twoProv, TEST_PROFILE, { draws: 5 });
    check('gate opens high P from 2 independent provenances', f2Prov.gatePassed === true && f2Prov.decision === 'OPEN_CASE');

    // Priority bands & mechanism normalization & extreme log-odds stability
    const extreme = [
      mkEvidenceItem('A4', { status: 'ILLICIT', llr: 100 }),
      mkEvidenceItem('B9', { status: 'ILLICIT', llr: 100 }),
    ];
    const fExt = fuse(extreme, TEST_PROFILE, { draws: 5 });
    const mechSum = Object.values(fExt.mechanismPosterior).reduce((s, v) => s + v, 0);
    check('mechanism posterior sums to 1.0', Math.abs(mechSum - 1) < 1e-12, String(mechSum));
    check('extreme positive log-odds finite posterior<=1 & HIGH priority', Number.isFinite(fExt.posterior) && fExt.posterior <= 1 && fExt.priority === 'HIGH');

    const fZero = fuse([mkEvidenceItem('A4', { status: 'BENIGN', llr: -100 })], TEST_PROFILE, { draws: 5 });
    check('extreme negative log-odds finite posterior>=0 & NONE priority', Number.isFinite(fZero.posterior) && fZero.posterior >= 0 && fZero.priority === 'NONE');
  }
  {
    // priorFor MCC fallback and ageOdds brackets
    const pYoung = priorFor({ ...TEST_PROFILE, mcc: '9999', accountAgeDays: 30 });
    const pOld = priorFor({ ...TEST_PROFILE, mcc: '9999', accountAgeDays: 2000 });
    check('priorFor unknown MCC uses default rate and age odds decrease with age', pYoung.rate === RULES.priors.default.rate && pYoung.odds > pOld.odds);
  }

  // ==================== 4. DECIDE() & ROBUST STEP-DOWN ====================
  {
    const dClosed = decide(0.95, [0.9, 0.99], false);
    check('decide: caseOpen=false caps at L1', dClosed.recommended <= 'L1', dClosed.recommended);

    const dZero = decide(0, [0, 0], true);
    check('decide: P=0 recommends L0', dZero.recommended === 'L0', dZero.recommended);

    const dMax = decide(1, [1, 1], true);
    check('decide: P=1 caps at autoRecommendMax (L3)', dMax.recommended === RULES.costs.autoRecommendMax, dMax.recommended);

    // Construct a case where point estimate prefers L3, but low end of CI prefers L2 -> robust step-down to L2
    // At P=0.05: L3 EL = 0.95*15000 + 0.05*0.2*500000 = 14250 + 5000 = 19250; L2 EL = 0.95*1500 + 0.05*0.6*500000 = 1425 + 15000 = 16425.
    // At P=0.20: L3 EL = 0.80*15000 + 0.20*100000 = 32000; L2 EL = 0.80*1500 + 0.20*300000 = 61200 -> picks L3 at P=0.20, but at lo=0.05 L2 is cheaper!
    const dStep = decide(0.20, [0.05, 0.40], true);
    check('decide: robust step-down triggers when CI low prefers milder action', dStep.recommended === 'L2' && dStep.reason.includes('step down'), dStep.recommended);
  }

  // ==================== 5. VOLUME MODEL & CUSUM ====================
  {
    // Fewer than 3 non-festival baseline weeks falls back to declared baselineWeekly
    const d = validRawDataset();
    d.weeklySales = [
      { week: 'W1', actual: null, seasonalMultiplier: 1 },
      { week: 'W2', actual: 0, seasonalMultiplier: 1 },
      { week: 'W3', actual: 40000, seasonalMultiplier: 1 },
      { week: 'W4', actual: 40000, seasonalMultiplier: 1 },
    ];
    const parsed = datasetToScenario(d);
    const vol = volumeModel(parsed.scenario!);
    check('volumeModel: <3 clean baseline weeks falls back to profile.baselineWeekly', !vol.fitted && vol.base === 40000);
    check('volumeModel: actual=null and actual=0 yield null z (never NaN/-Infinity)', vol.z[0] === null && vol.z[1] === null && vol.z.every(v => v === null || Number.isFinite(v)));

    // cusum null handling and threshold s > h
    const rows: WeeklyRow[] = [
      { week: 'W1', actual: 1, anchored: 1, seasonal: 1, rolling: 1, rAnchored: 0, rSeasonal: 0, rRolling: 0 },
      { week: 'W2', actual: null, anchored: 1, seasonal: 1, rolling: 1, rAnchored: null, rSeasonal: null, rRolling: null },
      { week: 'W3', actual: 1, anchored: 1, seasonal: 1, rolling: 1, rAnchored: 0, rSeasonal: 0, rRolling: 0 },
    ];
    const cs = cusum(rows, [2.0, null, 2.0], 0.5, 2.35);
    // W1: s = 2.0 - 0.5 = 1.5 (no alarm); W2: null keeps s=1.5, alarm=false; W3: s = 1.5 + 2.0 - 0.5 = 3.0 > 2.35 (alarm!)
    check('cusum: preserves s across null and triggers at s > h', cs[0].s === 1.5 && !cs[0].alarm && cs[1].s === 1.5 && !cs[1].alarm && cs[2].s === 3.0 && cs[2].alarm);
  }

  // ==================== 6. COHORT CONTINUITY & PORTFOLIO ====================
  {
    const d = validRawDataset();
    const sc = datasetToScenario(d).scenario!;
    sc.peers = [{ id: 'EMPTY-PEER', name: 'Empty', status: 'DORMANT', accountAgeDays: 100 }];
    check('cohortContinuity ignores peer with 0 sales', cohortContinuity(sc).length === 0);

    sc.events = [];
    check('cohortContinuity handles 0 primary sales', cohortContinuity(sc).length === 0);
  }
  {
    check('scorePortfolio handles empty input', scorePortfolio([]).opened === 0);
    const allNoCase = [
      { merchantId: 'M1', name: 'M1', posterior: 0.02, ci: [0, 0.05] as [number, number], expectedLoss: 10, action: 'L0', decision: 'NO_CASE' },
    ];
    check('scorePortfolio ignores NO_CASE rows', scorePortfolio(allNoCase).opened === 0);

    // FDR cutoff: P=0.95 (fa=0.05), P=0.90 (cum fa=0.15, avg=0.075 <= 0.10), P=0.80 (cum fa=0.35, avg=0.1167 > 0.10) -> keeps 2
    const rows = [
      { merchantId: 'M-B', name: 'B', posterior: 0.90, ci: [0.8, 0.95] as [number, number], expectedLoss: 200, action: 'L3', decision: 'OPEN_CASE' },
      { merchantId: 'M-A', name: 'A', posterior: 0.95, ci: [0.9, 0.99] as [number, number], expectedLoss: 200, action: 'L3', decision: 'OPEN_CASE' },
      { merchantId: 'M-C', name: 'C', posterior: 0.80, ci: [0.7, 0.9] as [number, number], expectedLoss: 500, action: 'L2', decision: 'OPEN_CASE' },
    ];
    const q = scorePortfolio(rows, 0.10);
    check('scorePortfolio stops at Bayesian FDR q=0.10', q.opened === 2 && !q.queue.some(r => r.merchantId === 'M-C'), `opened=${q.opened}`);
    check('scorePortfolio breaks expectedLoss ties by merchantId', q.queue[0].merchantId === 'M-A' && q.queue[1].merchantId === 'M-B');
  }

  // ==================== 7. ML FEATURE PARITY WITH TRAINED MODELS ====================
  {
    const m1Features = JSON.parse(readFileSync('ml/models/m1-v0/features.json', 'utf8')) as string[];
    const nnNet = JSON.parse(readFileSync('ml/models/nn-v0/network.json', 'utf8')) as { features: string[] };
    const allowedCols = new Set([...FEATURE_COLUMNS, ...BEHAVIORAL_FEATURE_COLUMNS]);
    check('m1-v0 and nn-v0 feature lists match each other', JSON.stringify(m1Features) === JSON.stringify(nnNet.features));
    check('all model feature columns exist in FEATURE_COLUMNS / BEHAVIORAL_FEATURE_COLUMNS', m1Features.every(c => allowedCols.has(c)));

    const sample = JSON.parse(readFileSync('frontend/public/samples/01-sweet-crumbs-betting-front.json', 'utf8'));
    const res = analyze(sample);
    if (res.ok) {
      const feat = features(res.result);
      const bfeat = behavioralFeatures(res.result);
      check('features() emits exact column set and all finite numbers',
        Object.keys(feat).length === FEATURE_COLUMNS.length &&
        FEATURE_COLUMNS.every(c => typeof feat[c] === 'number' && Number.isFinite(feat[c])));
      check('behavioralFeatures() emits exact column set and all finite numbers',
        Object.keys(bfeat).length === BEHAVIORAL_FEATURE_COLUMNS.length &&
        BEHAVIORAL_FEATURE_COLUMNS.every(c => typeof bfeat[c] === 'number' && Number.isFinite(bfeat[c])));
    } else {
      check('sample 01 analyzed for feature parity', false);
    }
  }

  return bad;
}
