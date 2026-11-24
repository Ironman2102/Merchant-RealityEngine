import type { ReactNode } from 'react';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { LAYERS } from '../../data/evidence';
import type { LayerId } from '../../types/investigation';
import { useInvestigation } from '../../hooks/useInvestigation';
import { Badge, Btn, Card } from '../ui/ui';

export interface LayerBrief {
  checks: string;
  happened: ReactNode;
  whyItMatters: ReactNode;
}

/**
 * Standard frame for each of the 7 layers:
 *  - Clear merchant-specific 3-part briefing ("What this layer checks", "What happened for this merchant", "Why it matters & next step")
 *  - Live layer body (tables, charts, interactive controls)
 *  - "Next: L(n+1) →" progression button at the bottom
 */
export function LayerFrame({
  n,
  children,
  summary,
  brief,
}: {
  n: LayerId;
  children: ReactNode;
  evidenceCount?: number;
  evidenceLabel?: string;
  defaultOpen?: boolean;
  summary?: ReactNode;
  brief?: LayerBrief;
}) {
  const { status, started, run, selectLayer } = useInvestigation();
  const m = LAYERS[n - 1], st = status[n];
  const nextLayer = n < 7 ? LAYERS[n] : null;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="flex h-8 w-10 items-center justify-center rounded border border-indigo-200 bg-indigo-50 font-mono text-sm font-semibold text-indigo-700">{m.code}</span>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold">{m.name}</div>
            <div className="text-xs text-mute">{m.tagline}</div>
          </div>
          {st === 'done'
            ? <Badge tone="ok"><Check size={11} />Complete</Badge>
            : st === 'running'
              ? <Badge tone="info"><Loader2 size={11} className="animate-spin" />Running</Badge>
              : <Badge>Pending</Badge>}
        </div>

        {brief ? (
          <div className="grid gap-px border-t border-line bg-line md:grid-cols-3">
            <div className="bg-panel p-4">
              <div className="text-[11px] font-medium uppercase tracking-wider text-mute">1. What this layer checks</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink/90">{brief.checks}</p>
            </div>
            <div className="bg-panel p-4">
              <div className="text-[11px] font-medium uppercase tracking-wider text-mute">2. What happened here</div>
              <div className="mt-1.5 text-[13px] leading-relaxed text-ink">{brief.happened}</div>
            </div>
            <div className="bg-panel p-4">
              <div className="text-[11px] font-medium uppercase tracking-wider text-mute">3. Why it matters &amp; next step</div>
              <div className="mt-1.5 text-[13px] leading-relaxed text-mute">{brief.whyItMatters}</div>
            </div>
          </div>
        ) : summary ? (
          <div className="border-t border-line px-4 py-2.5 text-sm text-mute">{summary}</div>
        ) : null}
      </Card>

      {st === 'done' ? (
        <div className="fade-in space-y-4">
          {children}
          {nextLayer && (
            <div className="flex items-center justify-between rounded-md border border-line bg-panel px-4 py-3">
              <div className="text-xs text-mute">
                Next step in the 7-layer pipeline: <b className="text-ink">{nextLayer.code} · {nextLayer.name}</b> — {nextLayer.tagline}
              </div>
              <Btn size="sm" variant="primary" onClick={() => selectLayer(nextLayer.n)}>
                Next: {nextLayer.code} {nextLayer.name} <ArrowRight size={13} />
              </Btn>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-line2 px-6 py-10 text-center text-sm text-mute">
          {st === 'running' ? (
            <div className="mx-auto max-w-xs">
              <div className="scanbar mb-3 h-1.5 rounded-full bg-line" />
              Processing layer {m.code}…
            </div>
          ) : (
            <div className="space-y-3">
              <div>{m.code} results appear once the investigation has run.</div>
              {!started && <Btn variant="primary" onClick={() => run()}>Run investigation</Btn>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
