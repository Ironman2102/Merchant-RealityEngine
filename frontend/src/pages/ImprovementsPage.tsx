/**
 * Rule changes under human control: search or learn, backtest on a holdout, approve by someone else, promote, roll back.
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Play, RotateCcw, Sparkles } from 'lucide-react';
import { Badge, Btn, Callout, Mono, Panel, Td, Th, rowCls, tableCls } from '../components/ui/ui';
import { fmtProb } from '../utils/format';

type Metrics = { tp: number; fpCount: number; nFront: number; nGenuine: number };
type Backtest = { champion: Metrics; challenger: Metrics; mcnemarP: number };
type StoredProposal = {
  id: string;
  kind: 'threshold' | 'calibration';
  status: 'proposed' | 'approved' | 'rejected' | 'live' | 'rolled_back';
  requestedBy: { username: string };
  approvedBy?: string | null;
  patch: Record<string, Record<string, number>>;
  rationale: string;
  backtest: Backtest;
};
type RulesStatus = {
  rulesVersion: string;
  livePatch: Record<string, unknown> | null;
  rollbackRequest: { by: { username: string }; at: string } | null;
  evasionCheck: { salesCount: number; operator: string; decision: string; followUp: string; posterior: number };
  proposals: StoredProposal[];
  audit: { seq: number; actor: string; action: string; detail: string; hash: string }[];
  auditVerification: { ok: boolean; entries: number };
  minLabels: number;
  labelledMerchants: number;
  learnedRates: { detectorId: string; name: string; priorSensitivity: number; priorFalsePositive: number; sensitivity: number; falsePositive: number; nPos: number; nNeg: number }[];
};

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function Result({ b }: { b: Backtest }) {
  return (
    <div className="grid gap-2 text-xs sm:grid-cols-3">
      <div className="rounded border border-line bg-panel p-2.5"><div className="text-mute">Fronts caught</div><Mono>{b.champion.tp} → {b.challenger.tp}</Mono> of {b.champion.nFront}</div>
      <div className="rounded border border-line bg-panel p-2.5"><div className="text-mute">Honest merchants wrongly opened</div><Mono>{b.champion.fpCount} → {b.challenger.fpCount}</Mono> of {b.champion.nGenuine}</div>
      <div className="rounded border border-line bg-panel p-2.5"><div className="text-mute">Chance the gain is luck (McNemar)</div><Mono>p = {b.mcnemarP.toFixed(4)}</Mono></div>
    </div>
  );
}

export function ImprovementsPage() {
  const [status, setStatus] = useState<RulesStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string; backtest?: Backtest | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/rules/status');
      if (r.ok) setStatus(await r.json() as RulesStatus);
      else setNote({ ok: false, text: 'Could not load the rules status.' });
    } catch { setNote({ ok: false, text: 'The rules service is not reachable.' }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const call = async (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(true); setNote(null);
    try {
      const r = await fetch(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json = await r.json().catch(() => ({})) as RulesStatus & { error?: string; backtest?: Backtest | null };
      if (!r.ok) { setNote({ ok: false, text: json.error ?? `Request returned ${r.status}`, backtest: json.backtest }); await load(); return; }
      setStatus(json); setNote({ ok: true, text: done });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : 'Could not reach the rules service.' });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Rule changes, under human control</h1>
          <p className="mt-1 max-w-3xl text-sm text-mute">The engine can suggest a change. It is tested on merchants that played no part in choosing it, including small honest ones, and it goes live only when a different person approves it.</p>
        </div>
        {status && <div className="flex flex-wrap gap-2"><Badge tone={status.livePatch ? 'info' : 'mute'}>Rules {status.rulesVersion}</Badge><Badge tone={status.auditVerification.ok ? 'ok' : 'bad'}>Audit {status.auditVerification.ok ? `verified (${status.auditVerification.entries})` : 'BROKEN'}</Badge></div>}
      </div>

      {note && <Callout tone={note.ok ? 'info' : 'warn'} title={note.ok ? 'Recorded' : 'Not done'}>{note.text}{note.backtest && <div className="mt-2"><Result b={note.backtest} /></div>}</Callout>}

      {status && <>
        <Panel title="1. Look for a threshold fix" subtitle="A thin account hides below the minimum sample size. Lowering that minimum is only safe if small honest shops are not caught too. A refusal is a valid result."
          right={<Btn size="sm" variant="primary" disabled={busy} onClick={() => void call('/rules/proposals/run', { mode: 'threshold' }, 'A change passed the holdout and is waiting for another person.')}><Play size={13} />{busy ? 'Testing…' : 'Search and backtest'}</Btn>}>
          <p className="text-sm">Probe: {status.evasionCheck.operator.toLowerCase()} ({status.evasionCheck.salesCount} sales). Today: <b>{status.evasionCheck.decision === 'OPEN_CASE' ? 'case opened' : status.evasionCheck.followUp === 'ASK' ? 'asked to explain, no case' : 'not noticed'}</b> at {fmtProb(status.evasionCheck.posterior)}.</p>
        </Panel>

        <Panel title="2. Learn from analyst labels" subtitle={`Labels never change a score by themselves. With ${status.minLabels}+ merchants carrying the same label, they can propose a calibration. ${status.labelledMerchants} labelled so far.`}
          right={<Btn size="sm" disabled={busy} onClick={() => void call('/rules/proposals/run', { mode: 'calibration' }, 'A calibration passed the holdout and is waiting for another person.')}>Propose calibration</Btn>} bodyClass="p-0 overflow-x-auto">
          {status.learnedRates.length ? (
            <table className={tableCls}>
              <thead><tr><Th>Detector</Th><Th>Hit rate</Th><Th>False-alarm rate</Th><Th>Labels</Th></tr></thead>
              <tbody>{status.learnedRates.map(r => (
                <tr key={r.detectorId} className={rowCls}>
                  <Td><Mono>{r.detectorId}</Mono> {r.name}</Td>
                  <Td className="font-mono text-xs">{pct(r.priorSensitivity)} → {pct(r.sensitivity)}</Td>
                  <Td className="font-mono text-xs">{pct(r.priorFalsePositive)} → {pct(r.falsePositive)}</Td>
                  <Td className="text-xs text-mute">{r.nPos} illicit · {r.nNeg} benign</Td>
                </tr>))}</tbody>
            </table>) : <p className="p-5 text-sm text-mute">No labels yet.</p>}
        </Panel>

        <Panel title="3. Approve, promote, roll back" subtitle="The requester can never approve, promote or confirm a rollback. Reviewer or admin only."
          right={status.livePatch && !status.rollbackRequest ? <Btn size="sm" disabled={busy} onClick={() => void call('/rules/rollback', {}, 'Rollback requested. A different reviewer or admin must confirm it.')}><RotateCcw size={13} />Request rollback</Btn> : undefined}>
          {status.rollbackRequest && (
            <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-panel2 p-3 text-sm">
              <span>Rollback to the base rules requested by <b>{status.rollbackRequest.by.username}</b>. A different reviewer or admin confirms it.</span>
              <span className="flex gap-2">
                <Btn size="sm" variant="primary" disabled={busy} onClick={() => void call('/rules/rollback', {}, 'Back on the committed base rules.')}>Confirm rollback</Btn>
                <Btn size="sm" disabled={busy} onClick={() => void call('/rules/rollback', { reject: true }, 'The rollback request is closed.')}>Reject or withdraw</Btn>
              </span>
            </div>)}
          {!status.proposals.length && <p className="text-sm text-mute">No proposal is waiting.</p>}
          <div className="space-y-3">{status.proposals.map(p => (
            <div key={p.id} className="space-y-2 rounded border border-line bg-panel2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm"><Mono>{p.id}</Mono> <Badge>{p.kind}</Badge> <Badge tone={p.status === 'live' ? 'ok' : p.status === 'approved' ? 'info' : 'mute'}>{p.status}</Badge> <span className="text-xs text-mute">requested by {p.requestedBy.username}{p.approvedBy ? ` · approved by ${p.approvedBy}` : ''}</span></div>
                {p.status === 'proposed' && <Btn size="sm" variant="primary" disabled={busy} onClick={() => void call(`/rules/proposals/${p.id}/approve`, {}, 'Approved. It can now be promoted.')}><CheckCircle2 size={13} />Approve</Btn>}
                {p.status === 'approved' && <Btn size="sm" variant="primary" disabled={busy} onClick={() => void call(`/rules/proposals/${p.id}/promote`, {}, 'The change is live.')}><Sparkles size={13} />Promote</Btn>}
              </div>
              <p className="text-xs text-mute">{p.rationale}</p>
              <p className="font-mono text-xs">{Object.entries(p.patch).map(([id, v]) => `${id} ${Object.entries(v).map(([k, n]) => `${k}=${n}`).join(' ')}`).join(' · ')}</p>
              <Result b={p.backtest} />
            </div>))}</div>
        </Panel>

        {status.audit.length > 0 && (
          <Panel title="Rules audit" bodyClass="p-0 overflow-x-auto">
            <table className={tableCls}><thead><tr><Th>#</Th><Th>Who</Th><Th>What</Th><Th>Detail</Th><Th>Hash</Th></tr></thead>
              <tbody>{status.audit.map(a => <tr key={a.seq} className={rowCls}><Td>{a.seq}</Td><Td className="text-xs">{a.actor}</Td><Td className="text-xs">{a.action}</Td><Td className="text-xs text-mute">{a.detail}</Td><Td><Mono>{a.hash.slice(0, 12)}</Mono></Td></tr>)}</tbody></table>
          </Panel>)}
      </>}
    </div>
  );
}
