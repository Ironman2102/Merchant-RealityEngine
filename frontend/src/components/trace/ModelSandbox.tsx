/** Start the Daytona sandbox that serves the second-opinion model. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Btn } from '../ui/ui';

type Host = { online?: boolean; configured?: boolean; state?: string; detail?: string };

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
  if (!host) return <p className="text-sm text-mute">Checking the model sandbox…</p>;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className={host.online ? 'text-gray-300' : 'text-mute'}>{host.online ? 'Model sandbox is running. Starting or stopping it does not change the case decision.' : (host.detail || 'Model sandbox is stopped.')}</span>
      {!host.online && host.configured !== false && <Btn size="sm" variant="primary" onClick={() => void start()} disabled={busy}>{busy ? 'Starting…' : 'Start model sandbox'}</Btn>}
    </div>
  );
}
