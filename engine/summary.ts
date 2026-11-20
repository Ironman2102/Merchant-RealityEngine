/** Deterministic case summary. Built only from the trace. The verdict never comes from a language model. */
import type { Trace } from '../frontend/src/engines/traceEngine';
import { fmtInterval, probEq } from '../frontend/src/utils/format';

export function templateSummary(t: Trace): string {
  const fired = t.detectors.filter(d => d.status === 'ILLICIT').sort((a, b) => b.llr - a.llr).slice(0, 3);
  const unknown = t.detectors.filter(d => d.status === 'UNKNOWN').length;
  const voi = t.valueOfInformation[0];
  return [
    `${t.caseSummary.merchant} (MCC ${t.caseSummary.mcc}): ${t.caseSummary.decision === 'OPEN_CASE' ? 'case opened' : 'no case opened'}.`,
    `P(front) ${probEq(t.caseSummary.posterior)} (${fmtInterval(t.caseSummary.ci)}), from a base rate of ${probEq(t.caseSummary.prior).replace(/^= /, '')}.`,
    fired.length ? `Strongest evidence: ${fired.map(d => `${d.id} ${d.name} (${d.observed})`).join('; ')}.` : 'No detector fired.',
    `${unknown} detector(s) had no data and did not move the score.`,
    `Recommended response ${t.caseSummary.action}. ${t.decision.reason}`,
    voi && voi.voiRupees > 0 ? `Most useful missing data: the ${voi.feed} feed (detector ${voi.detector}).` : '',
  ].filter(Boolean).join(' ');
}
