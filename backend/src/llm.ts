/**
 * Case summary. The verdict never comes from a language model.
 *  - templateSummary: deterministic text built only from the trace (always available).
 *  - verifySummary: rejects any text that cites a number or detector id the trace does not contain; any future
 *    AI-written summary must pass it, and falls back to the template if it does not.
 * AI drafting is OFF: it needs the official @anthropic-ai/sdk (not installed; awaiting approval) and an
 * explicit model choice. llmEnabled() stays false until then.
 */
import type { Trace } from '../../frontend/src/engines/traceEngine';
import { buildTrace } from '../../frontend/src/engines/traceEngine';
import { fmtInterval, probEq } from '../../frontend/src/utils/format';
import { getCase, isCaseId } from './store';
import type { ApiReply } from './workflow';
import type { Actor } from './auth';

export const llmEnabled = () => false;

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

/** Every number (incl. ₹ amounts and percentages) and every detector-like id in `text` must appear in the trace. */
export function verifySummary(text: string, t: Trace): { ok: boolean; unsupported: string[] } {
  const hay = JSON.stringify(t) + ' ' + templateSummary(t);
  const norm = (s: string) => s.replace(/[₹,%\s]/g, '');
  const hayNums = new Set((hay.match(/\d+(?:\.\d+)?/g) ?? []).map(norm));
  // Whole-rupee and 1-2 decimal roundings of every trace number (summaries quote ₹81,533, not 81533.42).
  for (const m of hay.match(/\d+\.\d+/g) ?? []) { const v = Number(m); hayNums.add(String(Math.round(v))); hayNums.add(v.toFixed(1)); hayNums.add(v.toFixed(2)); }
  // Percent/ratio forms present in the trace (e.g. 0.783 → "78", "78.3").
  for (const m of JSON.stringify(t).match(/0\.\d+/g) ?? []) { const v = Number(m) * 100; hayNums.add(String(Math.round(v))); hayNums.add(v.toFixed(1)); }
  const unsupported = [
    ...(text.match(/₹?\d[\d,]*(?:\.\d+)?%?/g) ?? []).filter(n => !hayNums.has(norm(n).replace(/\.0+$/, ''))),
    ...(text.match(/\b[A-K]\d{1,2}\b/g) ?? []).filter(id => !t.detectors.some(d => d.id === id)),
  ];
  return { ok: unsupported.length === 0, unsupported };
}

export async function summarise(id: string, _actor: Actor): Promise<ApiReply> {
  if (!isCaseId(id)) return { status: 400, body: { error: 'Invalid case id.' } };
  const rec = getCase(id);
  if (!rec) return { status: 404, body: { error: 'No case with that id.' } };
  const t = buildTrace(rec.result), text = templateSummary(t);
  return { status: 200, body: { source: 'template', text, verified: verifySummary(text, t) } };
}
