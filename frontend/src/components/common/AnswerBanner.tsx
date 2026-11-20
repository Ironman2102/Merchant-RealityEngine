/** The decision, in one block, before the working. */
import type { InvestigationResult } from '../../types/investigation';
import { RESPONSE_LEVELS } from '../../data/evidence';
import { fmtInterval, fmtProb } from '../../utils/format';

export function AnswerBanner({ result }: { result: InvestigationResult }) {
  const open = result.fusion.decision === 'OPEN_CASE';
  const level = RESPONSE_LEVELS.find(l => l.id === result.review.recommended);
  const top = [...result.evidence].filter(e => e.status === 'ILLICIT').sort((a, b) => b.llr - a.llr)[0];
  return (
    <div className="rounded-lg border border-line bg-panel p-5">
      <div className="text-xs text-mute">The answer</div>
      <h2 className="mt-1 text-2xl font-semibold">{open ? 'Open a case' : 'No case'}</h2>
      <p className="mt-2 font-mono text-sm text-mute">{fmtProb(result.fusion.posterior)} · {fmtInterval(result.fusion.posteriorCi)}</p>
      <p className="mt-3 text-sm">{top ? top.observed : result.fusion.gateReason}</p>
      <p className="mt-2 text-sm text-mute">Next step: {level ? `${level.name}. ${level.blurb}` : result.review.recommended} A second person must approve anything that restricts funds.</p>
    </div>
  );
}
