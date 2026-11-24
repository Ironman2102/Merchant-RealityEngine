/** High-contrast Executive Verdict Hero Card shown at the top of the Case Dossier. */
import { AlertTriangle, CheckCircle2, IndianRupee, ShieldCheck } from 'lucide-react';
import type { InvestigationResult } from '../../types/investigation';
import { MECHANISMS, RESPONSE_LEVELS } from '../../data/evidence';
import { computeMerchantReality } from '../investigation/ClaimedVsReality';
import { Badge } from '../ui/ui';
import { cx, fmtInterval, fmtProb, inr } from '../../utils/format';

export function AnswerBanner({ result, quant = false }: { result: InvestigationResult; quant?: boolean }) {
  const open = result.fusion.decision === 'OPEN_CASE';
  const p = result.scenario.profile;
  const reality = computeMerchantReality(result);
  const level = RESPONSE_LEVELS.find(l => l.id === result.review.recommended);
  const topMech = MECHANISMS.find(m => m.id === result.fusion.mechanisms[0]?.id);
  const fired = [...result.evidence].filter(e => e.status === 'ILLICIT').sort((a, b) => b.llr - a.llr);
  const calm = result.evidence.filter(e => e.status === 'BENIGN');

  return (
    <div
      className={cx(
        'overflow-hidden rounded-2xl border shadow-sm',
        open ? 'border-rose-200 bg-white' : 'border-emerald-200 bg-white',
      )}
    >
      {/* Colored top risk accent strip */}
      <div className={cx('h-1.5 w-full', open ? 'bg-rose-500' : 'bg-emerald-500')} />

      <div className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          {/* Left: Verdict & plain-English diagnosis */}
          <div className="flex min-w-0 flex-1 items-start gap-3.5">
            <div
              className={cx(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
                open ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600',
              )}
            >
              {open ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={open ? 'bad' : 'ok'}>
                  {open ? `ESCALATE · ${result.fusion.priority} PRIORITY` : 'CLEARED · NO CASE OPENED'}
                </Badge>
                <span className="text-xs text-dim">MID {p.id} · MCC {p.mcc}</span>
              </div>
              <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-ink">
                {open ? 'Suspicious — Payment Activity Does Not Match Declared Business' : 'Looks Legitimate — Payments Match Declared Business'}
              </h2>
              <p className="mt-1 text-sm text-mute">
                {open
                  ? `${p.name} registered as a ${p.category.toLowerCase()} in ${p.city}, but its payment activity strongly resembles ${topMech ? topMech.name.toLowerCase() : 'an undeclared business'}.`
                  : `${p.name} behaves like the ${p.category.toLowerCase()} in ${p.city} that it declared during onboarding.`}
              </p>
            </div>
          </div>

          {/* Right: 2 High-Signal KPI Boxes (Front Likelihood + ₹ Monthly GMV) */}
          <div className="flex flex-wrap gap-3">
            <div className={cx('min-w-[165px] rounded-xl border px-4 py-3', open ? 'border-rose-200 bg-rose-50/60' : 'border-emerald-200 bg-emerald-50/60')}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-mute">Front Likelihood</div>
              <div className={cx('mt-0.5 font-mono text-2xl font-bold tabular-nums', open ? 'text-rose-700' : 'text-emerald-700')}>
                {fmtProb(result.fusion.posterior)}
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/80">
                <div
                  className={cx('h-full rounded-full', open ? 'bg-rose-500' : 'bg-emerald-500')}
                  style={{ width: `${Math.max(4, Math.min(100, result.fusion.posterior * 100))}%` }}
                />
              </div>
              {quant && <div className="mt-1 font-mono text-[10px] text-dim">90% CI: {fmtInterval(result.fusion.posteriorCi)}</div>}
            </div>

            <div className="min-w-[175px] rounded-xl border border-line bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-mute">
                <IndianRupee size={11} />
                {open ? 'Monthly GMV at Risk' : 'Protected Monthly GMV'}
              </div>
              <div className="mt-0.5 font-mono text-2xl font-bold tabular-nums text-ink">
                {inr(reality.monthlyGmv)}
              </div>
              <div className="mt-1 text-[11px] text-dim">
                {open ? 'Regulatory & chargeback exposure' : 'Spared from false-positive freeze'}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom 3-Column Action & Summary Strip */}
        <div className="mt-5 grid gap-3 border-t border-line pt-4 md:grid-cols-3">
          <div className="rounded-lg border border-line bg-slate-50/80 p-3.5 text-sm">
            <div className="text-xs font-semibold text-slate-500">Top Red Flags ({fired.length})</div>
            {fired.length > 0 ? (
              <ul className="mt-1.5 space-y-1 text-[13px] text-ink">
                {fired.slice(0, 2).map(e => (
                  <li key={e.id} className="truncate"><span className="font-semibold text-rose-700">•</span> <b>{e.name}:</b> {e.observed}</li>
                ))}
                {fired.length > 2 && <li className="text-xs font-medium text-rose-700">+ {fired.length - 2} more across {result.fusion.independentFamilies.length} evidence families</li>}
              </ul>
            ) : (
              <p className="mt-1.5 text-[13px] text-emerald-700 font-medium">
                0 red flags fired · {calm.length} normal checks confirmed.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-line bg-slate-50/80 p-3.5 text-sm">
            <div className="text-xs font-semibold text-slate-500">Governance Gate</div>
            <p className="mt-1.5 text-[13px] text-ink">{result.fusion.gateReason}</p>
          </div>

          <div className="rounded-lg border border-line bg-slate-50/80 p-3.5 text-sm">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500"><ShieldCheck size={13} className="text-indigo-600" />Recommended Next Step</div>
            <p className="mt-1.5 text-[13px] text-ink">
              <b>{result.review.recommended} — {level?.name ?? result.review.recommended}:</b> {level?.blurb}
            </p>
            <p className="mt-1 text-[11px] text-dim">Maker-checker enforced: no automated fund freeze.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
