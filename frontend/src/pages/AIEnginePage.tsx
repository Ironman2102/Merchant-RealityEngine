import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileUp, RefreshCw, Sparkles } from 'lucide-react';
import { useInvestigation } from '../hooks/useInvestigation';
import { Badge, Btn } from '../components/ui/ui';
import { listPilotCases, type PilotCaseSummary } from '../services/pilotApi';

export function AIEnginePage() {
  const { custom, started, allDone, status, result } = useInvestigation();
  const [cases, setCases] = useState<PilotCaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const completedLayers = Object.values(status).filter(s => s === 'done').length;
  const findings = result.evidence.filter(e => e.status === 'ILLICIT').length;
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setCases(await listPilotCases()); }
    catch (e) { setError(e instanceof Error ? e.message : 'The case service is not reachable.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="mx-auto max-w-5xl space-y-7 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-mute"><Sparkles size={14} /> MERCHANT RISK WORKSPACE</div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">AI Engine</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mute">Ingest a merchant dataset, inspect explainable risk signals, record an analyst review, and keep the case available for follow-up.</p>
        </div>
        <Link to="/ai-engine/analyze"><Btn variant="primary"><FileUp size={15} />Start an analysis <ArrowRight size={14} /></Btn></Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['Data intake', 'Validated JSON upload', 'info'],
          ['Case storage', 'Local JSON persistence', 'warn'],
          ['Partner connectors', 'None configured', 'mute'],
        ].map(([label, value, tone]) => <div key={label} className="rounded-lg border border-line bg-panel p-4"><div className="text-xs text-mute">{label}</div><div className="mt-2"><Badge tone={tone as 'info' | 'warn' | 'mute'}>{value}</Badge></div></div>)}
      </div>

      {custom && started && <div className="rounded-lg border border-line bg-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs text-mute">CURRENT RUN</div><h2 className="mt-1 text-xl font-semibold">{custom.profile.name}</h2><p className="mt-1 text-sm text-mute">{custom.profile.city} · {custom.profile.category} · {custom.events.length.toLocaleString()} records</p></div><Badge tone={allDone ? 'ok' : 'info'}>{allDone ? 'Analysis complete' : `Running · ${completedLayers} of 7 layers`}</Badge></div>
        {allDone ? <><div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded border border-line bg-bg p-3"><div className="text-xs text-mute">Case decision</div><div className="mt-1 font-semibold">{result.fusion.decision === 'OPEN_CASE' ? 'Review recommended' : 'No case opened'}</div></div><div className="rounded border border-line bg-bg p-3"><div className="text-xs text-mute">Signals needing review</div><div className="mt-1 font-semibold">{findings}</div></div><div className="rounded border border-line bg-bg p-3"><div className="text-xs text-mute">Priority</div><div className="mt-1 font-semibold">{result.fusion.priority}</div></div></div><p className="mt-3 text-sm text-mute">{result.fusion.gateReason}</p><Link to="/ai-engine/investigations" className="mt-4 inline-flex"><Btn>Open findings <ArrowRight size={14} /></Btn></Link></> : <div className="mt-5 h-1.5 overflow-hidden rounded bg-panel2"><div className="h-full rounded bg-zinc-300 transition-all" style={{ width: `${(completedLayers / 7) * 100}%` }} /></div>}
      </div>}

      <section className="rounded-lg border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4"><div><h2 className="font-semibold">Investigation cases</h2><p className="mt-1 text-xs text-mute">Cases saved by this local backend instance.</p></div><Btn size="sm" onClick={() => void refresh()} disabled={loading}><RefreshCw size={13} />Refresh</Btn></div>
        {error && <div className="px-5 py-4 text-sm text-neutral-300">{error} Start the app with <span className="font-mono">./start.sh</span> to connect to the case service.</div>}
        {!error && loading && <div className="px-5 py-8 text-center text-sm text-mute">Loading saved cases…</div>}
        {!error && !loading && cases.length === 0 && <div className="px-5 py-9 text-center"><div className="text-sm font-medium">No saved cases yet</div><p className="mt-1 text-xs text-mute">Upload a dataset to create the first investigation.</p><Link to="/ai-engine/analyze" className="mt-4 inline-flex"><Btn size="sm" variant="primary"><FileUp size={13} />Analyze a dataset</Btn></Link></div>}
        {!error && cases.length > 0 && <div className="divide-y divide-line">{cases.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div className="min-w-0"><div className="font-medium">{item.merchant.name}</div><div className="mt-1 text-xs text-mute">{item.merchant.city} · {item.merchant.category} · {new Date(item.createdAt).toLocaleString()}</div><div className="mt-2 flex flex-wrap gap-1.5"><Badge tone={item.result.decision === 'OPEN_CASE' ? 'bad' : 'ok'}>{item.result.decision === 'OPEN_CASE' ? `${item.result.priority} review` : 'No case opened'}</Badge>{item.user.label && <Badge tone="info">{item.user.label.replaceAll('_', ' ')}</Badge>}</div></div><Link to={`/ai-engine/cases/${encodeURIComponent(item.id)}`}><Btn size="sm">Open case <ArrowRight size={13} /></Btn></Link></div>)}</div>}
      </section>
    </div>
  );
}
