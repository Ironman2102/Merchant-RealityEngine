import { useState } from 'react';
import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import { useInvestigation } from '../../hooks/useInvestigation';
import { useQuantMode } from '../../hooks/useQuantMode';
import { LayerFrame } from '../../components/common/LayerFrame';
import { Badge, Bar, Callout, Card, Panel, StatusBadge, Tabs, Mono, statusTone, Td, Th, rowCls, tableCls } from '../../components/ui/ui';
import { FAMILIES, MECHANISMS } from '../../data/evidence';
import { RULES } from '../../../../rules/index';
import { cx, pct, fmtProb } from '../../utils/format';

type Step = 'in' | 'corr' | 'unk' | 'weight' | 'indep' | 'mech';
export function L4View() {
  const { result: r } = useInvestigation();
  const { quant } = useQuantMode();
  const f = r.fusion, [step, setStep] = useState<Step>('in');
  const counted = f.items.filter(i => i.counted).sort((a, b) => b.weight - a.weight), shared = f.logOdds.families.filter(x => x.items.length > 1);
  const P = fmtProb;
  const top = f.mechanisms[0];
  const topName = MECHANISMS.find(m => m.id === top.id)?.name ?? top.id;
  const positiveFamilies = f.logOdds.families.filter(x => x.llr > 0).sort((a, b) => b.llr - a.llr);

  return (
    <LayerFrame
      n={4}
      brief={{
        checks: 'Combines all L3 checks into a single probability, shrinks correlated red flags inside the same family so they count for less, ignores missing feeds (UNKNOWN = 0), and opens a case only when independent evidence includes conduct that a change of business cannot explain.',
        happened: (
          <>
            Started from a <b>{P(f.prior)}</b> category base rate → moved to <b>{P(f.posterior)} front likelihood</b> across <b>{f.independentFamilies.length} evidence families</b> ({f.systems.length} independent data source{f.systems.length === 1 ? '' : 's'}).{' '}
            <b>{f.decision === 'OPEN_CASE' ? `Opened a ${f.priority} priority case (${topName}).` : 'Did not open a case.'}</b>
          </>
        ),
        whyItMatters: f.decision === 'OPEN_CASE'
          ? 'Because multiple independent red flags agree (not just one noisy alert), this merchant goes to L5 where a human analyst tests the legitimate-business story against the front story.'
          : 'Without independent corroboration across multiple families, the safety gate protects this merchant from a false alarm.',
      }}
    >
      <Panel title="How the engine reached this verdict (step by step)" subtitle="How correlated alerts count for less and how the safety gate works.">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded border border-line bg-panel2 p-3.5 text-sm">
            <div className="text-xs font-medium text-mute">Step 1 · Starting guess (Base rate)</div>
            <div className="mt-1 font-mono text-xl font-semibold">{P(f.prior)}</div>
            <p className="mt-1 text-xs text-mute">Before seeing any payments, the expert prior is that {P(f.prior)} of merchants like this are fronts. It is not measured.</p>
          </div>
          <div className="rounded border border-line bg-panel2 p-3.5 text-sm">
            <div className="text-xs font-medium text-mute">Step 2 · Independent evidence added</div>
            <div className="mt-1 text-base font-semibold">{positiveFamilies.length > 0 ? `${positiveFamilies.length} suspicious area(s)` : 'No suspicious areas'}</div>
            <p className="mt-1 text-xs text-mute">
              {positiveFamilies.length > 0
                ? positiveFamilies.slice(0, 3).map(x => `${FAMILIES.find(fm => fm.id === x.family)?.short ?? x.family} (${x.items.join(', ')})`).join(' · ')
                : 'Available signals matched normal business behaviour; missing feeds were ignored (weight 0).'}
            </p>
          </div>
          <div className="rounded border border-line bg-panel2 p-3.5 text-sm">
            <div className="text-xs font-medium text-mute">Step 3 · Safety gate &amp; final likelihood</div>
            <div className="mt-1 font-mono text-xl font-semibold">{P(f.posterior)} · {f.decision === 'OPEN_CASE' ? 'OPEN CASE' : 'NO CASE'}</div>
            <p className="mt-1 text-xs text-mute">
              Requires ≥ 10% likelihood, at least one conduct signal, and independence (2 data sources, 3 families, or 2 different behaviours). Here: {f.systems.length} source(s), {f.independentFamilies.length} families, {f.conductSignals.length} conduct signal(s).
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="Most likely explanation (4 mechanisms ranked)" subtitle="If this merchant is a front, which kind of misuse best explains the evidence?">
        <div className="grid gap-3 md:grid-cols-2">{f.mechanisms.map((m, i) => { const meta = MECHANISMS.find(x => x.id === m.id)!; return (
          <div key={m.id} className={cx('rounded border p-4', i === 0 && f.gatePassed ? 'border-zinc-400/50 bg-zinc-400/5' : 'border-line bg-panel2')}>
            <div className="flex items-center justify-between"><div className="text-sm font-semibold">{meta.name}</div>{i === 0 && f.gatePassed && <Badge tone="info">Leading</Badge>}</div>
            <div className="mt-0.5 text-xs text-mute">{meta.blurb}</div>
            <div className="mt-3 flex items-center gap-3"><Bar className="flex-1" value={m.score} tone={m.score >= 0.6 ? 'bad' : m.score >= 0.4 ? 'warn' : 'mute'} /><span className="font-mono text-sm">{pct(m.score)}</span></div>
            <div className="mt-2 text-[11px] text-dim">Driven by: {m.contributors.slice(0, 5).map(c => c.id).join(', ') || 'no supporting evidence'}</div></div>); })}</div>
      </Panel>

      {quant && (
        <Panel title="Quant working: 6-step Bayesian fusion pipeline" subtitle="Bayes' rule in log-odds (nats): prior + Σ family LLRs (with ρ shrinkage) + overrides → posterior & 90% Monte-Carlo interval.">
          <Tabs<Step> value={step} onChange={setStep} tabs={[{ id: 'in', label: '1 Evidence in' }, { id: 'corr', label: '2 Same-family shrinkage' }, { id: 'unk', label: '3 UNKNOWN excluded' }, { id: 'weight', label: '4 Evidence weights (nats)' }, { id: 'indep', label: '5 Probability and gate' }, { id: 'mech', label: '6 Mechanisms' }]} />
          <div className="pt-4">
            {step === 'in' && (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {FAMILIES.map(fm => { const x = r.evidence.filter(e => e.family === fm.id); return (
                  <div key={fm.id} className="rounded border border-line bg-panel2 p-3"><div className="mb-2 text-xs"><span className="font-mono text-zinc-300">{fm.id}</span> <span className="text-mute">{fm.short}</span></div>
                    <div className="flex flex-wrap gap-1.5">{x.map(e => <span key={e.id} className={cx('rounded border px-1.5 py-0.5 font-mono text-[11px]', e.status === 'ILLICIT' ? 'border-neutral-400/40 text-neutral-300' : e.status === 'BENIGN' ? 'border-gray-400/40 text-gray-300' : 'border-line2 text-dim')}>{e.id}</span>)}</div></div>); })}
              </div>)}
            {step === 'corr' && (
              <div className="space-y-3">
                <Callout tone="info" title="Several signals from one family are not several facts">{`Within a family the strongest signal counts in full and each further one only ρ = ${RULES.engine.familyRho} of its weight, because they read related data.`}</Callout>
                {shared.length === 0 ? <div className="text-sm text-mute">No family has more than one informative signal in this case.</div> : shared.map(x => (
                  <div key={x.family} className="flex flex-wrap items-center gap-3 rounded border border-line bg-panel2 px-3 py-2 text-[13px]"><MinusCircle size={15} className="text-stone-300" /><Mono>{x.family}</Mono><span>{x.items.join(', ')}</span><span className="text-mute">family weight {x.llr >= 0 ? '+' : ''}{x.llr.toFixed(2)} nats after shrinkage</span></div>))}
                <div className="text-xs text-dim">{r.evidence.filter(e => e.status !== 'UNKNOWN').length} informative signals in, {counted.length} counted.</div>
              </div>)}
            {step === 'unk' && (
              <div className="space-y-3">
                <Callout tone="info" title="UNKNOWN carries zero weight">A missing feed is not read as clean (which would reward gaps) or as suspicious (which would punish merchants for data we do not have).</Callout>
                <div className="grid gap-2 sm:grid-cols-2">{f.items.filter(i => i.evidence.status === 'UNKNOWN').map(i => <div key={i.evidence.id} className="rounded border border-line bg-panel2 p-3 text-[13px]"><div className="flex items-center gap-2"><Mono className="text-zinc-300">{i.evidence.id}</Mono><span>{i.evidence.name}</span></div><div className="mt-1 text-xs text-mute">{i.evidence.explanation}</div></div>)}</div>
                {f.unknownIds.length === 0 && <div className="text-sm text-mute">Every detector had the data it needed.</div>}
              </div>)}
            {step === 'weight' && (
              <div className="overflow-x-auto"><table className={tableCls}><thead><tr><Th>Signal</Th><Th>Status</Th><Th>p-value</Th><Th>Effect</Th><Th>n</Th><Th>Weight (nats)</Th></tr></thead>
                <tbody>{counted.map(i => <tr key={i.evidence.id} className={rowCls}><Td><Mono className="text-zinc-300">{i.evidence.id}</Mono> {i.evidence.name}</Td><Td><StatusBadge s={i.evidence.status} /></Td><Td className="tabular-nums">{i.evidence.p === null ? <span className="text-dim">rule</span> : i.evidence.p < 1e-4 ? i.evidence.p.toExponential(1) : i.evidence.p.toFixed(4)}</Td><Td className="tabular-nums">{i.evidence.effect === null ? '—' : i.evidence.effect.toFixed(2)}</Td><Td className="tabular-nums">{i.evidence.n}</Td>
                  <Td><div className="flex items-center gap-2"><Bar className="w-24" value={Math.min(1, Math.abs(i.weight) / 4)} tone={statusTone(i.evidence.status)} /><span className="font-mono text-xs">{i.weight >= 0 ? '+' : ''}{i.weight.toFixed(2)}</span></div></Td></tr>)}</tbody></table>
                <p className="mt-3 text-xs text-mute">A signal fires only when it is both statistically significant (p ≤ α) and practically large. Its weight is the log likelihood ratio ln(sensitivity ÷ false-positive rate). A calm signal pushes the other way, scaled down when it is easy to fake.</p></div>)}
            {step === 'indep' && (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-10">{f.families.map(x => { const sup = f.independentFamilies.includes(x.family); return <div key={x.family} className={cx('rounded border p-2.5 text-center', sup ? 'border-neutral-400/50 bg-neutral-400/5' : 'border-line bg-panel2')}><div className="font-mono text-sm text-zinc-300">{x.family}</div><div className="text-[10px] text-mute">{x.illicit} illicit signals</div><div className="mt-1 font-mono text-xs">{x.mass.toFixed(2)}</div></div>; })}</div>
                <div className="flex flex-wrap items-center gap-3 text-sm"><span className="text-mute">Base rate</span><b>{P(f.prior)}</b><span className="text-mute">→ P(front)</span><b>{P(f.posterior)}</b><span className="text-dim">90%: {P(f.posteriorCi[0])} – {P(f.posteriorCi[1])}</span><span className="text-mute">Independent sources:</span><b>{f.systems.length}</b><span className="text-dim">{f.systems.join(', ') || '—'}</span><span className="text-mute">Families:</span><b>{f.independentFamilies.length}</b></div>
                <Callout tone={f.gatePassed ? 'warn' : 'ok'} title={f.gatePassed ? 'Probability and independence requirements met' : 'Case not opened'}>{f.gateReason}</Callout>
              </div>)}
            {step === 'mech' && (
              <div className="grid gap-3 md:grid-cols-2">{f.mechanisms.map((m, i) => { const meta = MECHANISMS.find(x => x.id === m.id)!; return (
                <div key={m.id} className={cx('rounded border p-4', i === 0 && f.gatePassed ? 'border-zinc-400/50 bg-zinc-400/5' : 'border-line bg-panel2')}>
                  <div className="flex items-center justify-between"><div className="font-mono text-[13px]">{m.id}</div>{i === 0 && f.gatePassed && <Badge tone="info">Leading</Badge>}</div>
                  <div className="mt-0.5 text-xs text-mute">{meta.blurb}</div>
                  <div className="mt-3 flex items-center gap-3"><Bar className="flex-1" value={m.score} tone={m.score >= 0.6 ? 'bad' : m.score >= 0.4 ? 'warn' : 'mute'} /><span className="font-mono text-sm">{pct(m.score)}</span></div>
                  <div className="mt-2 text-[11px] text-dim">Driven by: {m.contributors.slice(0, 5).map(c => c.id).join(', ') || 'no supporting evidence'}</div></div>); })}</div>)}
          </div>
        </Panel>
      )}

      <Card className={cx('p-5', f.decision === 'OPEN_CASE' ? 'border-neutral-400/30' : 'border-gray-400/30')}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">{f.decision === 'OPEN_CASE' ? <XCircle className="mt-0.5 text-neutral-300" size={22} /> : <CheckCircle2 className="mt-0.5 text-gray-300" size={22} />}
            <div><div className="text-base font-semibold">{f.decision === 'OPEN_CASE' ? `Investigation case opened for ${r.scenario.profile.name}` : `No case opened for ${r.scenario.profile.name}`}</div>
              <p className="mt-1 max-w-2xl text-sm text-mute">{f.decision === 'OPEN_CASE' ? `Hypotheses are ranked, not proven. Next in L5, a human analyst compares the legitimate story against the front story.` : f.followUp === 'ASK' ? 'The merchant is asked to explain. Nothing is restricted.' : 'Not enough evidence to open a case or to ask.'}</p></div></div>
          <div className="flex gap-6 text-right"><div><div className="text-xs text-mute">Priority</div><div className="text-xl font-semibold">{f.priority}</div></div><div><div className="text-xs text-mute">Front likelihood</div><div className="font-mono text-xl">{P(f.posterior)}</div></div></div>
        </div>
      </Card>
    </LayerFrame>
  );
}
