import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, MessageSquareText } from 'lucide-react';
import type { InvestigationResult } from '../../types/investigation';
import type { Label } from '../../types/merchant';
import type { EvidenceItem } from '../../types/evidence';
import { FAMILIES } from '../../data/evidence';
import { LADDER, runPatternPack, type PatternResult, type PatternStatus } from '../../engines/patternPack';
import { Panel, Tabs } from '../ui/ui';
import { cx } from '../../utils/format';

type View = 'all' | 'flagged' | 'clear' | 'other';
type Row = { id: string; name: string; status: PatternStatus; observed: string; expected: string; why?: string; data?: string; detail?: { label: string; value: string }[] };

const STYLE: Record<PatternStatus, { label: string; cls: string; card: string; Icon: typeof AlertTriangle }> = {
  FLAGGED: { label: 'Flagged', cls: 'bg-neutral-400/15 text-neutral-300', card: 'border-neutral-400/40 bg-neutral-400/[0.04]', Icon: AlertTriangle },
  CLEAR: { label: 'Clear', cls: 'bg-ok/10 text-ok', card: 'border-line bg-panel', Icon: CheckCircle2 },
  UNKNOWN: { label: 'Unknown · no data', cls: 'bg-dim/20 text-dim', card: 'border-line border-dashed bg-panel', Icon: CircleHelp },
  INPUT: { label: 'Needs merchant input', cls: 'bg-stone-400/15 text-stone-300', card: 'border-stone-400/40 bg-stone-400/[0.04]', Icon: MessageSquareText },
};
const fromEvidence = (e: EvidenceItem): Row => ({
  id: e.id, name: e.name, status: e.status === 'ILLICIT' ? 'FLAGGED' : e.status === 'BENIGN' ? 'CLEAR' : 'UNKNOWN',
  observed: e.observed, expected: e.expected, why: e.explanation, data: e.system,
});
const keep = (v: View) => (r: Row) => v === 'all' || (v === 'flagged' ? r.status === 'FLAGGED' : v === 'clear' ? r.status === 'CLEAR' : r.status === 'UNKNOWN' || r.status === 'INPUT');

function Card({ r, children }: { r: Row; children?: React.ReactNode }) {
  const s = STYLE[r.status];
  return (
    <div className={cx('rounded-md border p-3.5', s.card)}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-medium"><span className="mr-1.5 font-mono text-xs font-semibold text-ink">{r.id}</span>{r.name}</div>
        <span className={cx('flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium', s.cls)}><s.Icon size={11} />{s.label}</span>
      </div>
      <div className="mt-2 grid gap-2 text-[12.5px] sm:grid-cols-2">
        <div><div className="text-[10px] uppercase tracking-wide text-dim">Observed</div><div className={r.status === 'FLAGGED' ? 'text-neutral-100' : 'text-ink'}>{r.observed}</div></div>
        <div><div className="text-[10px] uppercase tracking-wide text-dim">Expected</div><div className="text-mute">{r.expected}</div></div>
      </div>
      {r.detail && r.detail.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{r.detail.map(d => <span key={d.label} className="rounded border border-line bg-panel2 px-2 py-0.5 text-[11px] text-mute">{d.label}: <span className="text-ink">{d.value}</span></span>)}</div>}
      {r.why && <p className="mt-2 text-[11.5px] leading-relaxed text-dim">{r.why}{r.data ? <span className="text-dim/80"> · Data: {r.data}</span> : null}</p>}
      {children}
    </div>
  );
}

function Passport({ res }: { res: InvestigationResult }) {
  const conduct = res.evidence.filter(e => e.status === 'ILLICIT' && e.signal === 'conduct');
  const change = res.evidence.filter(e => e.status === 'ILLICIT' && e.signal === 'profile');
  return (
    <div className="mt-3 rounded-md border border-line bg-panel2 p-3 text-xs text-mute">
      {change.length > 0 && <div>A verified Context Passport could explain: {change.map(e => `${e.id} ${e.name}`).join(' · ')}</div>}
      {conduct.length > 0 && <div className="font-medium text-bad">No passport can explain conduct signals: {conduct.map(e => `${e.id} ${e.name}`).join(' · ')}</div>}
      {!change.length && !conduct.length && <div>No profile or conduct anomalies flagged.</div>}
    </div>
  );
}

export function PatternBoard({ res, label = null }: { res: InvestigationResult; label?: Label | null }) {
  const pack = useMemo(() => runPatternPack(res, label), [res, label]);
  const [view, setView] = useState<View>('all');
  const core = res.evidence.map(fromEvidence);
  const all: Row[] = [...core, ...pack.results];
  const n = (s: PatternStatus) => all.filter(r => r.status === s).length;
  const solutions = pack.results.filter(r => r.group === 'Solution pattern').filter(keep(view));
  const fresh = pack.results.filter(r => r.group === 'New pattern').filter(keep(view));
  const lvl = LADDER.findIndex(l => l.id === pack.ladder);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[['Patterns checked', all.length, 'text-ink'], ['Flagged', n('FLAGGED'), 'text-bad'], ['Clear', n('CLEAR'), 'text-ok'], ['Needs merchant input', n('INPUT'), 'text-warn'], ['Unknown (no data)', n('UNKNOWN'), 'text-dim']].map(([l, v, c]) => (
          <div key={l as string} className="rounded-md border border-line bg-panel p-4"><div className="text-xs text-mute">{l}</div><div className={cx('mt-1 text-2xl font-semibold tabular-nums', c as string)}>{v}</div></div>))}
      </div>

      <Panel title="Graduated trust ladder (S5)" subtitle={pack.ladderWhy}>
        <div className="grid gap-2 md:grid-cols-5">{LADDER.map((l, i) => (
          <div key={l.id} className={cx('rounded-md border p-3', i === lvl ? (i >= 2 ? 'border-neutral-400/60 bg-neutral-400/10' : 'border-stone-400/60 bg-stone-400/10') : i < lvl ? 'border-line bg-panel2/60' : 'border-line bg-panel')}>
            <div className={cx('text-sm font-semibold', i === lvl ? 'text-ink' : 'text-mute')}>{i === lvl ? '▶ ' : ''}{l.name}</div>
            <div className="mt-1 text-[11.5px] leading-snug text-mute">{l.action}</div></div>))}</div>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs<View> value={view} onChange={setView} tabs={[{ id: 'all', label: 'All' }, { id: 'flagged', label: `Flagged (${n('FLAGGED')})` }, { id: 'clear', label: `Clear (${n('CLEAR')})` }, { id: 'other', label: `Input / unknown (${n('INPUT') + n('UNKNOWN')})` }]} />
        <div className="text-xs text-dim">Category model says: <span className="text-ink">{pack.categories[0].name}</span> · declared: <span className="text-ink">{pack.declared}</span></div>
      </div>

      <section className="space-y-3">
        <h3 className="text-base font-semibold">Solution patterns <span className="text-sm font-normal text-mute">S1–S7 from the team’s solution design</span></h3>
        <div className="grid gap-3 lg:grid-cols-2">{solutions.map(r => <Card key={r.id} r={r as PatternResult}>{r.id === 'S4' && r.status === 'INPUT' && <Passport res={res} />}</Card>)}</div>
        {!solutions.length && <p className="text-sm text-dim">None in this view.</p>}
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold">New betting patterns <span className="text-sm font-normal text-mute">N1–N3, added for this challenge</span></h3>
        <div className="grid gap-3 lg:grid-cols-3">{fresh.map(r => <Card key={r.id} r={r} />)}</div>
        {!fresh.length && <p className="text-sm text-dim">None in this view.</p>}
      </section>

      <section className="space-y-4">
        <h3 className="text-base font-semibold">Core detectors <span className="text-sm font-normal text-mute">{res.evidence.length} live detectors across nine evidence families (feed the L4 fusion verdict)</span></h3>
        {FAMILIES.map(f => {
          const rows = res.evidence.filter(e => e.family === f.id).map(fromEvidence).filter(keep(view));
          if (!rows.length) return null;
          return (
            <div key={f.id}>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-mute"><span className="font-mono font-semibold text-ink">{f.id}</span> · {f.name}</div>
              <div className="grid gap-3 lg:grid-cols-2">{rows.map(r => <Card key={r.id} r={r} />)}</div>
            </div>);
        })}
      </section>
      <p className="text-xs text-dim">Solution and new patterns are transparent heuristics shown next to the core engine; they inform the trust ladder but do not change the L4 fusion verdict. Category prototypes are illustrative, not a trained model. All data is synthetic.</p>
    </div>
  );
}
