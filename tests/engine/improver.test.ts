/** Learning: bands, label hygiene, the holdout gate, two-person promotion, persistence and rollback. */
import { readFileSync } from 'node:fs';
import { getDb, resetDb } from '../../backend/src/db';
import { createUser } from '../../backend/src/auth';
import { analyzeDataset } from '../../backend/src/algorithms/analyze';
import { approveRuleProposal, listProposals, promoteRuleProposal, recordLabelEvents, rollbackRulesLive, runImproverProposal, verifyRulesAudit } from '../../backend/src/improverApi';
import { syncLiveRules } from '../../backend/src/rulesState';
import { analyze } from '../../engine/index';
import { insideBand, mcnemarExact, propose } from '../../engine/improver';
import { effectiveRates, type LabelEvent } from '../../engine/learnedRates';
import { getLiveDetectorPatch, RULES, setLiveDetectorPatch } from '../../rules/index';

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); } else console.log(`  ✓ ${name}`); };
  const a4 = RULES.detector('A4');
  check('minEffect inside the band', insideBand('A4', { minEffect: a4.minEffect }));
  check('minEffect outside the band is rejected', !insideBand('A4', { minEffect: a4.minEffect * 3 }));
  check('minN below the band is rejected', !insideBand('A4', { minN: 2 }));
  check('calibration outside the band is rejected', !insideBand('A4', { falsePositive: 0.0001 }));
  const prior = effectiveRates('A4', []);
  check('zero labels keep the prior', prior.sensitivity === a4.sensitivity && prior.falsePositive === a4.falsePositive && prior.nPos === 0);
  const unresolved = effectiveRates('A4', [{ detectorId: 'A4', fired: true, label: 'UNRESOLVED' }]);
  check('unresolved labels change nothing', unresolved.sensitivity === prior.sensitivity && unresolved.falsePositive === prior.falsePositive);
  const dispute = effectiveRates('A4', [{ detectorId: 'A4', fired: false, label: 'ADJUDICATED_BENIGN', origin: 'merchant_dispute' }]);
  check('merchant dispute labels are ignored', dispute.sensitivity === prior.sensitivity && dispute.nNeg === 0);
  const singleActorSpam: LabelEvent[] = Array.from({ length: 50 }, () => ({ detectorId: 'A4', fired: false, label: 'CONFIRMED_ILLICIT', actorId: 'spammer', mcc: '5462' }));
  const capped = effectiveRates('A4', singleActorSpam, '5462');
  check('per-analyst cap prevents one actor from collapsing sensitivity', capped.sensitivity > 0.40, String(capped.sensitivity));
  check('McNemar: no change is not significant', mcnemarExact([true, false], [true, false]) === 1);

  const rulesFile = readFileSync('rules/detectors.json', 'utf8');
  const tried = propose();
  check('threshold search never proposes more false alarms', !tried.proposal || tried.proposal.backtest.challenger.fpCount <= tried.proposal.backtest.champion.fpCount);
  check('threshold search gives a reason', tried.reason.length > 0);
  check('proposing never edits rules/', readFileSync('rules/detectors.json', 'utf8') === rulesFile);

  const prevStore = process.env.MRE_CASE_STORE;
  process.env.MRE_CASE_STORE = 'memory';
  resetDb();
  try {
    const pw = 'improver-test-password';
    const maker = createUser('rule-maker', pw, 'admin'), checker = createUser('rule-checker', pw, 'reviewer'), analyst = createUser('rule-analyst', pw, 'analyst'), second = createUser('rule-second', pw, 'reviewer');
    const raw = JSON.parse(readFileSync('frontend/public/samples/09-telegram-betting-no-website.json', 'utf8'));
    const before = analyzeDataset(raw);
    if (!before.ok) throw new Error('sample failed');

    check('too few labels: no calibration', runImproverProposal(maker, 'calibration').status === 422);
    for (let i = 0; i < 16; i++) recordLabelEvents(`M-LBL-${i}`, '5462', before.result.evidence, 'CONFIRMED_ILLICIT', i % 2 ? checker.id : second.id);
    for (let i = 0; i < 5; i++) recordLabelEvents('M-LBL-0', '5462', before.result.evidence, 'CONFIRMED_ILLICIT', checker.id);
    check('one merchant counts once', (getDb().prepare('SELECT COUNT(DISTINCT case_id) AS n FROM label_events').get() as { n: number }).n === 16);
    const unmoved = analyzeDataset(raw);
    check('labels alone do not move the score', unmoved.ok && unmoved.result.fusion.posterior === before.result.fusion.posterior);

    const made = runImproverProposal(maker, 'calibration');
    check('calibration proposed', made.status === 200, JSON.stringify(made.body.error ?? ''));
    const prop = listProposals()[0];
    if (prop) {
      check('requester cannot approve', approveRuleProposal(prop.id, maker).status === 403);
      check('analyst cannot approve', approveRuleProposal(prop.id, analyst).status === 403);
      check('cannot promote before approval', promoteRuleProposal(prop.id, checker).status === 409);
      check('second person approves', approveRuleProposal(prop.id, checker).status === 200);
      check('requester cannot promote', promoteRuleProposal(prop.id, maker).status === 403);
      check('second person promotes', promoteRuleProposal(prop.id, checker).status === 200);
      const after = analyzeDataset(raw);
      check('approved learning changes the score', after.ok && after.result.fusion.posterior !== before.result.fusion.posterior);
      setLiveDetectorPatch(null, null); // what a restart does
      syncLiveRules();
      check('promoted rules survive a restart', getLiveDetectorPatch().version.includes(prop.id));
      check('analyst cannot roll back', rollbackRulesLive(analyst).status === 403);
      check('reviewer rolls back', rollbackRulesLive(checker).status === 200);
      const back = analyzeDataset(raw);
      check('rollback restores the score', back.ok && back.result.fusion.posterior === before.result.fusion.posterior);
    }
    check('rules audit chain verifies intact', verifyRulesAudit().ok === true);
    getDb().prepare('DELETE FROM rules_audit WHERE seq = (SELECT MAX(seq) FROM rules_audit)').run();
    check('rules audit truncation detected', verifyRulesAudit().ok === false);
    check('engine runs on base rules afterwards', analyze(raw).ok);
  } finally {
    setLiveDetectorPatch(null, null);
    resetDb();
    if (prevStore === undefined) delete process.env.MRE_CASE_STORE; else process.env.MRE_CASE_STORE = prevStore;
  }
  return bad;
}
