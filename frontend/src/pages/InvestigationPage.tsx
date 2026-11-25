import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Layers, Loader2, SlidersHorizontal } from 'lucide-react';
import { useInvestigation } from '../hooks/useInvestigation';
import { QuantModeProvider, useQuantMode } from '../hooks/useQuantMode';
import { AnswerBanner } from '../components/common/AnswerBanner';
import { ClaimedVsReality } from '../components/investigation/ClaimedVsReality';
import { PassportPanel } from '../components/investigation/PassportPanel';
import { StreamsPanel } from '../components/investigation/StreamsPanel';
import { ActionPack } from '../components/investigation/ActionPack';
import { LAYERS } from '../data/evidence';
import { L1View } from '../layers/L1Ingestion';
import { L2View } from '../layers/L2MerchantProfile';
import { L3View } from '../layers/L3Detection';
import { L4View } from '../layers/L4EvidenceFusion';
import { L5View } from '../layers/L5AnalystReview';
import { L6View } from '../layers/L6Response';
import { L7View } from '../layers/L7AuditLearning';
import { Badge, Btn, Callout, Card, Panel } from '../components/ui/ui';
import { cx } from '../utils/format';
import type { LayerId } from '../types/investigation';

const VIEWS: Record<LayerId, () => JSX.Element> = { 1: L1View, 2: L2View, 3: L3View, 4: L4View, 5: L5View, 6: L6View, 7: L7View };

function InvestigationBody({ progressOnly = false }: { progressOnly?: boolean }) {
  const { status, selectedLayer, selectLayer, scenario, result, run, started, running, allDone } = useInvestigation();
  const { quant, setQuant } = useQuantMode();
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const View = VIEWS[selectedLayer];
  const active = LAYERS[selectedLayer - 1];

  const fired = [...result.evidence].filter(e => e.status === 'ILLICIT').sort((a, b) => b.llr - a.llr);
  const calm = result.evidence.filter(e => e.status === 'BENIGN');
  const unknown = result.evidence.filter(e => e.status === 'UNKNOWN');
  const maxLlr = Math.max(1, ...fired.map(e => Math.abs(e.llr)));

  if (progressOnly) return (
    <>
      <div><h2 className="text-lg font-semibold text-ink">Seven-layer simulation</h2><p className="mt-1 text-sm text-mute">Each layer runs in sequence. The Executive Dossier appears as soon as the investigation finishes.</p></div>
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <ol className="space-y-1.5" aria-label="Seven-layer simulation progress">
          {LAYERS.map(l => { const st = status[l.n], selected = selectedLayer === l.n; return (
            <li key={l.n} aria-current={selected ? 'step' : undefined} className={cx('flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors', selected ? 'border-ink/30 bg-ink/5' : 'border-line bg-panel')}>
              <span className={cx('flex h-7 w-9 shrink-0 items-center justify-center rounded font-mono text-xs font-semibold', st === 'done' ? 'bg-ok/15 text-ok' : st === 'running' ? 'bg-ink/10 text-ink' : 'bg-panel2 text-dim')}>{l.code}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-ink">{l.name}</span>{st === 'running' ? <span className="scanbar mt-1.5 block h-1 rounded-full bg-line" /> : <span className="block text-[11px] text-dim">{st === 'done' ? 'Complete' : 'Waiting'}</span>}</span>
              {st === 'done' ? <Check size={14} className="text-ok" /> : st === 'running' ? <Loader2 size={14} className="animate-spin text-ink" /> : null}
            </li>); })}
        </ol>
        <Panel title={`${active.code} · ${active.name}`} subtitle={active.tagline} right={<span className="text-xs text-mute">Layer {selectedLayer} of 7</span>}>
          <div className="scanbar mb-4 h-1.5 rounded-full bg-line" />
          <p className="text-sm text-mute">{active.does}</p>
          <div className="mt-4 border-t border-line pt-4"><div className="mb-2 text-xs font-medium text-mute">Current layer operations</div><ul className="grid gap-2 text-sm sm:grid-cols-2">{active.processes.map(process => <li key={process} className="rounded-lg border border-line bg-panel2 px-3 py-2 text-ink">{process}</li>)}</ul></div>
        </Panel>
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Merchant Case Dossier</h1>
          <p className="mt-1 text-sm text-mute">{scenario.profile.name} · {scenario.profile.category} ({scenario.profile.city})</p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-full border border-line bg-panel p-0.5 text-xs" role="group" aria-label="Detail level">
            <button
              type="button"
              onClick={() => setQuant(false)}
              className={cx('rounded-full px-3 py-1.5 font-medium transition-colors', !quant ? 'bg-ink text-bg' : 'text-mute hover:text-ink')}
            >
              Plain English
            </button>
            <button
              type="button"
              onClick={() => setQuant(true)}
              className={cx('inline-flex items-center gap-1 rounded-full px-3 py-1.5 font-medium transition-colors', quant ? 'bg-ink text-bg' : 'text-mute hover:text-ink')}
            >
              <SlidersHorizontal size={12} />Quant &amp; Technical Proof
            </button>
          </div>
          {!started && <Btn variant="primary" onClick={() => run()} disabled={running}>Run investigation</Btn>}
        </div>
      </div>

      {!started && <Callout tone="info" title="Ready to investigate">{scenario.blurb}</Callout>}

      {started && allDone && (
        <>
          {/* 1. Hero Risk Verdict Banner */}
          <AnswerBanner result={result} quant={quant} />

          <StreamsPanel />
          <PassportPanel />

          {/* 2. Side-by-Side Claimed vs Reality + 24-Hour Activity Chart */}
          <ClaimedVsReality result={result} />

          {/* 3. Visual Red Flag Signal Breakdown */}
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel2/80 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-semibold text-ink">Signal Breakdown ({fired.length} Red Flags · {calm.length} Normal · {unknown.length} No Data)</h3>
                <p className="text-xs text-mute">Measured on: {result.scope.label}. Missing data feeds carry zero weight, for or against the merchant.</p>
              </div>
              <div className="flex items-center gap-1.5">
                {fired.length > 0 && <Badge tone="bad">{fired.length} red flag{fired.length === 1 ? '' : 's'}</Badge>}
                <Badge tone="ok">{calm.length} normal</Badge>
                {unknown.length > 0 && <Badge tone="mute">{unknown.length} no data</Badge>}
              </div>
            </div>

            <div className="p-5 space-y-4">
              {fired.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {fired.map(e => {
                    const strength = Math.min(100, Math.max(18, Math.round((Math.abs(e.llr) / maxLlr) * 100)));
                    return (
                      <div key={e.id} className="rounded-xl border border-bad/30 bg-bad/5 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <AlertTriangle size={15} className="shrink-0 text-bad" />
                            <span className="text-sm font-semibold text-ink">{e.name}</span>
                          </div>
                          <Badge tone="bad">{e.family}</Badge>
                        </div>
                        <p className="mt-1.5 text-xs font-medium text-ink">{e.observed}</p>
                        <p className="mt-1 text-xs text-mute">{e.explanation}</p>
                        <div className="mt-3 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bad/15">
                            <div className="h-full rounded-full bg-bad" style={{ width: `${strength}%` }} />
                          </div>
                          {quant ? (
                            <span className="font-mono text-[11px] font-semibold text-bad">LLR +{e.llr.toFixed(2)}</span>
                          ) : (
                            <span className="text-[11px] font-medium text-bad">{strength >= 70 ? 'Strong signal' : 'Supporting signal'}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-ok/30 bg-ok/5 p-4 text-sm text-ok">
                  <b>No red flags fired.</b> Nothing measurable contradicts a {scenario.profile.category.toLowerCase()}. Payment data alone cannot prove what was sold.
                </div>
              )}

              {calm.length > 0 && (
                <div className="border-t border-line pt-3">
                  <div className="mb-2 text-xs font-semibold text-dim">Checked &amp; Looked Normal</div>
                  <div className="flex flex-wrap gap-1.5">
                    {calm.map(e => (
                      <Badge key={e.id} tone="ok">{e.name}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* 4. 1-Click Analyst Action Pack */}
          <ActionPack result={result} />

          {/* 5. Collapsible 7-Layer Technical Pipeline (L1-L7) */}
          <Card className="overflow-hidden">
            <button
              type="button"
              onClick={() => setPipelineOpen(o => !o)}
              className="flex w-full items-center justify-between gap-3 bg-panel2/80 px-5 py-4 text-left transition-colors hover:bg-panel2/80"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink/5 text-ink">
                  <Layers size={18} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-ink">Inspect 7-Layer Technical Pipeline (L1–L7)</div>
                  <div className="text-xs text-mute">Step through data ingestion, merchant baseline, detectors, Bayesian fusion, analyst review, response ladder, and audit chain</div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                {pipelineOpen ? 'Hide pipeline' : 'Expand L1–L7'}
                {pipelineOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </div>
            </button>

            {pipelineOpen && (
              <div className="border-t border-line p-5">
                <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
                  <ol className="space-y-1.5 lg:sticky lg:top-20 lg:self-start" aria-label="Layer progress">
                    {LAYERS.map(l => { const st = status[l.n], sel = selectedLayer === l.n; return (
                      <li key={l.n}>
                        <button
                          onClick={() => selectLayer(l.n)}
                          aria-current={sel ? 'step' : undefined}
                          className={cx('flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors', sel ? 'border-ink/30 bg-ink/5' : 'border-line bg-panel hover:border-line2')}
                        >
                          <span className={cx('flex h-7 w-9 shrink-0 items-center justify-center rounded font-mono text-xs font-semibold', st === 'done' ? 'bg-ok/15 text-ok' : st === 'running' ? 'bg-ink/10 text-ink' : 'bg-panel2 text-dim')}>{l.code}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-ink">{l.name}</span>
                            {st === 'running'
                              ? <span className="scanbar mt-1.5 block h-1 rounded-full bg-line" />
                              : <span className="block text-[11px] text-dim">{st === 'done' ? 'Complete' : 'Pending'}</span>}
                          </span>
                          {st === 'done' ? <Check size={14} className="text-ok" /> : st === 'running' ? <Loader2 size={14} className="animate-spin text-ink" /> : null}
                        </button>
                      </li>); })}
                  </ol>
                  <div className="min-w-0"><View /></div>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

export function InvestigationPage({ progressOnly = false }: { progressOnly?: boolean }) {
  return (
    <QuantModeProvider>
      <InvestigationBody progressOnly={progressOnly} />
    </QuantModeProvider>
  );
}
