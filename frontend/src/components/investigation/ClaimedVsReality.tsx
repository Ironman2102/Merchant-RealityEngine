import { AlertTriangle, CheckCircle2, Clock, CreditCard, Globe, IndianRupee, RefreshCcw } from 'lucide-react';
import type { InvestigationResult } from '../../types/investigation';
import { Badge, Card } from '../ui/ui';
import { cx, inr, pct } from '../../utils/format';

export interface RealitySnapshot {
  salesCount: number;
  observedGmv: number;
  monthlyGmv: number;
  medianTicket: number;
  p90Ticket: number;
  roundShare: number;
  outOfStateShare: number;
  offHoursShare: number;
  refundRate: number;
  upiLinkShare: number;
  hourlyCounts: number[];
  windowDays: number;
}

export function computeMerchantReality(result: InvestigationResult): RealitySnapshot {
  const sales = result.events.filter(e => e.type === 'SALE');
  const refunds = result.events.filter(e => e.type === 'REFUND');
  const p = result.scenario.profile;

  const amounts = sales.map(s => s.amount).sort((a, b) => a - b);
  const observedGmv = amounts.reduce((acc, v) => acc + v, 0);

  let windowDays = 14;
  if (sales.length >= 2) {
    const minT = sales[0].eventTime;
    const maxT = sales[sales.length - 1].eventTime;
    windowDays = Math.max(1, (maxT - minT) / 86_400_000);
  }
  const monthlyGmv = Math.round((observedGmv / windowDays) * 30);

  const medianTicket = amounts.length ? amounts[Math.floor(amounts.length / 2)] : 0;
  const p90Ticket = amounts.length ? amounts[Math.min(amounts.length - 1, Math.floor(amounts.length * 0.9))] : 0;
  const roundCount = sales.filter(s => s.amount >= 500 && s.amount % 500 === 0).length;
  const roundShare = sales.length ? roundCount / sales.length : 0;

  const localSet = new Set(p.localStates.map(s => s.toUpperCase()));
  const geoKnown = sales.filter(s => s.payerState && s.payerState !== 'UNKNOWN');
  const outOfStateCount = geoKnown.filter(s => !localSet.has(s.payerState.toUpperCase())).length;
  const outOfStateShare = geoKnown.length ? outOfStateCount / geoKnown.length : 0;

  const hourlyCounts = Array.from({ length: 24 }, () => 0);
  const [openH, closeH] = p.hours;
  let offHoursCount = 0;
  for (const s of sales) {
    // Convert UTC epoch to IST (UTC+5:30)
    const istHour = new Date(s.eventTime + 19_800_000).getUTCHours();
    hourlyCounts[istHour]++;
    const isOpen = closeH === 24 ? true : (istHour >= openH && istHour < closeH);
    if (!isOpen) offHoursCount++;
  }
  const offHoursShare = sales.length ? offHoursCount / sales.length : 0;

  const refundRate = sales.length ? refunds.length / sales.length : 0;
  const upiLinkShare = sales.length
    ? sales.filter(s => s.channel === 'UPI_LINK' || s.channel === 'UPI_COLLECT').length / sales.length
    : 0;

  return {
    salesCount: sales.length,
    observedGmv,
    monthlyGmv,
    medianTicket,
    p90Ticket,
    roundShare,
    outOfStateShare,
    offHoursShare,
    refundRate,
    upiLinkShare,
    hourlyCounts,
    windowDays,
  };
}

function MatchPill({ mismatch, warn }: { mismatch: boolean; warn?: boolean }) {
  if (mismatch) {
    return (
      <Badge tone="bad">
        <AlertTriangle size={11} />Mismatch
      </Badge>
    );
  }
  if (warn) {
    return (
      <Badge tone="warn">
        <AlertTriangle size={11} />Watch
      </Badge>
    );
  }
  return (
    <Badge tone="ok">
      <CheckCircle2 size={11} />Matches KYC
    </Badge>
  );
}

export function ClaimedVsReality({ result }: { result: InvestigationResult }) {
  const p = result.scenario.profile;
  const r = computeMerchantReality(result);
  const maxHour = Math.max(1, ...r.hourlyCounts);
  const [openH, closeH] = p.hours;

  const ticketMismatch = r.medianTicket > p.ticketMax * 1.4 || r.roundShare > 0.45;
  const geoMismatch = p.catchment === 'LOCAL' && r.outOfStateShare > 0.4;
  const hoursMismatch = closeH < 24 && r.offHoursShare > 0.25;
  const refundMismatch = r.refundRate > 0.08 && result.l1.refundLinkage.orphan > 0;
  const channelWarn = p.catchment === 'LOCAL' && r.upiLinkShare > 0.65;

  const rows = [
    {
      icon: IndianRupee,
      label: 'Ticket Size & Round Bills',
      claimed: `${inr(p.ticketMin)} – ${inr(p.ticketMax)} typical bill`,
      observed: `Median ${inr(Math.round(r.medianTicket))} · P90 ${inr(Math.round(r.p90Ticket))} · ${pct(r.roundShare)} exact ₹500+ multiples`,
      barValue: r.roundShare,
      barLabel: 'Exact round-number share',
      mismatch: ticketMismatch,
      warn: !ticketMismatch && r.roundShare > 0.25,
    },
    {
      icon: Globe,
      label: 'Customer Geography',
      claimed: p.catchment === 'LOCAL' ? `Local walk-ins (${p.localStates.join(', ')})` : 'Pan-India / National customers',
      observed: `${pct(r.outOfStateShare)} of payers outside ${p.localStates.join(', ')}`,
      barValue: r.outOfStateShare,
      barLabel: 'Out-of-state payer share',
      mismatch: geoMismatch,
      warn: !geoMismatch && p.catchment === 'LOCAL' && r.outOfStateShare > 0.2,
    },
    {
      icon: Clock,
      label: 'Operating Hours (IST)',
      claimed: closeH === 24 ? 'Open 24 hours' : `Open ${String(openH).padStart(2, '0')}:00 – ${String(closeH).padStart(2, '0')}:00`,
      observed: closeH === 24 ? 'Active across all hours' : `${pct(r.offHoursShare)} of payments processed while shop is closed`,
      barValue: r.offHoursShare,
      barLabel: 'Off-hours transaction share',
      mismatch: hoursMismatch,
      warn: !hoursMismatch && closeH < 24 && r.offHoursShare > 0.12,
    },
    {
      icon: CreditCard,
      label: 'Payment Channel Mix',
      claimed: p.catchment === 'LOCAL' ? `In-store POS / counter QR (${p.category})` : `Online checkout (${p.category})`,
      observed: `${pct(r.upiLinkShare)} via remote UPI links / collect requests`,
      barValue: r.upiLinkShare,
      barLabel: 'Remote UPI link share',
      mismatch: channelWarn && result.fusion.decision === 'OPEN_CASE',
      warn: channelWarn && result.fusion.decision !== 'OPEN_CASE',
    },
    {
      icon: RefreshCcw,
      label: 'Refunds & Payout Linkage',
      claimed: 'Refunds tied to original customer orders',
      observed: `${pct(r.refundRate)} refund rate · ${result.l1.refundLinkage.orphan} unlinked / orphan refund(s)`,
      barValue: Math.min(1, r.refundRate * 4),
      barLabel: 'Refund intensity',
      mismatch: refundMismatch,
      warn: !refundMismatch && result.l1.refundLinkage.orphan > 0,
    },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
      {/* Left: Claimed vs. Reality table */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-slate-50/80 px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold text-ink">Declared KYC Profile vs. Observed Payment Reality</h3>
            <p className="text-xs text-mute">Side-by-side contrast across {r.salesCount.toLocaleString()} observed sales ({Math.round(r.windowDays)} days)</p>
          </div>
          <Badge tone={result.fusion.decision === 'OPEN_CASE' ? 'bad' : 'ok'}>
            {rows.filter(x => x.mismatch).length} mismatch{rows.filter(x => x.mismatch).length === 1 ? '' : 'es'}
          </Badge>
        </div>

        <div className="divide-y divide-line">
          {rows.map(row => (
            <div key={row.label} className={cx('grid gap-3 px-5 py-3.5 sm:grid-cols-[1fr_1.15fr_auto] sm:items-center', row.mismatch && 'bg-rose-50/40')}>
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                  <row.icon size={14} className={row.mismatch ? 'text-rose-600' : 'text-slate-500'} />
                  {row.label}
                </div>
                <div className="mt-1 text-xs text-mute">
                  <span className="font-medium text-slate-500">Claimed:</span> {row.claimed}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-ink">{row.observed}</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={cx('h-full rounded-full transition-all', row.mismatch ? 'bg-rose-500' : row.warn ? 'bg-amber-500' : 'bg-emerald-500')}
                      style={{ width: `${Math.max(4, Math.min(100, row.barValue * 100))}%` }}
                    />
                  </div>
                  <span className="w-9 text-right font-mono text-[11px] text-dim">{pct(row.barValue)}</span>
                </div>
              </div>
              <div className="sm:justify-self-end">
                <MatchPill mismatch={row.mismatch} warn={row.warn} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Right: 24-Hour IST Activity Chart */}
      <Card className="flex flex-col overflow-hidden">
        <div className="border-b border-line bg-slate-50/80 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-ink">24-Hour Payment Activity (IST)</h3>
          <p className="text-xs text-mute">
            {closeH === 24
              ? 'Declared open 24 hours · bars show hourly transaction volume'
              : `Declared open ${String(openH).padStart(2, '0')}:00–${String(closeH).padStart(2, '0')}:00 · rose bars = payments while closed`}
          </p>
        </div>

        <div className="flex flex-1 flex-col justify-between p-5">
          <div className="flex h-44 items-end gap-1 pt-2" role="img" aria-label="24-hour transaction distribution">
            {r.hourlyCounts.map((count, hour) => {
              const isOpen = closeH === 24 ? true : (hour >= openH && hour < closeH);
              const heightPct = count === 0 ? 3 : Math.max(8, Math.round((count / maxHour) * 100));
              const isOffSpike = !isOpen && count > 0;
              return (
                <div key={hour} className="group relative flex h-full flex-1 flex-col items-center justify-end">
                  <div
                    title={`${String(hour).padStart(2, '0')}:00 IST — ${count} txns (${isOpen ? 'within open hours' : 'closed hours'})`}
                    className={cx(
                      'w-full rounded-t transition-all',
                      count === 0
                        ? 'bg-slate-100'
                        : isOffSpike
                          ? 'bg-rose-500 hover:bg-rose-600'
                          : 'bg-indigo-500/80 hover:bg-indigo-600',
                    )}
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex justify-between border-t border-line pt-2 font-mono text-[10px] text-dim">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>23:00</span>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-slate-50 px-3.5 py-2.5 text-xs">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-mute"><span className="h-2.5 w-2.5 rounded-sm bg-indigo-500/80" />Open hours</span>
              <span className="inline-flex items-center gap-1.5 text-mute"><span className="h-2.5 w-2.5 rounded-sm bg-rose-500" />Closed hours</span>
            </div>
            <span className={cx('font-semibold', hoursMismatch ? 'text-rose-700' : 'text-emerald-700')}>
              {pct(r.offHoursShare)} off-hours
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
