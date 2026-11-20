/** Wake the Daytona sandbox that serves M1. The API key stays on the server. */

const api = () => (process.env.DAYTONA_API_URL || 'https://app.daytona.io/api').replace(/\/$/, '');
const key = () => process.env.DAYTONA_API_KEY || '';
const sandboxName = () => process.env.DAYTONA_SANDBOX_ID || 'mre-m1';

export function modelHostConfigured(): boolean { return key().length > 0; }

async function daytona(path: string, method = 'GET', body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${api()}${path}`, {
    method,
    headers: { authorization: `Bearer ${key()}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status, json };
}

export async function modelOnline(): Promise<boolean> {
  const url = process.env.MRE_ML_URL;
  if (!url) return false;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return false;
    const body = await res.json() as { status?: string };
    return body.status === 'ok';
  } catch { return false; }
}

async function launchServer(id: string): Promise<void> {
  const info = await daytona(`/sandbox/${encodeURIComponent(id)}`);
  const realId = String(info.json.id || id);
  const base = String(info.json.toolboxProxyUrl || '');
  if (!base) return;
  await fetch(`${base.replace(/\/$/, '')}/${realId}/process/execute`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key()}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      command: 'curl -sf http://127.0.0.1:8790/health >/dev/null || (cd /tmp/mre && nohup python3 -m uvicorn ml.serve:app --host 0.0.0.0 --port 8790 >/tmp/m1.log 2>&1 &)',
      cwd: '/tmp/mre',
      timeout: 20,
    }),
    signal: AbortSignal.timeout(25000),
  });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Start the named sandbox if it is stopped, then make sure the model process is listening. */
export async function startModelSandbox(): Promise<{ online: boolean; state: string; detail: string }> {
  if (!modelHostConfigured()) return { online: false, state: 'unconfigured', detail: 'The server has no Daytona key, so this site cannot start the sandbox.' };
  if (await modelOnline()) return { online: true, state: 'started', detail: 'The model is already answering.' };
  const id = encodeURIComponent(sandboxName());
  const started = await daytona(`/sandbox/${id}/start`, 'POST');
  if (started.status >= 400 && started.status !== 400) {
    return { online: false, state: 'error', detail: `Daytona returned ${started.status} when asked to start the sandbox.` };
  }
  let state = String(started.json.state || '');
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    if (await modelOnline()) return { online: true, state: state || 'started', detail: 'The model is answering.' };
    const got = await daytona(`/sandbox/${id}`);
    state = String(got.json.state || state);
    if (state.toLowerCase() === 'started') break;
    await sleep(2000);
  }
  await launchServer(sandboxName());
  const readyBy = Date.now() + 20000;
  while (Date.now() < readyBy) {
    if (await modelOnline()) return { online: true, state: 'started', detail: 'The model is answering.' };
    await sleep(2000);
  }
  return { online: false, state: state || 'starting', detail: 'The sandbox was asked to start. Press the button again in a moment if the model is still offline.' };
}

/** Stop the sandbox after a score so it does not keep running. */
export async function stopModelSandbox(): Promise<void> {
  if (!modelHostConfigured()) return;
  await daytona(`/sandbox/${encodeURIComponent(sandboxName())}/stop`, 'POST').catch(() => undefined);
}
