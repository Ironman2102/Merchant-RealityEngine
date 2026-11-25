import { useState, type FormEvent } from 'react';
import { useInvestigation } from '../../hooks/useInvestigation';
import { Badge, Btn, Panel } from '../ui/ui';

const field = 'mt-1 w-full rounded-lg border border-line2 bg-panel px-2.5 py-1.5 text-xs text-ink';

/** A merchant's way to explain a change, and the two-person check before it counts. */
export function PassportPanel() {
  const { result, caseId, verifyPassport, submitPassport, endorsePassport, revokePassport, syncError } = useInvestigation();
  const list = result.scenario.passports ?? [];
  const links = [...new Set(result.events.flatMap(e => (e.linkId ? [e.linkId] : [])))];
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const canAdd = !!caseId && links.length > 0;
  if (!list.length && result.fusion.followUp !== 'ASK' && !canAdd) return null;

  const submit = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const d = new FormData(ev.currentTarget), v = (k: string) => String(d.get(k) ?? '').trim();
    const pair = (a: string, b: string) => (v(a) && v(b) ? [Number(v(a)), Number(v(b))] : undefined);
    submitPassport({
      linkId: v('linkId'), reason: v('reason'), document: v('document'), from: v('from'), until: v('until') || undefined,
      hours: pair('open', 'close'), ticketBand: pair('min', 'max'), states: v('states') ? v('states').split(',').map(s => s.trim().toUpperCase()) : undefined,
      volumeUplift: v('uplift') ? Number(v('uplift')) : undefined,
    });
    setAdding(false);
  };

  return (
    <Panel title="Context Passport" subtitle="How an honest merchant explains a change. It covers one QR for a set period, counts only after a second person checks the document, and is switched off whenever a misconduct signal fires. It cannot stop a forged document explaining a change where none fires.">
      <div className="space-y-3 text-sm">
        {!list.length && <p className="text-xs text-mute">No change has been recorded for this merchant.{!caseId && ' Passports are recorded on a saved case in the AI Engine.'}</p>}
        {result.passportsSuspended && <p role="status" className="rounded-lg border border-line bg-panel2 p-2 text-xs">Verified passports are not applied to this case: a conduct signal fired, and a passport cannot explain conduct. The score is the same as with no passport.</p>}
        {!!result.passportAnswered?.length && <p role="status" className="rounded-lg border border-line bg-panel2 p-2 text-xs">This change raised a question, and passport {result.passportAnswered.join(', ')} answered it. Revoking it reopens the question. Once it expires, a later file asks again.</p>}
        {list.map(p => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-panel2 p-3">
            <div className="min-w-0">
              <div className="font-medium">{p.reason} <Badge tone={p.status === 'VERIFIED' ? 'ok' : p.status === 'SUBMITTED' ? 'warn' : 'bad'}>{p.status.toLowerCase()}</Badge></div>
              <div className="mt-1 text-xs text-mute">{p.linkId} · from {p.from} · {p.document}</div>
              <div className="text-xs text-dim">
                Covers: {[p.hours && `hours ${p.hours[0]}:00–${p.hours[1]}:00`, p.ticketBand && `₹${p.ticketBand[0]}–₹${p.ticketBand[1]}`, p.states && (p.states.includes('*') ? 'all India' : p.states.join(', ')), p.volumeUplift && `up to ${p.volumeUplift}× volume`].filter(Boolean).join(' · ') || 'nothing measurable'}
              </div>
            </div>
            {caseId && p.status === 'VERIFIED' && (revoking === p.id ? (
              <form className="flex flex-wrap items-end gap-2 text-xs" onSubmit={ev => { ev.preventDefault(); revokePassport(p.id, String(new FormData(ev.currentTarget).get('why') ?? '')); setRevoking(null); }}>
                <label>Reason for revoking<input name="why" required maxLength={500} className={field} /></label>
                <Btn size="sm" variant="primary" type="submit">Revoke passport</Btn><Btn size="sm" type="button" onClick={() => setRevoking(null)}>Cancel</Btn>
              </form>) : <Btn size="sm" onClick={() => setRevoking(p.id)}>Revoke</Btn>)}
            {p.status === 'SUBMITTED' && (
              <div className="flex gap-2">
                {caseId && !p.submittedBy
                  ? <Btn size="sm" variant="primary" onClick={() => endorsePassport(p.id)}>Take on as maker</Btn>
                  : <Btn size="sm" variant="primary" onClick={() => verifyPassport(p.id, true)}>{caseId ? 'Verify document' : 'Simulate second-person check'}</Btn>}
                {caseId && <Btn size="sm" onClick={() => verifyPassport(p.id, false)}>Reject</Btn>}
              </div>)}
          </div>))}
        {canAdd && (adding ? (
          <form onSubmit={submit} className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <label>QR or link<select name="linkId" required className={field}>{links.map(l => <option key={l}>{l}</option>)}</select></label>
            <label>What changed<input name="reason" required maxLength={300} className={field} /></label>
            <label>Document checked<input name="document" required maxLength={300} className={field} /></label>
            <label>From<input name="from" type="date" required className={field} /></label>
            <label>Until (max 180 days)<input name="until" type="date" className={field} /></label>
            <label>Opens (hour, up to 12 h a day)<input name="open" type="number" min={0} max={24} className={field} /></label>
            <label>Closes (hour)<input name="close" type="number" min={0} max={24} className={field} /></label>
            <label>States (up to 10, or * for all)<input name="states" className={field} /></label>
            <label>Lowest price ₹<input name="min" type="number" min={0} className={field} /></label>
            <label>Highest price ₹ (up to 10× lowest)<input name="max" type="number" min={0} className={field} /></label>
            <label>Volume up to ×<input name="uplift" type="number" min={1} max={3} step={0.1} className={field} /></label>
            <div className="flex items-end gap-2"><Btn size="sm" variant="primary" type="submit">Submit for checking</Btn><Btn size="sm" type="button" onClick={() => setAdding(false)}>Cancel</Btn></div>
          </form>
        ) : <Btn size="sm" onClick={() => setAdding(true)}>Record a change</Btn>)}
        {syncError && <p role="alert" className="text-xs text-bad">{syncError}</p>}
      </div>
    </Panel>
  );
}
