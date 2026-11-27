/** Start the Daytona sandbox that serves the second-opinion model. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Btn } from '../ui/ui';

type MlHealth = {
  model?: string | null;
  nn?: boolean;
  classical?: boolean;
  autoencoder?: boolean;
  temporal?: boolean;
  graph?: boolean;
  biEncoder?: boolean;
  biEncoderStatus?: string;
  encoder?: boolean;
  encoderStatus?: string;
};
type Host = { online?: boolean; configured?: boolean; state?: string; detail?: string; health?: MlHealth | null };

export function ModelSandbox({ onReady }: { onReady?: () => void }) {
  const [host, setHost] = useState<Host | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = useRef(onReady);
  ready.current = onReady;
  const load = useCallback(async () => {
    const r = await fetch('/api/model');
    const body = await r.json().catch(() => ({})) as Host;
    setHost(r.ok ? body : { configured: false, detail: 'Could not read the model status.' });
    if (body.online) ready.current?.();
  }, []);
  useEffect(() => { void load(); }, [load]);
  const start = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/model/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const body = await r.json().catch(() => ({})) as Host;
      setHost(body);
      if (body.online) onReady?.();
    } finally { setBusy(false); }
  };
  const stop = async () => {
    setBusy(true);
    try {
      await fetch('/api/model/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      await load();
    } finally { setBusy(false); }
  };
  if (!host) return <p className="text-sm text-mute">Checking the model sandbox…</p>;
  const h = host.health;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className={host.online ? 'font-medium text-emerald-700' : 'text-amber-700'}>
          {host.online
            ? 'Stage 2 AI/ML service online. Starting or stopping it does not change the Bayesian case decision.'
            : (host.detail || 'Stage 2 AI/ML service offline — running in Bayesian-only mode.')}
        </span>
        {!host.online && host.configured !== false && <Btn size="sm" variant="primary" onClick={() => void start()} disabled={busy}>{busy ? 'Starting…' : 'Start model sandbox'}</Btn>}
        {host.online && host.configured && <Btn size="sm" onClick={() => void stop()} disabled={busy}>{busy ? 'Stopping…' : 'Stop model server'}</Btn>}
      </div>
      {host.online && h && (
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {h.model === 'stage2-v1' && <Badge tone="ok">Stage 2 v1 Ensemble</Badge>}
          {h.model === 'm1-v0' && <Badge tone="ok">LightGBM m1-v0</Badge>}
          {h.nn && <Badge tone="ok">MLP nn-v0</Badge>}
          {h.classical && <Badge tone="ok">Classical LR/DT/RF</Badge>}
          {h.autoencoder && <Badge tone="ok">Autoencoder ae-v0</Badge>}
          {h.temporal && <Badge tone="ok">Temporal 1D-CNN</Badge>}
          {h.graph && <Badge tone="ok">R-GCN Graph</Badge>}
          <Badge tone={h.biEncoder ? 'ok' : h.biEncoderStatus === 'loading' ? 'info' : 'mute'}>
            Bi-Encoder: {h.biEncoder ? 'neural' : h.biEncoderStatus === 'loading' ? 'loading…' : 'lexical'}
          </Badge>
          <Badge tone={h.encoder ? 'ok' : h.encoderStatus === 'loading' ? 'info' : 'mute'}>
            NLI Cross-Encoder: {h.encoder ? 'ready' : h.encoderStatus === 'loading' ? 'loading…' : (h.encoderStatus || 'idle')}
          </Badge>
        </div>
      )}
    </div>
  );
}
