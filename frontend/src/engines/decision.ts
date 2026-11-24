/**
 * Decision theory: choose the response with the lowest expected loss,
 *   EL(a) = (1 − P) · falseAlarmCost(a) + P · missFactor(a) · missCost      (rules/costs.json)
 * evaluated at the posterior median AND its 90% interval. Robust rule: if the chosen action is worse than the
 * next milder one at the LOW end of the interval, step down, so uncertainty never pushes us to a harsher action.
 * Automatic recommendations stop at rules.costs.autoRecommendMax (L3); L4/L5 always need people.
 */
import type { DecisionAnalysis, ResponseLevel } from '../types/investigation';
import { RULES, type ResponseKey } from '../../../rules/index';
import { fmtProb, probEq } from '../utils/format';

const ORDER: ResponseKey[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];

export function decide(posterior: number, [lo, hi]: [number, number], caseOpen: boolean): DecisionAnalysis {
  const C = RULES.costs, maxAuto = ORDER.indexOf(caseOpen ? C.autoRecommendMax : 'L1');
  const el = (a: ResponseKey, p: number) => (1 - p) * C.actions[a].falseAlarmCost + p * C.actions[a].missFactor * C.missCost;
  const actions = ORDER.map((level, i) => ({ level: level as ResponseLevel, label: C.actions[level].label, expectedLoss: el(level, posterior), expectedLossLow: el(level, lo), expectedLossHigh: el(level, hi), autoAllowed: i <= maxAuto }));
  const allowed = actions.filter(a => a.autoAllowed);
  let pick = allowed.reduce((b, a) => (a.expectedLoss < b.expectedLoss ? a : b));
  let reason = `${pick.level} has the lowest expected loss at P(front) ${probEq(posterior)} (₹${Math.round(pick.expectedLoss).toLocaleString('en-IN')}).`;
  const idx = ORDER.indexOf(pick.level as ResponseKey);
  if (idx > 0) {
    const milder = actions[idx - 1];
    if (pick.expectedLossLow > milder.expectedLossLow) {
      reason += ` At the low end of the 90% interval (${fmtProb(lo)}) the milder ${milder.level} is cheaper, so we step down to ${milder.level}.`;
      pick = milder;
    }
  }
  if (!caseOpen) reason += ' No case is open, so only watch-level actions are recommended.';
  return { actions, recommended: pick.level, reason };
}
