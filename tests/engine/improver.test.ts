/** Bands, zero labels, and unresolved labels. */
import { readFileSync } from 'node:fs';
import { getDb, resetDb } from '../../backend/src/db';
import { approveRuleProposal, listProposals, promoteRuleProposal, rollbackRulesLive, runImproverProposal, verifyRulesAudit } from '../../backend/src/improverApi';
import { analyze } from '../../engine/index';
import { insideBand } from '../../engine/improver';
import { effectiveRates, type LabelEvent } from '../../engine/learnedRates';
import { RULES } from '../../rules/index';
import { demoLearn, rollbackRules } from '../../scripts/demo-learn';

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); } else console.log(`  ✓ ${name}`); };
  const a4 = RULES.detector('A4');
  check('minEffect inside the band', insideBand('A4', { minEffect: a4.minEffect }));
  check('minEffect outside the band is rejected', !insideBand('A4', { minEffect: a4.minEffect * 3 }));
  const prior = effectiveRates('A4', []);
  check('zero labels keep the prior', prior.sensitivity === a4.sensitivity && prior.falsePositive === a4.falsePositive && prior.nPos === 0);
  const unresolved = effectiveRates('A4', [{ detectorId: 'A4', fired: true, label: 'UNRESOLVED' }]);
  check('unresolved labels change nothing', unresolved.sensitivity === prior.sensitivity && unresolved.falsePositive === prior.falsePositive);
  const dispute = effectiveRates('A4', [{ detectorId: 'A4', fired: false, label: 'ADJUDICATED_BENIGN', origin: 'merchant_dispute' }]);
  check('merchant dispute labels are ignored', dispute.sensitivity === prior.sensitivity && dispute.nNeg === 0);
  const singleActorSpam: LabelEvent[] = Array.from({ length: 50 }, () => ({ detectorId: 'A4', fired: false, label: 'CONFIRMED_ILLICIT', actorId: 'spammer', mcc: '5462' }));
  const capped = effectiveRates('A4', singleActorSpam, '5462');
  check('per-analyst cap prevents one actor from collapsing sensitivity', capped.sensitivity > 0.40, String(capped.sensitivity));
  const raw = JSON.parse(readFileSync('frontend/public/samples/04-anand-sweets-diwali-genuine.json', 'utf8'));
  const once = analyze(raw), twice = analyze(raw);
  check('zero-label rescore is identical', once.ok && twice.ok && once.result.fusion.posterior === twice.result.fusion.posterior && once.result.fusion.decision === twice.result.fusion.decision);
  const beforeDet = readFileSync('rules/detectors.json');
  const beforeEng = readFileSync('rules/engine.json');
  let code = 1;
  try { code = demoLearn(); } finally { rollbackRules(); }
  const afterDet = readFileSync('rules/detectors.json');
  const afterEng = readFileSync('rules/engine.json');
  check('byte-identical rollback', code === 0 && beforeDet.equals(afterDet) && beforeEng.equals(afterEng));

  // Live API maker/checker & hash-chained rules_audit verification
  const prevStore = process.env.MRE_CASE_STORE;
  process.env.MRE_CASE_STORE = 'memory';
  resetDb();
  try {
    const admin1 = { id: 1, username: 'admin-one', role: 'admin' as const };
    const admin2 = { id: 2, username: 'admin-two', role: 'admin' as const };
    runImproverProposal(admin1, 'self');
    const selfProp = listProposals()[0];
    check('creator cannot approve own rule proposal', approveRuleProposal(selfProp.id, admin1).status === 403);
    check('second admin can approve proposal', approveRuleProposal(selfProp.id, admin2).status === 200);
    const promoted = promoteRuleProposal(selfProp.id, admin2);
    check('promoted rule catches red-team evasion live', promoted.status === 200 && (promoted.body.evasionCheck as { decision: string }).decision === 'OPEN_CASE');
    const rolled = rollbackRulesLive(admin2);
    check('live rollback restores base rules', rolled.status === 200 && (rolled.body.evasionCheck as { decision: string }).decision === 'NO_CASE');
    check('rules audit chain verifies intact', verifyRulesAudit().ok === true);
    getDb().prepare("UPDATE rules_audit SET detail = 'tampered' WHERE seq = 1").run();
    check('rules audit tampering detected', verifyRulesAudit().ok === false);
  } finally {
    resetDb();
    if (prevStore === undefined) delete process.env.MRE_CASE_STORE; else process.env.MRE_CASE_STORE = prevStore;
  }
  return bad;
}
