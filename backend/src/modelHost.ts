/**
 * Keep the Daytona sandbox that serves the Stage 2 model alive and its server running (Daytona v2 API, api.daytona.com).
 * The API key stays on the server. A Linux sandbox on v2 cannot be stopped, only deleted when its lifetime ends, so
 * "start" re-arms the lifetime and (re)starts the model server, and "stop" ends only the model server process.
 */

const api = () => (process.env.DAYTONA_API_URL || 'https://api.daytona.com').replace(/\/$/, '');
const key = () => process.env.DAYTONA_API_KEY || '';
const sandboxId = () => process.env.DAYTONA_SANDBOX_ID || '';
const appDir = () => process.env.MRE_SANDBOX_APP_DIR || '/workspace/mre';
// ponytail: each start re-arms the plan's maximum lifetime (24 h). A sandbox whose lifetime already ran out is deleted
// by Daytona and has to be recreated by hand (then update DAYTONA_SANDBOX_ID and MRE_ML_URL).
const LIFETIME_SECONDS = 86400;
const SERVER = 'uvicorn ml.serve:app';
// The [u] keeps pkill from matching the shell that runs it. Run it on its own: a shell whose command line also holds
// the launch text would match and kill itself.
const KILL = 'pkill -f "[u]vicorn ml.serve:app"';

export function modelHostConfigured(): boolean { return key().length > 0 && sandboxId().length > 0; }

async function daytona(url: string, method = 'GET', body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url.startsWith('http') ? url : `${api()}${url}`, {
    method,
    headers: { authorization: `Bearer ${key()}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status, json };
}

const mlUrl = () => (process.env.MRE_ML_URL ?? 'http://127.0.0.1:8790').replace(/\/$/, '');

export async function modelHealth(): Promise<Record<string, unknown> | null> {
  const url = mlUrl();
  if (!url) return null;
  try {
    // /status, not /health: behind a Daytona preview URL the proxy answers /health with its own status.
    const res = await fetch(`${url}/status`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const body = await res.json() as Record<string, unknown>;
    return body.status === 'ok' ? body : null;
  } catch { return null; }
}

export async function modelOnline(): Promise<boolean> {
  return (await modelHealth()) !== null;
}

async function modelUpToDate(): Promise<boolean> {
  const body = await modelHealth() as { model?: string; nn?: boolean; serveVersion?: number } | null;
  return !!body && body.model === 'stage2-v1' && body.nn === true && body.serveVersion === 3;
}

/** The sandbox record, or why it cannot be used. */
async function sandbox(): Promise<{ ok: true; status: string; toolbox: string } | { ok: false; state: string; detail: string }> {
  const got = await daytona(`/sandboxes/${encodeURIComponent(sandboxId())}`);
  if (got.status === 404) return { ok: false, state: 'missing', detail: 'The model sandbox no longer exists: Daytona deletes a sandbox when its lifetime ends. Create a new one and update DAYTONA_SANDBOX_ID and MRE_ML_URL.' };
  if (got.status >= 400) return { ok: false, state: 'error', detail: `Daytona returned ${got.status} when asked about the sandbox.` };
  return { ok: true, status: String(got.json.status ?? ''), toolbox: String(got.json.toolbox_proxy_url ?? '') };
}

/** Run a shell command in the sandbox and wait up to `waitMs` for it to finish. */
async function exec(toolbox: string, command: string, waitMs = 5000): Promise<number> {
  const url = `${toolbox.replace(/\/$/, '')}/${encodeURIComponent(sandboxId())}/processes?waitMs=${waitMs}`;
  return (await daytona(url, 'POST', { argv: ['sh', '-c', command], cwd: appDir() })).status;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Extend the sandbox's lifetime and make sure the model server is answering, restarting it if not. */
export async function startModelSandbox(): Promise<{ online: boolean; state: string; detail: string }> {
  if (!modelHostConfigured()) return { online: false, state: 'unconfigured', detail: 'The server has no Daytona key or sandbox id, so this site cannot start the model.' };
  const sb = await sandbox();
  if (!sb.ok) return { online: false, state: sb.state, detail: sb.detail };
  const extended = await daytona(`/sandboxes/${encodeURIComponent(sandboxId())}/lifecycle-policy`, 'PATCH', { timeout_seconds: LIFETIME_SECONDS });
  const life = extended.status < 400 ? ' Sandbox lifetime reset to 24 hours from now.' : ` (Lifetime not extended: Daytona returned ${extended.status}.)`;
  if (await modelUpToDate()) return { online: true, state: 'started', detail: `The model is already answering.${life}` };
  if (sb.status !== 'running') return { online: false, state: sb.status, detail: `The sandbox is ${sb.status}, so the model server cannot be started.${life}` };
  await exec(sb.toolbox, KILL);
  await sleep(1000);
  const ran = await exec(sb.toolbox, `setsid env MRE_ENCODER_PRELOAD=1 MRE_BI_ENCODER_AUTOLOAD=1 python3 -m ${SERVER} --host 0.0.0.0 --port 8790 </dev/null >/tmp/m1.log 2>&1 &`);
  if (ran >= 400) return { online: false, state: 'error', detail: `Daytona returned ${ran} when asked to start the model server.${life}` };
  const readyBy = Date.now() + 35000;
  while (Date.now() < readyBy) {
    if (await modelUpToDate()) return { online: true, state: 'started', detail: `The model server was restarted and is answering.${life}` };
    await sleep(2500);
  }
  return { online: false, state: 'starting', detail: `The model server is starting. Press the button again in a minute if it is still offline.${life}` };
}

/** Stop the model server process. The sandbox keeps running (a v2 Linux sandbox can only be deleted, not stopped). */
export async function stopModelSandbox(): Promise<void> {
  if (!modelHostConfigured()) return;
  const sb = await sandbox().catch(() => null);
  if (sb?.ok) await exec(sb.toolbox, KILL).catch(() => undefined);
}
