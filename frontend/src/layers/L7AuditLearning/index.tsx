import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { useInvestigation } from '../../hooks/useInvestigation';
import { LayerFrame } from '../../components/common/LayerFrame';
import { Badge, Btn, Callout, Panel, Td, Th, rowCls, tableCls, Mono, type Tone } from '../../components/ui/ui';
import { profileUpdates } from '../../engines/learningEngine';
import { hashId } from '../../utils/hash';
import { cx } from '../../utils/format';
import type { Label } from '../../types/merchant';

const LABELS: { id: Label; name: string; blurb: string; tone: Tone }[] = [
  { id: 'CONFIRMED_ILLICIT', name: 'Confirmed illicit', blurb: 'Verified by adjudication or merchant failure to substantiate.', tone: 'bad' },
  { id: 'ADJUDICATED_BENIGN', name: 'Adjudicated benign', blurb: 'Reviewed and found legitimate. Used to reduce false positives.', tone: 'ok' },
  { id: 'UNRESOLVED', name: 'Unresolved', blurb: 'Not enough to decide. Kept out of training; not treated as negative.', tone: 'mute' },
];

export function L7View() {
  const { result: r, user, setLabel, rejectLabel, audit, custom, pending, syncError, auditIntact, caseId } = useInvestigation();
  const label = user.label;
  const upd = label ? profileUpdates(r, label) : [];
  const chain = useMemo(() => { let prev = 'genesis'; return audit.map(a => { const h = hashId(prev + a.action + a.at + a.detail, 'audit'); prev = h; return { ...a, hash: a.hash ?? (caseId ? '' : h) }; }); }, [audit, caseId]);
  return (
    <LayerFrame
      n={7}
      brief={{
        checks: 'Records the final human outcome (Confirmed Front, Genuine Business, or Unresolved), turns confirmed outcomes into calibration proposals that another person must approve, and records every action (a sealed SHA-256 chain on saved cases).',
        happened: (
          <>
            Current outcome: <b>{label ? LABELS.find(l => l.id === label)!.name : 'Awaiting human label'}</b>.{' '}
            Audit trail has <b>{audit.length} entry/entries</b>
            {auditIntact !== null ? (auditIntact ? ' (SHA-256 hash chain verified intact).' : ' (TAMPERING DETECTED).') : '.'}
          </>
        ),
        whyItMatters: 'A reviewer must be able to see who decided what and why. Labels never move a score by themselves, and Unresolved cases are kept out of calibration so uncertainty is not counted as a win.',
      }}
    >
      <Panel title="Adjudicated label" subtitle="Simulated adjudication. In production a human or a legal process decides.">
        <div className="grid gap-3 md:grid-cols-3">{LABELS.map(l => <button key={l.id} onClick={() => setLabel(label === l.id ? null : l.id)} aria-pressed={label === l.id} className={cx('rounded border p-3 text-left transition-colors', label === l.id ? 'border-zinc-400 bg-zinc-400/5' : 'border-line bg-panel2 hover:border-line2')}><div className="flex items-center justify-between"><span className="font-mono text-[12px]">{l.id}</span>{!custom && l.id === r.scenario.scriptedLabel && <Badge tone="info">Scripted outcome</Badge>}</div><div className="mt-1 text-[13px] text-mute">{l.blurb}</div></button>)}</div>
        {pending?.label && <p className="mt-3 rounded border border-stone-400/30 bg-stone-400/5 px-3 py-2 text-xs text-stone-200" role="status">{pending.label.label} proposed by <b>{pending.label.by.username}</b>. A different reviewer, admin or legal user confirms it by choosing the same label, or rejects it. The proposer can withdraw it.<Btn size="sm" className="ml-3" onClick={rejectLabel}>Reject or withdraw</Btn></p>}
        {syncError && <p className="mt-3 text-xs text-stone-200" role="alert">{syncError}</p>}
        {auditIntact !== null && <p className="mt-3 text-xs text-mute">Audit chain: {auditIntact ? 'verified intact (every entry hashes the one before it)' : 'BROKEN: an entry was changed after it was written'}.</p>}
        {!label && !custom && <div className="mt-3"><Btn size="sm" onClick={() => setLabel(r.scenario.scriptedLabel)}>Apply the scripted outcome for this scenario</Btn></div>}
      </Panel>
      <Panel title="This investigation" subtitle="Counts and labels below belong to the selected merchant only.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-line bg-panel2 p-3"><div className="text-xs text-mute">Merchant</div><div className="mt-1 text-sm font-medium">{r.scenario.profile.name}</div></div>
          <div className="rounded border border-line bg-panel2 p-3"><div className="text-xs text-mute">Records analyzed</div><div className="mt-1 text-sm font-medium">{r.events.length.toLocaleString('en-IN')}</div></div>
          <div className="rounded border border-line bg-panel2 p-3"><div className="text-xs text-mute">Current label</div><div className="mt-1 text-sm font-medium">{label ? LABELS.find(l => l.id === label)!.name : 'Awaiting analyst review'}</div></div>
          <div className="rounded border border-line bg-panel2 p-3"><div className="text-xs text-mute">Suggested response</div><div className="mt-1 text-sm font-medium">{r.review.recommended}</div></div>
        </div>
      </Panel>
      <Panel title="How a verified finding changes the system" subtitle="A label is an input to a calibration proposal. It does not change scoring by itself.">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">{['Verified finding', 'Label', 'Backtested proposal', 'Second person approves', 'Next investigation'].map((t, i, a) => <span key={t} className="flex items-center gap-2"><span className="rounded border border-line2 bg-panel2 px-3 py-1.5">{t}</span>{i < a.length - 1 && <ArrowRight size={14} className="text-dim" />}</span>)}</div>
        {!label ? <div className="text-sm text-mute">No label chosen yet.</div> : (
          <div>
            <div className="space-y-2">{upd.map(u => <div key={u} className="rounded border border-line bg-panel2 px-3 py-2 text-[13px]">{u}</div>)}</div>
          </div>)}
      </Panel>
      <Panel title="Audit trail" subtitle="Each entry carries a hash of the one before it, so edits to history are detectable." bodyClass="p-0 overflow-x-auto">
        <table className={tableCls}><thead><tr><Th>#</Th><Th>Time (IST)</Th><Th>Actor</Th><Th>Action</Th><Th>Hash chain</Th></tr></thead>
          <tbody>{chain.map(a => <tr key={a.seq} className={rowCls}><Td><Mono>{a.seq}</Mono></Td><Td className="font-mono text-xs">{a.at}</Td><Td className="text-xs text-mute">{a.actor}</Td><Td>{a.action}{a.detail && <div className="text-xs text-dim">{a.detail}</div>}</Td><Td><Mono className="text-dim">{a.hash}</Mono></Td></tr>)}</tbody></table>
      </Panel>
      <Callout tone="info" title="Unresolved is not the same as clean">Unresolved cases are reported separately and kept out of precision calculations and training labels, so uncertainty is not quietly counted as a win.</Callout>
    </LayerFrame>
  );
}
