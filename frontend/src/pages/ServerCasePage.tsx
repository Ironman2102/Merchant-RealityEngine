import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Badge, Btn, Panel } from '../components/ui/ui';
import { getPilotCase, updatePilotCase } from '../services/pilotApi';

type Detail = {
  id: string; createdAt: string;
  merchant: { id: string; name: string; category: string; city: string };
  result: { decision: string; priority: string; recommended: string; legitStatus: string; gateReason: string; topMechanism: string; evidence: { illicit: number; benign: number; unknown: number } };
  user: { notes: string; clarification: string; chosenLevel: string | null; legalVerified: boolean; escrowConfirmed: boolean; executed: boolean; label: string | null };
  workflow: { layer: number; code: string; name: string; state: string; summary: string }[];
  coverage: { name: string; state: string; records: number; note: string }[];
  evidenceItems: { id: string; name: string; family: string; status: string; observed: string; expected: string; explanation: string; sourceRecordIds: string[] }[];
  audit: { at: string; actor: string; action: string; detail: string }[];
};

export function ServerCasePage() {
  const { id = '' } = useParams();
  const [item, setItem] = useState<Detail | null>(null);
  const [notes, setNotes] = useState('');
  const [clarification, setClarification] = useState('');
  const [level, setLevel] = useState('L2');
  const [legalVerified, setLegalVerified] = useState(false);
  const [escrowConfirmed, setEscrowConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const loaded = await getPilotCase(id) as Detail;
      setItem(loaded); setNotes(loaded.user.notes ?? ''); setClarification(loaded.user.clarification ?? ''); setLevel(loaded.user.chosenLevel ?? loaded.result.recommended);
      setLegalVerified(loaded.user.legalVerified); setEscrowConfirmed(loaded.user.escrowConfirmed);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load this case.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [id]);

  const send = async (action: 'review' | 'response' | 'label', payload: Record<string, unknown>) => {
    setSaving(true); setError('');
    try { setItem(await updatePilotCase(id, action, payload) as Detail); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save the case update.'); }
    finally { setSaving(false); }
  };
  const saveReview = (e: FormEvent) => { e.preventDefault(); void send('review', { notes, clarification }); };

  if (loading) return <div className="py-12 text-center text-sm text-mute">Loading case…</div>;
  if (!item) return <div className="space-y-4 py-8"><p className="text-sm text-neutral-300">{error || 'Case not found.'}</p><Link to="/ai-engine"><Btn><ArrowLeft size={14} />Back to workspace</Btn></Link></div>;

  return <div className="space-y-6">
    <Link to="/ai-engine" className="inline-flex items-center gap-2 text-sm text-mute hover:text-ink"><ArrowLeft size={14} />All investigations</Link>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-mono text-xs text-mute">{item.id} · {new Date(item.createdAt).toLocaleString()}</div><h1 className="mt-2 text-3xl font-semibold">{item.merchant.name}</h1><p className="mt-1 text-sm text-mute">{item.merchant.city} · {item.merchant.category}</p></div><Btn size="sm" onClick={() => void load()} disabled={loading}><RefreshCw size={13} />Refresh</Btn></header>
    {error && <div className="rounded border border-neutral-400/30 bg-neutral-400/5 px-4 py-3 text-sm text-neutral-200">{error}</div>}
    <div className="rounded border border-stone-400/30 bg-stone-400/5 px-4 py-3 text-xs leading-relaxed text-stone-200">Pilot safety: this case engine records an analyst’s proposed response. It has no connection to payment rails and does not freeze, restrict, or terminate an account.</div>

    <Panel title="Decision summary" subtitle={item.result.gateReason} right={<Badge tone={item.result.decision === 'OPEN_CASE' ? 'bad' : 'ok'}>{item.result.decision === 'OPEN_CASE' ? `${item.result.priority} review` : 'No case opened'}</Badge>}>
      <div className="grid gap-3 sm:grid-cols-4"><div><div className="text-xs text-mute">Recommended</div><div className="mt-1 font-medium">{item.result.recommended}</div></div><div><div className="text-xs text-mute">Leading mechanism</div><div className="mt-1 font-medium">{item.result.topMechanism}</div></div><div><div className="text-xs text-mute">Legitimate chain</div><div className="mt-1 font-medium">{item.result.legitStatus}</div></div><div><div className="text-xs text-mute">Evidence</div><div className="mt-1 font-medium">{item.result.evidence.illicit} suspicious · {item.result.evidence.benign} benign · {item.result.evidence.unknown} unknown</div></div></div>
    </Panel>

    <Panel title="Analysis workflow" subtitle="Completed steps are shown with their server-recorded summary.">
      <ol className="space-y-3">{item.workflow.map(step => <li key={step.layer} className="grid gap-1 sm:grid-cols-[10rem_6rem_1fr] sm:gap-3"><span className="font-medium">{step.code} {step.name}</span><Badge tone={step.state === 'done' ? 'ok' : step.state === 'blocked' ? 'bad' : 'mute'}>{step.state}</Badge><span className="text-sm text-mute">{step.summary}</span></li>)}</ol>
    </Panel>

    <Panel title="Evidence and data coverage" subtitle="Signal explanations include the source record IDs used by each detector.">
      <div className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{item.coverage.map(c => <div key={c.name} className="rounded border border-line bg-bg p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{c.name}</span><Badge tone={c.state === 'AVAILABLE' ? 'ok' : c.state === 'PARTIAL' ? 'warn' : 'mute'}>{c.state}</Badge></div><p className="mt-1 text-[11px] text-mute">{c.records} records · {c.note}</p></div>)}</div>
      <div className="space-y-2">{item.evidenceItems.map(ev => <details key={ev.id} className="rounded border border-line bg-bg px-3 py-2.5"><summary className="flex cursor-pointer list-none flex-wrap items-center gap-2"><span className="font-mono text-xs text-zinc-300">{ev.id}</span><span className="text-sm font-medium">{ev.name}</span><Badge tone={ev.status === 'ILLICIT' ? 'bad' : ev.status === 'BENIGN' ? 'ok' : 'mute'}>{ev.status}</Badge></summary><div className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div><span className="text-mute">Observed: </span>{ev.observed}</div><div><span className="text-mute">Expected: </span>{ev.expected}</div><p className="sm:col-span-2 text-mute">{ev.explanation}</p><div className="sm:col-span-2"><span className="text-mute">Source records: </span>{ev.sourceRecordIds.length ? ev.sourceRecordIds.join(', ') : 'No individual records attached'}</div></div></details>)}</div>
    </Panel>

    <Panel title="Analyst review" subtitle="Save the rationale and merchant clarification to the case record.">
      <form onSubmit={saveReview} className="space-y-3"><div className="grid gap-3 md:grid-cols-2"><label className="text-xs text-mute">Review notes<textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} className="mt-1 w-full rounded border border-line2 bg-bg px-3 py-2 text-sm text-ink" placeholder="What did you verify? What remains open?" /></label><label className="text-xs text-mute">Merchant clarification<textarea value={clarification} onChange={e => setClarification(e.target.value)} rows={4} className="mt-1 w-full rounded border border-line2 bg-bg px-3 py-2 text-sm text-ink" placeholder="Record the merchant’s explanation, if provided." /></label></div><Btn variant="primary" disabled={saving}>{saving ? 'Saving…' : 'Save analyst review'}</Btn></form>
    </Panel>

    <Panel title="Proposed response and outcome" subtitle="This records a workflow decision only; no external action is executed.">
      <div className="flex flex-wrap items-end gap-3"><label className="text-xs text-mute">Response level<select value={level} onChange={e => setLevel(e.target.value)} className="mt-1 block rounded border border-line2 bg-bg px-3 py-2 text-sm text-ink">{['L0','L1','L2','L3','L4','L5'].map(x => <option key={x}>{x}</option>)}</select></label><label className="flex items-center gap-2 pb-2 text-xs text-mute"><input type="checkbox" checked={legalVerified} onChange={e => setLegalVerified(e.target.checked)} />Authority reviewed</label>{level === 'L4' && <label className="flex items-center gap-2 pb-2 text-xs text-mute"><input type="checkbox" checked={escrowConfirmed} onChange={e => setEscrowConfirmed(e.target.checked)} />Contract clause reviewed</label>}<Btn disabled={saving} onClick={() => void send('response', { chosenLevel: level, legalVerified, escrowConfirmed })}>Record proposed response</Btn></div>
      {item.user.executed && <div className="mt-3 flex flex-wrap gap-2"><Btn disabled={saving} onClick={() => void send('label', { label: 'CONFIRMED_ILLICIT' })}>Label confirmed illicit</Btn><Btn disabled={saving} onClick={() => void send('label', { label: 'ADJUDICATED_BENIGN' })}>Label benign</Btn><Btn disabled={saving} onClick={() => void send('label', { label: 'UNRESOLVED' })}>Leave unresolved</Btn></div>}
      {item.user.label && <p className="mt-3 text-xs text-mute">Recorded label: {item.user.label.replaceAll('_', ' ')}</p>}
    </Panel>

    <Panel title="Audit history" subtitle="Recorded workflow actions for this case.">{item.audit.length ? <ol className="space-y-2">{item.audit.map((entry, i) => <li key={`${entry.at}-${i}`} className="rounded border border-line bg-bg p-3"><div className="flex flex-wrap justify-between gap-2 text-xs"><span className="font-medium">{entry.action}</span><span className="text-mute">{entry.actor} · {new Date(entry.at).toLocaleString()}</span></div>{entry.detail && <p className="mt-1 text-xs text-mute">{entry.detail}</p>}</li>)}</ol> : <p className="text-sm text-mute">No analyst actions recorded yet.</p>}</Panel>
  </div>;
}
