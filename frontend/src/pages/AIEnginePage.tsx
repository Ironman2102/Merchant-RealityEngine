import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileUp, RefreshCw } from 'lucide-react';
import { useInvestigation } from '../hooks/useInvestigation';
import { Badge, Btn } from '../components/ui/ui';
import { listPilotCases, type PilotCaseSummary } from '../services/pilotApi';
import { ModelSandbox } from '../components/trace/ModelSandbox';

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
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Is this shop someone else’s front?</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed">A merchant can pass KYC and still process payments for a different business. This tool reads the payments and says whether to open a case.</p>
        </div>
        <Link to="/ai-engine/analyze"><Btn variant="primary"><FileUp size={15} />Check a merchant <ArrowRight size={14} /></Btn></Link>
      </div>
      <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line md:grid-cols-3">
        <div className="bg-panel p-5"><div className="mre-eyebrow">The problem</div><p className="mt-2 text-sm">A registered shop can take payments that do not belong to the business it declared.</p></div>
        <div className="bg-panel p-5"><div className="mre-eyebrow">The output</div><p className="mt-2 text-sm">Open a case, or do not. You also get a probability and a range, not a bare yes.</p></div>
        <div className="bg-panel p-5"><div className="mre-eyebrow">The limit</div><p className="mt-2 text-sm">A second person approves anything that restricts funds. The trained model is a second opinion and does not decide.</p></div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Link to="/ai-engine/analyze?sample=01-sweet-crumbs-betting-front.json" className="rounded-xl border border-bad/30 bg-panel p-4 transition hover:border-bad/45 hover:bg-bad/5">
          <div className="flex items-center justify-between"><span className="mre-eyebrow">Worked example · case expected</span><Badge tone="bad">Suspicious</Badge></div>
          <div className="mt-2 font-semibold text-ink">Sweet Crumbs Bakery</div>
          <p className="mt-1 text-sm text-mute">Declared as a local bakery. Payments look like betting deposits. The tool opens a case.</p>
        </Link>
        <Link to="/ai-engine/analyze?sample=04-anand-sweets-diwali-genuine.json" className="rounded-xl border border-ok/30 bg-panel p-4 transition hover:border-ok/45 hover:bg-ok/5">
          <div className="flex items-center justify-between"><span className="mre-eyebrow">Worked example · no case expected</span><Badge tone="ok">Legitimate</Badge></div>
          <div className="mt-2 font-semibold text-ink">Anand Sweets &amp; Bakes</div>
          <p className="mt-1 text-sm text-mute">Sales jump in the Diwali fortnight and still look like a sweet shop. Spared from a false freeze.</p>
        </Link>
      </div>
      <div className="rounded-lg border border-line bg-panel px-4 py-3">
        <ModelSandbox />
        <p className="mt-2 text-xs text-dim">Checking a file starts the model sandbox, runs the model, then stops the sandbox. That does not change the case decision.</p>
      </div>

      {custom && started && <div className="rounded-lg border border-line bg-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="mre-eyebrow">Current run</div><h2 className="mt-1 text-xl font-semibold">{custom.profile.name}</h2><p className="mt-1 text-sm text-mute">{custom.profile.city} · {custom.profile.category} · {custom.events.length.toLocaleString()} records</p></div><Badge tone={allDone ? 'ok' : 'info'}>{allDone ? 'Analysis complete' : `Running · ${completedLayers} of 7 layers`}</Badge></div>
        {allDone ? <><div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded border border-line bg-bg p-3"><div className="text-xs text-mute">Case decision</div><div className="mt-1 font-semibold">{result.fusion.decision === 'OPEN_CASE' ? 'Review recommended' : 'No case opened'}</div></div><div className="rounded border border-line bg-bg p-3"><div className="text-xs text-mute">Signals needing review</div><div className="mt-1 font-semibold">{findings}</div></div><div className="rounded border border-line bg-bg p-3"><div className="text-xs text-mute">Priority</div><div className="mt-1 font-semibold">{result.fusion.priority}</div></div></div><p className="mt-3 text-sm text-mute">{result.fusion.gateReason}</p><Link to="/ai-engine/investigations" className="mt-4 inline-flex"><Btn>Open findings <ArrowRight size={14} /></Btn></Link></> : <div className="mt-5 h-1.5 overflow-hidden rounded bg-panel2"><div className="h-full rounded bg-ink transition-all" style={{ width: `${(completedLayers / 7) * 100}%` }} /></div>}
      </div>}

      <section className="rounded-lg border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4"><div><h2 className="font-semibold">Investigation cases</h2><p className="mt-1 text-xs text-mute">Cases saved by this local backend instance.</p></div><Btn size="sm" onClick={() => void refresh()} disabled={loading}><RefreshCw size={13} />Refresh</Btn></div>
        {error && <div className="px-5 py-4 text-sm text-neutral-300" role="alert">{error}{error.includes('Sign in') ? ' Sign in again. The hosted case list does not use a local start script.' : <> Start the app with <span className="font-mono">./start.sh</span> when you are running it on this computer.</>}</div>}
        {!error && loading && <div className="px-5 py-8 text-center text-sm text-mute">Loading saved cases…</div>}
        {!error && !loading && cases.length === 0 && <div className="px-5 py-9 text-center"><div className="text-sm font-medium">No saved cases yet</div><p className="mt-1 text-xs text-mute">Upload a dataset to create the first investigation.</p><Link to="/ai-engine/analyze" className="mt-4 inline-flex"><Btn size="sm" variant="primary"><FileUp size={13} />Analyze a dataset</Btn></Link></div>}
        {!error && cases.length > 0 && <p className="border-b border-line px-5 py-3 text-sm" data-testid="portfolio-queue">{cases.filter(c => c.result.decision === 'OPEN_CASE').length} opened / {cases.length} saved cases · about {cases.filter(c => c.result.decision === 'OPEN_CASE').reduce((s, c) => s + (1 - (c.result.posterior ?? 0)), 0).toFixed(2)} expected false alarms</p>}
        {!error && cases.length > 0 && <div className="divide-y divide-line">{cases.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div className="min-w-0"><div className="font-medium">{item.merchant.name}</div><div className="mt-1 text-xs text-mute">{item.merchant.city} · {item.merchant.category} · {new Date(item.createdAt).toLocaleString()}</div><div className="mt-2 flex flex-wrap gap-1.5"><Badge tone={item.result.decision === 'OPEN_CASE' ? 'bad' : 'ok'}>{item.result.decision === 'OPEN_CASE' ? `${item.result.priority} review` : 'No case opened'}</Badge>{item.user.label && <Badge tone="info">{item.user.label.replaceAll('_', ' ')}</Badge>}</div></div><Link to={`/ai-engine/cases/${encodeURIComponent(item.id)}`}><Btn size="sm">Open case <ArrowRight size={13} /></Btn></Link></div>)}</div>}
      </section>
    </div>
  );
}
