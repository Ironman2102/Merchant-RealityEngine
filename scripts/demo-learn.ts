/**
 * Watch the engine look for a fix and test it honestly. This script never approves or promotes anything, and never
 * edits rules/: promotion takes two signed-in people in the console.
 */
import { analyze } from '../engine/index';
import { propose, type Metrics } from '../engine/improver';
import { withDetectorOverrides } from '../rules/index';
import { probeMerchant } from '../backend/src/improverApi';

const show = (m: Metrics) => `fronts caught ${m.tp}/${m.nFront}, honest merchants wrongly opened ${m.fpCount}/${m.nGenuine}`;

export function demoLearn(): number {
  const probe = probeMerchant().dataset, before = analyze(probe);
  if (!before.ok) { console.error(before.errors.join(' ')); return 1; }
  console.log(`thin front today: ${before.result.fusion.decision}, follow-up ${before.result.fusion.followUp}, P=${before.result.fusion.posterior.toFixed(3)}`);
  const tried = propose();
  if (tried.backtest) {
    console.log(`holdout champion:   ${show(tried.backtest.champion)}`);
    console.log(`holdout challenger: ${show(tried.backtest.challenger)} (McNemar p ${tried.backtest.mcnemarP.toFixed(4)})`);
  }
  console.log(tried.reason);
  if (!tried.proposal) return 0; // refusing a bad fix is a correct outcome
  const after = withDetectorOverrides(tried.proposal.patch, () => analyze(probe));
  if (after.ok) console.log(`preview only, if two people approved it: ${after.result.fusion.decision}, P=${after.result.fusion.posterior.toFixed(3)}`);
  console.log('Nothing was changed. Request, approve and promote at /ai-engine/improvements with two different accounts.');
  return 0;
}

if (process.argv[1]?.endsWith('demo-learn.ts')) process.exit(demoLearn());
