import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useInvestigation } from '../../hooks/useInvestigation';
import { useQuantMode } from '../../hooks/useQuantMode';
import { LayerFrame } from '../../components/common/LayerFrame';
import { RecordPeek } from '../../components/common/RecordPeek';
import { Badge, Bar, Callout, Panel, StatusBadge, Tabs, Mono, statusTone } from '../../components/ui/ui';
import { CusumChart, HourChart, StateBars, TicketHistogram } from '../../components/charts/charts';
import { FAMILIES } from '../../data/evidence';
import { CUSUM_H, CUSUM_K } from '../../engines/cusumEngine';
import { EPSILON } from '../../engines/residualEngine';
import { inrK, pct, cx } from '../../utils/format';
import type { EvidenceStatus, Family } from '../../types/evidence';

export function L3View() {
  const { result: r } = useInvestigation();
  const { quant } = useQuantMode();
  const [fam, setFam] = useState<'ALL' | Family>('ALL');
  const [st, setSt] = useState<'ALL' | EvidenceStatus>('ALL');
  const [open, setOpen] = useState<string | null>(null);
  const [vis, setVis] = useState<'ticket' | 'timing' | 'geo'>('ticket');
  const ev = r.evidence.filter(e => (fam === 'ALL' || e.family === fam) && (st === 'ALL' || e.status === st));
  const sales = r.events.filter(e => e.type === 'SALE'), pk = r.l2.peak, cnt = (s: EvidenceStatus) => r.evidence.filter(e => e.status === s).length;
  const fired = [...r.evidence].filter(e => e.status === 'ILLICIT').sort((a, b) => b.llr - a.llr);

  return (
    <LayerFrame
      n={3}
      brief={{
        checks: `Runs ${r.evidence.length} behavioural checks across ${FAMILIES.length} areas (ticket amounts, customer states, payment hours, refunds, links, settlements, and drift) on the account and on every QR. A check only flags when the gap is both statistically real and large enough to matter in practice.`,
        happened: (
          <>
            <b>{cnt('ILLICIT')} red flag(s)</b>, <b>{cnt('BENIGN')} normal check(s)</b>, and <b>{cnt('UNKNOWN')} skipped (no data)</b>.
            {fired.length > 0 ? <> Top red flags: <b>{fired.slice(0, 2).map(e => e.name).join(' & ')}</b>.</> : ' Every available check looked normal for this business.'}
          </>
        ),
        whyItMatters: 'Individual checks only report observations—not guilt. Next, L4 combines these signals, removes double-counting within the same category, and tests whether independent proof agrees.',
      }}
    >
      {quant && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Quant working: volume residual" subtitle="How far actual weekly volume sits from the festival-adjusted norm.">
            <div className="rounded border border-line2 bg-bg px-4 py-3 text-center font-mono text-[15px] text-zinc-200">R<sub>t</sub> = (V<sub>t</sub> − E<sub>t</sub>) / max(E<sub>t</sub>, ε)</div>
            {pk && pk.actual !== null ? (
              <div className="mt-3 space-y-1.5 text-[13px]">
                <div className="flex justify-between"><span className="text-mute">V (actual, {pk.week})</span><span className="font-mono">{inrK(pk.actual)}</span></div>
                <div className="flex justify-between"><span className="text-mute">E (seasonal expectation)</span><span className="font-mono">{inrK(pk.seasonal)}</span></div>
                <div className="flex justify-between"><span className="text-mute">ε (floor)</span><span className="font-mono">{EPSILON}</span></div>
                <div className="flex justify-between border-t border-line pt-1.5"><span>R = ({inrK(pk.actual)} − {inrK(pk.seasonal)}) / {inrK(pk.seasonal)}</span><span className="font-mono text-stone-300">{pct(pk.rSeasonal!)}</span></div>
                <p className="pt-1 text-xs text-mute">The onboarding baseline alone would give {pct(pk.rAnchored!)}. Accounting for the festival season leaves a {pct(pk.rSeasonal!)} unexplained residual.</p>
              </div>) : null}
          </Panel>
          <Panel title="Quant working: CUSUM drift tracker" subtitle={`S_t = max(0, S_t−1 + R_t − k), k = ${CUSUM_K}; alarm above h = ${CUSUM_H}`}>
            <CusumChart points={r.l2.cusum} height={170} />
            <p className="text-xs text-mute">One busy week can be noise. CUSUM accumulates only sustained excess above k = {CUSUM_K}, calibrated for ~1 false alarm per merchant-year.</p>
          </Panel>
        </div>
      )}
      <Panel title="Visual proof: what the payments actually look like" right={<Tabs tabs={[{ id: 'ticket', label: 'Ticket sizes' }, { id: 'timing', label: 'Payment hours' }, { id: 'geo', label: 'Customer states' }]} value={vis} onChange={setVis} />}>
        {vis === 'ticket' && <><TicketHistogram sales={sales} profile={r.l2.profile} /><p className="text-xs text-mute">Red bars are exact round amounts (₹500 multiples). Normal round-amount share for this business type: {pct(r.l2.profile.expectedRoundShare)}.</p></>}
        {vis === 'timing' && <><HourChart sales={sales} fixtures={r.scenario.fixtures} profile={r.l2.profile} /><p className="text-xs text-mute">{r.scenario.fixtures.length ? 'Red bars mark payments in the 45 minutes before a cricket match starts, compared against the same clock time on non-match days.' : 'Green lines mark declared opening hours.'}</p></>}
        {vis === 'geo' && <><StateBars sales={sales} local={r.l2.profile.catchment === 'LOCAL' ? r.l2.profile.localStates : []} /><p className="text-xs text-mute">Green: customers in the merchant’s local service area. Red: customers from far-away states.</p></>}
      </Panel>
      <Panel title="Filter checks by evidence family" subtitle={`${r.evidence.length} live checks across ${FAMILIES.length} families, measured on: ${r.scope.label}. Click a family to filter the list below.`}>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {FAMILIES.map(f => {
            const x = r.evidence.filter(e => e.family === f.id), il = x.filter(e => e.status === 'ILLICIT').length, be = x.filter(e => e.status === 'BENIGN').length, un = x.filter(e => e.status === 'UNKNOWN').length;
            return <button key={f.id} onClick={() => setFam(fam === f.id ? 'ALL' : f.id)} aria-pressed={fam === f.id} className={cx('rounded border p-2.5 text-left transition-colors', fam === f.id ? 'border-zinc-400 bg-zinc-400/5' : 'border-line bg-panel2 hover:border-line2')}>
              <div className="flex items-center justify-between"><span className="font-mono text-sm font-semibold text-zinc-300">{f.id}</span><span className="text-[10px] text-dim">{x.length} live</span></div>
              <div className="mt-1 text-[11px] leading-tight text-mute">{f.short}</div>
              <div className="mt-2 flex gap-1 text-[10px]"><span className="text-neutral-300">{il} flag</span><span className="text-dim">·</span><span className="text-gray-300">{be} ok</span><span className="text-dim">·</span><span className="text-slate-400">{un} n/a</span></div></button>;
          })}
        </div>
      </Panel>
      <Panel title="Check-by-check findings" subtitle="Click any row to see what we observed, what was expected, why it triggered, and the exact source transactions." right={<Tabs tabs={(['ALL', 'ILLICIT', 'BENIGN', 'UNKNOWN'] as const).map(s => ({ id: s, label: s === 'ALL' ? `All (${r.evidence.length})` : s === 'ILLICIT' ? `Red flags (${cnt('ILLICIT')})` : s === 'BENIGN' ? `Normal (${cnt('BENIGN')})` : `No data (${cnt('UNKNOWN')})` }))} value={st} onChange={setSt} />} bodyClass="p-0">
        {ev.length === 0 && <div className="p-6 text-center text-sm text-mute">No checks match this filter.</div>}
        {ev.map(e => (
          <div key={e.id} className="border-t border-line first:border-t-0">
            <button onClick={() => setOpen(open === e.id ? null : e.id)} className="grid w-full grid-cols-[18px_44px_1fr_auto] items-center gap-3 px-4 py-2.5 text-left hover:bg-panel2/60 md:grid-cols-[18px_44px_240px_130px_1fr]" aria-expanded={open === e.id}>
              {open === e.id ? <ChevronDown size={14} className="text-mute" /> : <ChevronRight size={14} className="text-mute" />}
              <Mono className="text-zinc-300">{e.id}</Mono><span className="text-[13px] font-medium">{e.name}</span>
              <span className="hidden md:block"><StatusBadge s={e.status} /></span>
              <span className="truncate text-xs text-mute md:block">{e.observed}</span>
            </button>
            {open === e.id && (
              <div className="fade-in space-y-3 border-t border-line bg-panel2/50 px-4 py-3 pl-[74px] text-[13px]">
                <div className="md:hidden"><StatusBadge s={e.status} /></div>
                <div className="grid gap-3 md:grid-cols-2"><div><div className="text-xs text-mute">What we saw</div>{e.observed}</div><div><div className="text-xs text-mute">What is normal for this business</div>{e.expected}</div></div>
                <div><div className="text-xs text-mute">Why this matters</div>{e.explanation}</div>
                {quant && (
                  <>
                    <div className="flex flex-wrap gap-2 text-[11px] text-dim">
                      <Badge>p-value: {e.p === null ? 'rule' : e.p < 1e-4 ? e.p.toExponential(1) : e.p.toFixed(4)}</Badge>
                      <Badge>effect: {e.effect === null ? '—' : e.effect.toFixed(2)}</Badge>
                      <Badge>n = {e.n}</Badge>
                      <Badge>weight: {e.llr >= 0 ? '+' : ''}{e.llr.toFixed(2)} nats</Badge>
                      <Badge>family {e.family}</Badge>
                      <Badge>source: {e.provenance}</Badge>
                      <Badge>fake difficulty: {e.fakeDifficulty.toFixed(2)}</Badge>
                    </div>
                    {Object.keys(e.metrics).length > 0 && <div className="flex flex-wrap gap-x-6 gap-y-1">{Object.entries(e.metrics).map(([k, v]) => <span key={k} className="text-xs"><span className="text-dim">{k}: </span><Mono>{v}</Mono></span>)}</div>}
                  </>
                )}
                <RecordPeek r={r} ids={e.records} />
              </div>)}
          </div>))}
      </Panel>
      <Callout tone="info" title="Why L3 does not open a case on its own">Checks here only gather facts. Combining them safely—without double-counting related signals or punishing missing feeds—happens next in L4.</Callout>
    </LayerFrame>
  );
}
