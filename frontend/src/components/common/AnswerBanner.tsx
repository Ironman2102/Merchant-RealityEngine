/** Plain-English executive verdict card shown at the top of an investigation before diving into the 7 layers. */
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import type { InvestigationResult } from '../../types/investigation';
import { MECHANISMS, RESPONSE_LEVELS } from '../../data/evidence';
import { fmtInterval, fmtProb, inr } from '../../utils/format';

export function AnswerBanner({ result, quant = false }: { result: InvestigationResult; quant?: boolean }) {
  const open = result.fusion.decision === 'OPEN_CASE';
  const p = result.scenario.profile;
  const level = RESPONSE_LEVELS.find(l => l.id === result.review.recommended);
  const topMech = MECHANISMS.find(m => m.id === result.fusion.mechanisms[0]?.id);
  const fired = [...result.evidence].filter(e => e.status === 'ILLICIT').sort((a, b) => b.llr - a.llr);
  const calm = result.evidence.filter(e => e.status === 'BENIGN');
  const unknown = result.evidence.filter(e => e.status === 'UNKNOWN');

  return (
    <div className={`rounded-lg border p-5 ${open ? 'border-neutral-400/40 bg-panel' : 'border-gray-400/30 bg-panel'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {open
            ? <AlertTriangle size={22} className="mt-0.5 shrink-0 text-neutral-300" />
            : <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-gray-300" />}
          <div>
            <div className="text-xs uppercase tracking-wider text-mute">Plain-English Verdict</div>
            <h2 className="mt-0.5 text-2xl font-semibold">
              {open ? 'Suspicious — Open a Case for Analyst Review' : 'Looks Legitimate — No Case Opened'}
            </h2>
            <p className="mt-1 text-sm text-mute">
              {open
                ? `${p.name} registered as a ${p.category.toLowerCase()} in ${p.city}, but its payment activity looks like ${topMech ? topMech.name.toLowerCase() : 'another undeclared business'}.`
                : `${p.name} behaves like the ${p.category.toLowerCase()} in ${p.city} that it declared at onboarding.`}
            </p>
          </div>
        </div>
        <div className="rounded border border-line bg-panel2 px-4 py-2.5 text-right">
          <div className="text-[11px] uppercase tracking-wider text-mute">Front likelihood</div>
          <div className="font-mono text-2xl font-semibold">{fmtProb(result.fusion.posterior)}</div>
          {quant && <div className="font-mono text-[11px] text-dim">90% CI: {fmtInterval(result.fusion.posteriorCi)}</div>}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded border border-line bg-panel2 p-3.5 text-sm">
          <div className="text-xs font-medium text-mute">What the merchant claimed</div>
          <p className="mt-1 text-[13px]">
            <b>{p.category}</b> in {p.city}, typical bill {inr(p.ticketMin)}–{inr(p.ticketMax)},{' '}
            {p.catchment === 'LOCAL' ? `local customers (${p.localStates.join(', ')})` : 'national customers'}, open{' '}
            {p.hours[1] === 24 ? '24 hours' : `${p.hours[0]}:00–${p.hours[1]}:00`}.
          </p>
        </div>

        <div className="rounded border border-line bg-panel2 p-3.5 text-sm">
          <div className="text-xs font-medium text-mute">
            {open ? `Why it was flagged (${fired.length} red flags)` : `What checked out (${calm.length} normal checks)`}
          </div>
          {fired.length > 0 ? (
            <ul className="mt-1 space-y-1 text-[13px]">
              {fired.slice(0, 2).map(e => (
                <li key={e.id}>• <b>{e.name}:</b> {e.observed}</li>
              ))}
              {fired.length > 2 && <li className="text-xs text-mute">+ {fired.length - 2} more red flag(s) across {result.fusion.independentFamilies.length} evidence families</li>}
            </ul>
          ) : (
            <p className="mt-1 text-[13px]">
              No red flags fired. {unknown.length > 0 ? `${unknown.length} checks had no data feed and were ignored (never counted against the shop).` : 'All feeds matched the declared business.'}
            </p>
          )}
        </div>

        <div className="rounded border border-line bg-panel2 p-3.5 text-sm">
          <div className="flex items-center gap-1.5 text-xs font-medium text-mute"><ShieldCheck size={13} />Recommended next step</div>
          <p className="mt-1 text-[13px]">
            <b>{result.review.recommended} — {level?.name ?? result.review.recommended}:</b> {level?.blurb}
          </p>
          <p className="mt-1 text-xs text-dim">
            Nothing freezes money automatically. Any restriction requires a second person’s approval.
          </p>
        </div>
      </div>
    </div>
  );
}
