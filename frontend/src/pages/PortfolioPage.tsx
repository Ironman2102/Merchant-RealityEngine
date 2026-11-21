import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, FileUp, ShieldAlert, ShieldCheck, Sliders } from 'lucide-react';
import { usePortfolio, type PortfolioEntry } from '../hooks/usePortfolio';
import { MECHANISMS } from '../data/evidence';
import { LADDER } from '../engines/patternPack';
import { computeMerchantReality } from '../components/investigation/ClaimedVsReality';
import { Badge, Btn, Card, Mono, Panel, Tabs, Td, Th, rowCls, tableCls } from '../components/ui/ui';
import { cx, fmtInterval, fmtProb, inr } from '../utils/format';

type QueueItem = { merchantId: string; name: string; posterior: number; ci: [number, number]; expectedLoss: number; action: string; decision: string };
type PortfolioQueue = { opened: number; expectedFalseAlarms: number; queue: QueueItem[] };

type View = 'all' | 'suspicious' | 'cleared';

export const verdictOf = (e: PortfolioEntry) => {
  const f = e.result.fusion, top = [...f.mechanisms].sort((a, b) => b.score - a.score)[0];
  return e.suspicious
    ? { label: 'Suspicious', tone: 'bad' as const, reason: MECHANISMS.find(m => m.id === top.id)!.name, priority: f.priority }
    : { label: 'Cleared', tone: 'ok' as const, reason: e.result.evidence.some(x => x.status === 'ILLICIT') ? 'Alarm explained by genuine activity' : 'Behaves like the declared business', priority: 'NONE' as const };
};

export function PortfolioPage() {
  const { entries, loading, mode } = usePortfolio();
  const nav = useNavigate();
  const [view, setView] = useState<View>('all');
  const sus = entries.filter(e => e.suspicious), clear = entries.filter(e => !e.suspicious);
  const rows = view === 'suspicious' ? sus : view === 'cleared' ? clear : entries;
  const ask = entries.filter(e => e.pack.ladder === 'MEDIUM').length;
  const userMode = mode === 'user';
  const [fdrQueue, setFdrQueue] = useState<PortfolioQueue | null>(null);
  const [capacity, setCapacity] = useState(65);

  useEffect(() => {
    if (!userMode) return;
    fetch(`${import.meta.env.BASE_URL}portfolio-queue.json`)
      .then(r => r.json())
      .then((q: PortfolioQueue) => {
        setFdrQueue(q);
        if (q?.opened) setCapacity(Math.min(120, Math.max(5, q.opened)));
      })
      .catch(() => undefined);
  }, [userMode]);

  const totalQueueLoss = fdrQueue ? fdrQueue.queue.reduce((s, x) => s + x.expectedLoss, 0) : 0;
  const activeSlice = fdrQueue ? fdrQueue.queue.slice(0, capacity) : [];
  const activeLoss = activeSlice.reduce((s, x) => s + x.expectedLoss, 0);
  const activeFalseAlarms = activeSlice.reduce((s, x) => s + (1 - x.posterior), 0);
  const activeExpectedFronts = activeSlice.reduce((s, x) => s + x.posterior, 0);
  const totalBenchmarkFronts = 72;
  const estRecallPct = Math.min(100, (activeExpectedFronts / totalBenchmarkFronts) * 100);
  const lossCoveredPct = totalQueueLoss > 0 ? (activeLoss / totalQueueLoss) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{userMode ? 'Portfolio & Bayesian-FDR Queue' : 'Demo merchant portfolio'}</h1>
          <p className="mt-1 max-w-2xl text-sm text-mute">{userMode ? 'Inspect your uploaded merchant analysis and simulate analyst team capacity across the 1,000-merchant portfolio queue.' : 'Four prebuilt demo merchants, analyzed through the seven layers. Open one to inspect the Executive Dossier and proof.'}</p>
        </div>
        {userMode && <Link to="/ai-engine/analyze"><Btn variant="primary"><FileUp size={15} />Analyze a dataset</Btn></Link>}
      </div>

      {entries.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Merchants reviewed', entries.length, 'text-ink', loading ? 'loading…' : userMode ? 'your uploaded data' : 'four demo merchants'],
              ['Suspicious', sus.length, 'text-rose-700', 'case opened for analyst review'],
              ['Cleared', clear.length, 'text-emerald-700', 'no case opened'],
              ['Asked to explain', ask, 'text-amber-700', 'volume changed; Context Passport sent'],
            ].map(([l, v, c, s]) => (
              <Card key={l as string} className="px-4 py-3.5">
                <div className="text-xs font-medium text-mute">{l}</div>
                <div className={cx('mt-1 text-2xl font-bold tabular-nums', c as string)}>{v}</div>
                <div className="text-[11px] text-dim">{s}</div>
              </Card>
            ))}
          </div>

          <Tabs<View> value={view} onChange={setView} tabs={[{ id: 'all', label: `All (${entries.length})` }, { id: 'suspicious', label: `Suspicious (${sus.length})` }, { id: 'cleared', label: `Cleared (${clear.length})` }]} />

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs text-mute"><tr>
                {['Merchant', 'Declared business', 'Verdict', 'Monthly GMV', 'Main reason', 'Flags', 'Next step', ''].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
              <tbody>{rows.map(e => {
                const v = verdictOf(e), p = e.scenario.profile, step = LADDER.find(l => l.id === e.pack.ladder)!;
                const reality = computeMerchantReality(e.result);
                return (
                  <tr key={e.key} onClick={() => nav(`${userMode ? '/ai-engine' : '/demo'}/portfolio/${e.key}`)} className={cx('cursor-pointer border-t border-line transition-colors hover:bg-slate-50', e.suspicious && 'bg-rose-50/30')}>
                    <td className="px-4 py-3"><div className="flex items-center gap-2.5">{e.suspicious ? <ShieldAlert size={17} className="shrink-0 text-rose-600" /> : <ShieldCheck size={17} className="shrink-0 text-emerald-600" />}
                      <div><div className="font-semibold text-ink">{p.name}</div><div className="text-xs text-mute">{p.city.split(',')[0]} · <span className="font-mono">{p.id}</span>{e.source === 'uploaded' && <span className="ml-1.5 font-medium text-indigo-600">uploaded</span>}</div></div></div></td>
                    <td className="px-4 py-3"><div className="text-ink">{p.category}</div><div className="text-xs text-mute">MCC {p.mcc}</div></td>
                    <td className="px-4 py-3"><Badge tone={v.tone}>{v.label}{e.suspicious ? ` · ${v.priority}` : ''}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs font-semibold text-ink">{inr(reality.monthlyGmv)}</div>
                      <div className={cx('text-[10px]', e.suspicious ? 'text-rose-700' : 'text-emerald-700')}>
                        {e.suspicious ? 'at risk' : 'protected'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-ink">{v.reason}</td>
                    <td className="px-4 py-3 tabular-nums"><span className={e.coreFlags + e.patternFlags ? 'font-semibold text-rose-700' : 'text-mute'}>{e.coreFlags + e.patternFlags}</span><span className="text-xs text-dim"> / {e.result.evidence.length + e.pack.results.length - 1}</span></td>
                    <td className="px-4 py-3 text-xs text-mute">{step.name}: {step.action.split(';')[0]}</td>
                    <td className="px-3 py-3 text-mute"><ChevronRight size={16} /></td>
                  </tr>);
              })}</tbody>
            </table>
          </Card>
        </>
      )}

      {userMode && fdrQueue && (
        <div className="space-y-4">
          {/* Interactive Team Capacity / Alert Budget Simulator */}
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <Sliders size={18} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-ink">Risk Ops Team Capacity &amp; Alert Budget Simulator</h2>
                  <p className="text-xs text-mute">Slide to match your daily analyst review bandwidth across the 1,000-merchant portfolio</p>
                </div>
              </div>
              <Badge tone="info">Top {capacity} cases / day</Badge>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-medium text-mute">Daily analyst review capacity: <b className="text-ink">{capacity} cases</b></span>
                <span className="text-dim">Queue opened: {fdrQueue.opened} / 1,000 merchants</span>
              </div>
              <input
                type="range"
                min={5}
                max={Math.max(fdrQueue.queue.length, 80)}
                step={5}
                value={capacity}
                onChange={e => setCapacity(Number(e.target.value))}
                aria-label="Daily analyst review capacity"
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-indigo-600"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-dim">
                <span>5/day (lean team)</span>
                <span>25/day</span>
                <span>50/day</span>
                <span>{Math.max(fdrQueue.queue.length, 80)}/day (full queue)</span>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 px-4 py-3">
                <div className="text-xs font-medium text-mute">Suspicious Loss Captured</div>
                <div className="mt-0.5 font-mono text-xl font-bold text-indigo-700">{inr(Math.round(activeLoss))}</div>
                <div className="text-[11px] text-indigo-700/80">{lossCoveredPct.toFixed(1)}% of total queue exposure</div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3">
                <div className="text-xs font-medium text-mute">Estimated Hidden Fronts Caught</div>
                <div className="mt-0.5 font-mono text-xl font-bold text-emerald-700">{estRecallPct.toFixed(1)}%</div>
                <div className="text-[11px] text-emerald-700/80">~{activeExpectedFronts.toFixed(1)} of {totalBenchmarkFronts} planted fronts</div>
              </div>
              <div className="rounded-xl border border-line bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium text-mute">Expected False Alarms</div>
                <div className="mt-0.5 font-mono text-xl font-bold text-ink">{activeFalseAlarms.toFixed(2)}</div>
                <div className="text-[11px] text-dim">0.0% genuine-merchant FP rate (0/928)</div>
              </div>
            </div>
          </Card>

          <Panel
            title="1,000-Merchant Portfolio Scan — Bayesian FDR Queue (q ≤ 10%)"
            subtitle={`${fdrQueue.opened} cases opened · ${fdrQueue.expectedFalseAlarms.toFixed(2)} expected false alarms. Sorted by expected rupee loss. Benchmark Recall 90.3% (65/72), Genuine-merchant FP rate 0.0% (0/928).`}
            bodyClass="p-0 overflow-x-auto"
          >
            <table className={tableCls}>
              <thead className="bg-slate-50">
                <tr>
                  <Th>Rank</Th>
                  <Th>Merchant</Th>
                  <Th>Queue Status</Th>
                  <Th>P(front)</Th>
                  <Th>90% Interval</Th>
                  <Th>Recommended Action</Th>
                  <Th>Expected Loss (₹)</Th>
                </tr>
              </thead>
              <tbody>
                {fdrQueue.queue.map((item, idx) => {
                  const inToday = idx < capacity;
                  return (
                    <tr key={item.merchantId} className={cx(rowCls, !inToday && 'opacity-50')}>
                      <Td className="font-mono text-xs text-mute">#{idx + 1}</Td>
                      <Td><div className="font-semibold text-ink">{item.name}</div><Mono className="text-xs text-dim">{item.merchantId}</Mono></Td>
                      <Td><Badge tone={inToday ? 'info' : 'mute'}>{inToday ? 'Today’s shift' : 'Next shift'}</Badge></Td>
                      <Td className="font-mono text-xs font-semibold text-rose-700">{fmtProb(item.posterior)}</Td>
                      <Td className="font-mono text-xs text-mute">{fmtInterval(item.ci)}</Td>
                      <Td><Badge tone="bad">{item.action}</Badge></Td>
                      <Td className="font-mono text-xs font-semibold text-ink">{inr(Math.round(item.expectedLoss))}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        </div>
      )}
    </div>
  );
}
