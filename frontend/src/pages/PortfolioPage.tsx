import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Download, FileUp, GitFork, ShieldAlert, ShieldCheck, Sliders } from 'lucide-react';
import { usePortfolio, type PortfolioEntry } from '../hooks/usePortfolio';
import { useInvestigation } from '../hooks/useInvestigation';
import { MECHANISMS } from '../data/evidence';
import { LADDER } from '../engines/patternPack';
import { computeMerchantReality } from '../components/investigation/ClaimedVsReality';
import { scorePortfolio } from '../../../engine/portfolio';
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
  const { entries, rings, loading, mode } = usePortfolio();
  const { loadCustom } = useInvestigation();
  const nav = useNavigate();
  const [view, setView] = useState<View>('all');
  const sus = entries.filter(e => e.suspicious), clear = entries.filter(e => !e.suspicious);
  const rows = view === 'suspicious' ? sus : view === 'cleared' ? clear : entries;
  const userMode = mode === 'user';
  const [fdrQueue, setFdrQueue] = useState<PortfolioQueue | null>(null);
  const [capacity, setCapacity] = useState(65);

  const batchReport = useMemo(() => {
    if (!entries.length) return null;
    let totalGmv = 0, gmvAtRisk = 0, gmvPreserved = 0;
    const mechCounts = new Map<string, { id: string; name: string; count: number; gmv: number }>();
    for (const e of entries) {
      const reality = computeMerchantReality(e.result);
      totalGmv += reality.monthlyGmv;
      if (e.suspicious) {
        gmvAtRisk += reality.monthlyGmv;
        const top = [...e.result.fusion.mechanisms].sort((a, b) => b.score - a.score)[0];
        if (top) {
          const name = MECHANISMS.find(m => m.id === top.id)?.name ?? top.id;
          const prev = mechCounts.get(top.id) ?? { id: top.id, name, count: 0, gmv: 0 };
          mechCounts.set(top.id, { ...prev, count: prev.count + 1, gmv: prev.gmv + reality.monthlyGmv });
        }
      } else {
        gmvPreserved += reality.monthlyGmv;
      }
    }
    const fdr = scorePortfolio(entries.map(e => ({
      merchantId: e.scenario.profile.id,
      name: e.scenario.profile.name,
      posterior: e.result.fusion.posterior,
      ci: e.result.fusion.posteriorCi,
      expectedLoss: e.result.fusion.decisionAnalysis.actions.find(a => a.level === e.result.fusion.decisionAnalysis.recommended)?.expectedLoss ?? 0,
      action: e.result.fusion.decisionAnalysis.recommended,
      decision: e.result.fusion.decision,
    })));
    return { totalGmv, gmvAtRisk, gmvPreserved, mechanisms: [...mechCounts.values()].sort((a, b) => b.count - a.count), fdr };
  }, [entries]);

  const downloadBlob = (filename: string, content: string, mime: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = () => {
    const header = 'merchant_id,name,mcc,decision,p_front,p_lo,p_hi,priority,recommended,mechanism,monthly_gmv_inr,flags\n';
    const lines = entries.map(e => {
      const f = e.result.fusion;
      const top = [...f.mechanisms].sort((a, b) => b.score - a.score)[0]?.id ?? '';
      const gmv = Math.round(computeMerchantReality(e.result).monthlyGmv);
      return [
        e.scenario.profile.id,
        `"${e.scenario.profile.name.replace(/"/g, '""')}"`,
        e.scenario.profile.mcc,
        f.decision,
        f.posterior.toFixed(6),
        f.posteriorCi[0].toFixed(6),
        f.posteriorCi[1].toFixed(6),
        f.priority,
        f.decisionAnalysis.recommended,
        top,
        gmv,
        e.coreFlags + e.patternFlags,
      ].join(',');
    });
    downloadBlob('mre-portfolio-scores.csv', header + lines.join('\n'), 'text/csv');
  };

  const exportReportJson = () => {
    if (!batchReport) return;
    const payload = {
      generatedAt: new Date().toISOString(),
      merchantsScanned: entries.length,
      casesOpened: sus.length,
      cleared: clear.length,
      expectedFalseAlarms: batchReport.fdr.expectedFalseAlarms,
      totalMonthlyGmvInr: Math.round(batchReport.totalGmv),
      gmvAtRiskInr: Math.round(batchReport.gmvAtRisk),
      gmvPreservedInr: Math.round(batchReport.gmvPreserved),
      crossMerchantRings: rings.rings,
      mechanisms: batchReport.mechanisms,
      queue: batchReport.fdr.queue,
    };
    downloadBlob('mre-overall-portfolio-report.json', JSON.stringify(payload, null, 2), 'application/json');
  };

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

  const exportCasesJsonl = () => {
    const lines = sus.map(e => {
      const f = e.result.fusion;
      return JSON.stringify({
        merchantId: e.scenario.profile.id,
        name: e.scenario.profile.name,
        posterior: f.posterior,
        ci: f.posteriorCi,
        recommended: f.decisionAnalysis.recommended,
        gateReason: f.gateReason,
      });
    });
    downloadBlob('mre-cases.jsonl', lines.join('\n') + (lines.length ? '\n' : ''), 'application/x-ndjson');
  };

  const activeQueue = userMode && entries.length > 1 && batchReport
    ? batchReport.fdr
    : fdrQueue;
  const activeTotalMerchants = userMode && entries.length > 1 ? entries.length : 1000;
  const activeBenchmarkFronts = userMode && entries.length > 1 ? Math.max(1, sus.length) : 72;

  const totalQueueLoss = activeQueue ? activeQueue.queue.reduce((s, x) => s + x.expectedLoss, 0) : 0;
  const effectiveCap = activeQueue ? Math.min(capacity, activeQueue.queue.length) : capacity;
  const activeSlice = activeQueue ? activeQueue.queue.slice(0, effectiveCap) : [];
  const activeLoss = activeSlice.reduce((s, x) => s + x.expectedLoss, 0);
  const activeFalseAlarms = activeSlice.reduce((s, x) => s + (1 - x.posterior), 0);
  const activeExpectedFronts = activeSlice.reduce((s, x) => s + x.posterior, 0);
  const estRecallPct = Math.min(100, (activeExpectedFronts / activeBenchmarkFronts) * 100);
  const lossCoveredPct = totalQueueLoss > 0 ? (activeLoss / totalQueueLoss) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{userMode ? 'Portfolio & Bayesian-FDR Queue' : 'Demo merchant portfolio'}</h1>
          <p className="mt-1 max-w-2xl text-sm text-mute">{userMode ? 'Inspect your uploaded merchant analysis and simulate analyst team capacity across the 1,000-merchant portfolio queue.' : 'Four prebuilt demo merchants, analyzed through the seven layers. Open one to inspect the Executive Dossier and proof.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {entries.length > 0 && (
            <>
              <Btn variant="outline" size="sm" onClick={exportCsv}><Download size={14} />Export CSV</Btn>
              <Btn variant="outline" size="sm" onClick={exportCasesJsonl}><Download size={14} />Export cases.jsonl</Btn>
              <Btn variant="outline" size="sm" onClick={exportReportJson}><Download size={14} />Export Overall Report</Btn>
            </>
          )}
          {userMode && <Link to="/ai-engine/analyze"><Btn variant="primary"><FileUp size={15} />Analyze a dataset / bulk list</Btn></Link>}
        </div>
      </div>

      {entries.length > 0 && batchReport && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ['Merchants reviewed', entries.length, 'text-ink', loading ? 'loading…' : userMode ? 'your uploaded data' : 'four demo merchants'],
              ['Cases opened', sus.length, 'text-rose-700', `${batchReport.fdr.expectedFalseAlarms.toFixed(2)} expected false alarms (FDR)`],
              ['Cleared (live)', clear.length, 'text-emerald-700', 'no disruption to genuine sales'],
              ['Monthly GMV at risk', inr(Math.round(batchReport.gmvAtRisk)), 'text-rose-700', `of ${inr(Math.round(batchReport.totalGmv))} total`],
              ['Genuine GMV preserved', inr(Math.round(batchReport.gmvPreserved)), 'text-emerald-700', `${rings.rings.length} cross-MID ring(s) found`],
            ].map(([l, v, c, s]) => (
              <Card key={l as string} className="px-4 py-3.5">
                <div className="text-xs font-medium text-mute">{l}</div>
                <div className={cx('mt-1 text-xl font-bold tabular-nums', c as string)}>{v}</div>
                <div className="text-[11px] text-dim">{s}</div>
              </Card>
            ))}
          </div>

          {(batchReport.mechanisms.length > 0 || rings.rings.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {batchReport.mechanisms.length > 0 && (
                <Panel title="Overall Risk Breakdown by Mechanism" subtitle="Flagged merchants grouped by primary inferred mechanism.">
                  <div className="space-y-2.5 text-sm">
                    {batchReport.mechanisms.map(m => (
                      <div key={m.id} className="flex items-center justify-between rounded-lg border border-line bg-panel2 px-3 py-2">
                        <div>
                          <div className="font-medium text-ink">{m.name}</div>
                          <div className="text-xs text-mute">{m.count} merchant(s)</div>
                        </div>
                        <div className="font-mono text-xs font-semibold text-rose-700">{inr(Math.round(m.gmv))} / mo</div>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}
              <Panel
                title="Cross-Merchant Rings & Split-MID Links (N4 / N5)"
                subtitle="Detects shared settlement beneficiaries and overlapping payer cohorts across uploaded MIDs."
                right={<Badge tone={rings.rings.length > 0 ? 'bad' : 'ok'}>{rings.rings.length} link(s)</Badge>}
              >
                {rings.rings.length === 0 ? (
                  <p className="text-xs text-mute">No shared beneficiaries or overlapping payer cohorts detected across the current {entries.length} merchant(s).</p>
                ) : (
                  <div className="space-y-2.5 text-xs">
                    {rings.rings.map(r => (
                      <div key={r.key} className="rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 font-semibold text-rose-900"><GitFork size={13} />{r.label}</span>
                          <Badge tone={r.severity === 'HIGH' ? 'bad' : 'info'}>{r.metricLabel}</Badge>
                        </div>
                        <div className="mt-1 text-rose-800">{r.merchants.map(m => `${m.name} (${m.id})`).join(' · ')}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          )}

          <Tabs<View> value={view} onChange={setView} tabs={[{ id: 'all', label: `All (${entries.length})` }, { id: 'suspicious', label: `Suspicious (${sus.length})` }, { id: 'cleared', label: `Cleared (${clear.length})` }]} />

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs text-mute"><tr>
                {['Merchant', 'Declared business', 'Verdict', 'Monthly GMV', 'Main reason', 'Flags', 'Next step', ''].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
              <tbody>{rows.map(e => {
                const v = verdictOf(e), p = e.scenario.profile, step = LADDER.find(l => l.id === e.pack.ladder)!;
                const reality = computeMerchantReality(e.result);
                return (
                  <tr key={e.key} onClick={() => { if (userMode) loadCustom(e.scenario, true); nav(`${userMode ? '/ai-engine' : '/demo'}/portfolio/${e.key}`); }} className={cx('cursor-pointer border-t border-line transition-colors hover:bg-slate-50', e.suspicious && 'bg-rose-50/30')}>
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

      {userMode && activeQueue && (
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
                  <p className="text-xs text-mute">Slide to match your daily analyst review bandwidth across {activeTotalMerchants.toLocaleString('en-IN')} merchants</p>
                </div>
              </div>
              <Badge tone="info">Top {effectiveCap} cases / day</Badge>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-medium text-mute">Daily analyst review capacity: <b className="text-ink">{effectiveCap} cases</b></span>
                <span className="text-dim">Queue opened: {activeQueue.opened} / {activeTotalMerchants.toLocaleString('en-IN')} merchants</span>
              </div>
              <input
                type="range"
                min={1}
                max={Math.max(activeQueue.queue.length, 10)}
                step={1}
                value={effectiveCap}
                onChange={e => setCapacity(Number(e.target.value))}
                aria-label="Daily analyst review capacity"
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-indigo-600"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-dim">
                <span>1/day</span>
                <span>{Math.max(2, Math.round(activeQueue.queue.length / 2))}/day</span>
                <span>{Math.max(activeQueue.queue.length, 10)}/day (full queue)</span>
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
                <div className="text-[11px] text-emerald-700/80">~{activeExpectedFronts.toFixed(1)} of {activeBenchmarkFronts} flagged fronts</div>
              </div>
              <div className="rounded-xl border border-line bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium text-mute">Expected False Alarms</div>
                <div className="mt-0.5 font-mono text-xl font-bold text-ink">{activeFalseAlarms.toFixed(2)}</div>
                <div className="text-[11px] text-dim">Bayesian FDR q ≤ 10%</div>
              </div>
            </div>
          </Card>

          <Panel
            title={`${activeTotalMerchants.toLocaleString('en-IN')}-Merchant Portfolio Scan — Bayesian FDR Queue (q ≤ 10%)`}
            subtitle={`${activeQueue.opened} cases opened · ${activeQueue.expectedFalseAlarms.toFixed(2)} expected false alarms. Sorted by expected rupee loss.`}
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
                {activeQueue.queue.map((item, idx) => {
                  const inToday = idx < effectiveCap;
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
