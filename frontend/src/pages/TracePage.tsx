import { useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { useInvestigation } from '../hooks/useInvestigation';
import { buildTrace } from '../engines/traceEngine';
import { Badge, Btn, Callout, Mono, Panel, StatusBadge, Tabs, Td, Th, rowCls, tableCls } from '../components/ui/ui';
import { MECHANISMS, RESPONSE_LEVELS } from '../data/evidence';
import { cx, fmtInterval, fmtProb, inr, probEq } from '../utils/format';
import { getPilotJson } from '../services/pilotApi';
import { MlPanel } from '../components/trace/MlPanel';

type Filter = 'fired' | 'calm' | 'unknown' | 'all';
const pv = (p: number | null) => (p === null ? 'rule' : p < 1e-4 ? p.toExponential(1) : p.toFixed(4));
const nats = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;

/** The reasoning trace: every number on this page comes from the engine's result, a rules file or a formula shown here. */
export function TracePage() {
  const { result, caseId } = useInvestigation();
  const t = useMemo(() => buildTrace(result), [result]);
  const [filter, setFilter] = useState<Filter>('fired');
  const [packError, setPackError] = useState('');
  const rows = t.detectors.filter(d => filter === 'all' || (filter === 'fired' ? d.status === 'ILLICIT' : filter === 'calm' ? d.status === 'BENIGN' : d.status === 'UNKNOWN'));
  const mech = MECHANISMS.find(m => m.id === t.caseSummary.mechanism);
  const download = async () => {
    if (!caseId) return;
    setPackError('');
    try {
      const pack = await getPilotJson(caseId, 'pack');
      const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `${caseId}-evidence-pack.json`; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setPackError(e instanceof Error ? e.message : 'Could not build the evidence pack.'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Reasoning trace</h1>
          <p className="mt-1 text-sm text-mute">{t.caseSummary.merchant} · MCC {t.caseSummary.mcc}. Every number here can be checked by hand from the rows below.</p></div>
        <div className="flex gap-2 print:hidden">
          <Btn size="sm" onClick={() => window.print()}><Printer size={13} />Print</Btn>
          {caseId && <Btn size="sm" variant="primary" onClick={() => void download()}><Download size={13} />Evidence pack (JSON)</Btn>}
        </div>
      </div>
      {packError && <Callout tone="warn" title="Evidence pack not created">{packError}</Callout>}

      <Panel title="Verdict" subtitle="Probability that this merchant is not the business it declares, with a 90% interval from detector uncertainty.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div><div className="text-xs text-mute">Decision</div><div className="mt-1"><Badge tone={t.caseSummary.decision === 'OPEN_CASE' ? 'bad' : 'ok'}>{t.caseSummary.decision === 'OPEN_CASE' ? 'Case opened' : 'No case'}</Badge></div></div>
          <div><div className="text-xs text-mute">P(front)</div><div className="mt-1 font-mono text-xl">{fmtProb(t.caseSummary.posterior)}</div><div className="text-[11px] text-dim">{fmtInterval(t.caseSummary.ci)}</div></div>
          <div><div className="text-xs text-mute">Base rate</div><div className="mt-1 font-mono text-xl">{fmtProb(t.caseSummary.prior)}</div><div className="text-[11px] text-dim">before any evidence (rules/priors.json)</div></div>
          <div><div className="text-xs text-mute">Recommended</div><div className="mt-1 text-xl font-semibold">{t.caseSummary.action}</div><div className="text-[11px] text-dim">{RESPONSE_LEVELS.find(l => l.id === t.caseSummary.action)?.name}</div></div>
          <div><div className="text-xs text-mute">Leading mechanism</div><div className="mt-1 text-sm font-medium">{mech?.name ?? t.caseSummary.mechanism}</div><div className="text-[11px] text-dim">{fmtProb(t.caseSummary.mechanismP)} of the "front" probability</div></div>
        </div>
      </Panel>

      <MlPanel caseId={caseId} posterior={t.caseSummary.posterior} />

      <Panel title="How the probability was reached" subtitle="Bayes' rule in log-odds: start from the base rate, add each evidence family's weight (nats). Positive moves towards 'front', negative towards 'genuine'." bodyClass="p-0 overflow-x-auto">
        <table className={tableCls}><thead><tr><Th>Step</Th><Th>Weight</Th><Th>Running P(front)</Th></tr></thead><tbody>
          {t.waterfall.map((s, i) => (
            <tr key={i} className={rowCls}><Td className="max-w-[28rem] text-[13px]">{s.label}</Td>
              <Td className={cx('font-mono text-xs', i === 0 ? 'text-mute' : s.delta > 0 ? 'text-neutral-300' : 'text-gray-300')}>{i === 0 ? `logit ${s.delta.toFixed(2)}` : nats(s.delta)}</Td>
              <Td><div className="flex items-center gap-2"><div className="h-2 w-40 rounded bg-line" aria-hidden><div className="h-2 rounded bg-zinc-300" style={{ width: `${Math.max(1, s.probability * 100)}%` }} /></div><span className="font-mono text-xs">{fmtProb(s.probability)}</span></div></Td></tr>))}
        </tbody></table>
        <p className="border-t border-line px-4 py-3 text-xs text-mute">Within one family the strongest signal counts fully and the others are shrunk, because they read related data. Missing data counts as zero. {t.gate.reason}</p>
      </Panel>

      <Panel title="Evidence, test by test" subtitle="Each detector tests the merchant against an expectation it does not get from the merchant's own declaration." right={<Tabs<Filter> value={filter} onChange={setFilter} tabs={[{ id: 'fired', label: `Fired (${t.detectors.filter(d => d.status === 'ILLICIT').length})` }, { id: 'calm', label: `Calm (${t.detectors.filter(d => d.status === 'BENIGN').length})` }, { id: 'unknown', label: `No data (${t.detectors.filter(d => d.status === 'UNKNOWN').length})` }, { id: 'all', label: 'All' }]} />} bodyClass="p-0 overflow-x-auto">
        <table className={tableCls}><thead><tr><Th>Detector</Th><Th>Observed / expected</Th><Th>Test</Th><Th>n</Th><Th>p</Th><Th>Effect</Th><Th>Weight</Th></tr></thead><tbody>
          {rows.map(d => (
            <tr key={d.id} className={rowCls}>
              <Td><div className="flex items-center gap-2"><Mono className="text-zinc-300">{d.id}</Mono><StatusBadge s={d.status} /></div><div className="mt-1 text-[13px]">{d.name}</div><div className="text-[11px] text-dim">{d.provenance}{d.records.length ? ` · ${d.records.length} source records` : ''}</div></Td>
              <Td className="max-w-[22rem] text-[12px]"><div>{d.observed}</div><div className="mt-1 text-mute">Expected: {d.expected}</div><div className="mt-1 text-dim">{d.expectedSource}</div></Td>
              <Td className="max-w-[16rem] text-[11px] text-mute">{d.test}</Td>
              <Td className="font-mono text-xs">{d.n}</Td>
              <Td className="font-mono text-xs">{pv(d.p)}</Td>
              <Td className="text-xs"><span className="font-mono">{d.effect === null ? '—' : d.effect.toFixed(2)}</span><div className="text-[10px] text-dim">{d.effectLabel}{d.ci ? ` · 90% ${fmtProb(d.ci[0])}–${fmtProb(d.ci[1])}` : ''}</div></Td>
              <Td className="font-mono text-xs">{d.status === 'UNKNOWN' ? '0' : nats(d.llr)}</Td>
            </tr>))}
          {!rows.length && <tr><Td className="text-sm text-mute">None in this group.</Td></tr>}
        </tbody></table>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Choosing the response" subtitle="Expected loss = (1 − P) × false-alarm cost + P × share of the loss that remains × cost of missing a front (rules/costs.json)." bodyClass="p-0 overflow-x-auto">
          <table className={tableCls}><thead><tr><Th>Level</Th><Th>Expected loss</Th><Th>At 90% interval</Th></tr></thead><tbody>
            {t.decision.actions.map(a => (
              <tr key={a.level} className={cx(rowCls, a.level === t.caseSummary.action && 'bg-zinc-400/5')}><Td><Mono>{a.level}</Mono> <span className="text-[12px]">{a.label}</span>{!a.auto && <div className="text-[10px] text-dim">people only</div>}</Td>
                <Td className="font-mono text-xs">{inr(Math.round(a.expectedLoss))}</Td><Td className="font-mono text-[11px] text-mute">{inr(Math.round(Math.min(a.low, a.high)))} – {inr(Math.round(Math.max(a.low, a.high)))}</Td></tr>))}
          </tbody></table>
          <p className="border-t border-line px-4 py-3 text-xs text-mute">{t.decision.reason}</p>
        </Panel>
        <Panel title="What would change the verdict" subtitle="Each line re-runs the engine with one thing different.">
          <div className="space-y-4 text-[13px]">
            <div><div className="mb-1 text-xs font-medium text-mute">If a fired signal were absent</div>
              {t.counterfactuals.length ? <ul className="space-y-1">{t.counterfactuals.map(c => <li key={c.what}>{c.what}: P(front) {probEq(c.posterior)} → {c.decision === 'OPEN_CASE' ? 'case' : 'no case'}, {c.action}</li>)}</ul> : <p className="text-xs text-dim">No signal fired.</p>}</div>
            <div><div className="mb-1 text-xs font-medium text-mute">Worth requesting next (value of information)</div>
              {t.valueOfInformation.length ? <ul className="space-y-1">{t.valueOfInformation.map(v => <li key={v.feed}><b>{v.feed}</b> feed ({v.detector}): {inr(Math.round(v.voiRupees))} lower expected loss. If it fires P → {fmtProb(v.ifFires)}; if calm P → {fmtProb(v.ifCalm)} (chance it fires {fmtProb(v.pFire)}).</li>)}</ul> : <p className="text-xs text-dim">No missing feed would change the decision.</p>}</div>
          </div>
        </Panel>
      </div>

      <Panel title="Two competing explanations" subtitle="The engine tests the merchant's own story as hard as the suspicious one.">
        <div className="grid gap-4 md:grid-cols-2">
          {(['legit', 'front'] as const).map(k => (
            <div key={k}><div className="mb-2 text-sm font-medium">{k === 'legit' ? 'Legitimate business' : 'Front for something else'}</div>
              <ul className="space-y-1.5 text-[12px]">{t.stories[k].map(s => <li key={s.label} className="flex items-start justify-between gap-2"><span>{s.label} <span className="text-dim">({s.evidence.join(', ')})</span></span><Badge tone={s.verdict === 'FAILED' || (k === 'front' && s.verdict === 'SUPPORTED') ? 'bad' : s.verdict === 'SUPPORTED' || s.verdict === 'NOT_SUPPORTED' ? 'ok' : 'mute'}>{s.verdict}</Badge></li>)}</ul></div>))}
        </div>
      </Panel>

      <Callout tone="info" title="Limits">Category norms and detector sensitivities are expert priors until calibrated on labelled cases; probabilities treat evidence families as independent given the truth (related families are shrunk, not removed). Rules {t.versions.rules}.</Callout>
    </div>
  );
}
