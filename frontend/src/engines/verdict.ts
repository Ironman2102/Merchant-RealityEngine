/** Three outcomes, in the same words on every screen: a case, a question, or nothing. */
import type { InvestigationResult } from '../types/investigation';

export type Verdict = 'case' | 'ask' | 'clear';
export const verdictKind = (r: InvestigationResult): Verdict => (r.fusion.decision === 'OPEN_CASE' ? 'case' : r.fusion.followUp === 'ASK' ? 'ask' : 'clear');
export const VERDICT_TEXT: Record<Verdict, { badge: string; tone: 'bad' | 'warn' | 'ok'; outcome: string }> = {
  case: { badge: 'Case opened', tone: 'bad', outcome: 'Analyst review opened' },
  ask: { badge: 'Ask the merchant', tone: 'warn', outcome: 'Question to the merchant. Nothing restricted' },
  clear: { badge: 'No case', tone: 'ok', outcome: 'Nothing to explain' },
};
