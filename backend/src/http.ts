import type { IncomingMessage, ServerResponse } from 'node:http';
import { approveInvestigation, auditStatus, getInvestigation, labelInvestigation, listInvestigations, openInvestigation, respondInvestigation, reviewInvestigation, type ApiReply } from './workflow';
import { actorFromToken, clearCookie, login, logout, readCookie, sessionCookie, userCount, type Actor } from './auth';
import { caseTrace, evidencePack } from './trace';
import { llmEnabled, summarise } from './llm';

const LIMIT = 2_000_000;

/** Per-client token bucket: 60 requests per minute. ponytail: in-memory, per process; move to a shared store with >1 API process. */
const buckets = new Map<string, { tokens: number; at: number }>();
function allowed(key: string, perMin = 60, now = Date.now()): boolean {
  const b = buckets.get(key) ?? { tokens: perMin, at: now };
  b.tokens = Math.min(perMin, b.tokens + ((now - b.at) / 60000) * perMin); b.at = now;
  if (b.tokens < 1) { buckets.set(key, b); return false; }
  b.tokens -= 1; buckets.set(key, b); return true;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    n += buf.length;
    if (n > LIMIT) throw Object.assign(new Error('Body is larger than 2 MB.'), { status: 413 });
    chunks.push(buf);
  }
  if (!n) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Body is not JSON.'), { status: 400 }); }
}

function send(res: ServerResponse, reply: ApiReply, headers: Record<string, string> = {}): void {
  const json = JSON.stringify(reply.body);
  res.statusCode = reply.status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader('content-length', Buffer.byteLength(json));
  res.end(json);
}

/** One router for the local server and the Vercel function. */
export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const ip = req.socket.remoteAddress ?? 'local';
    if (!allowed(ip)) return send(res, { status: 429, body: { error: 'Too many requests. Try again in a minute.' } });
    const url = new URL(req.url || '/', 'http://localhost');
    const path = (url.pathname.replace(/\/+$/, '') || '/').replace(/^\/api/, '') || '/';
    const method = req.method || 'GET';
    // CSRF: state-changing requests must be JSON (a cross-site HTML form cannot send that without a CORS preflight)
    // and the session cookie is SameSite=Strict.
    if (method !== 'GET' && !(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, { status: 415, body: { error: 'Send JSON (content-type: application/json).' } });

    if (path === '/health' && method === 'GET') return send(res, { status: 200, body: { status: 'ok', service: 'merchant-reality-engine-api', storage: process.env.MRE_CASE_STORE === 'memory' ? 'memory' : 'sqlite', users: userCount() > 0, llm: llmEnabled(), liveConnectors: 0 } });

    const token = readCookie(req), actor: Actor | null = actorFromToken(token);
    if (path === '/auth/login' && method === 'POST') {
      if (!allowed(`login:${ip}`, 10)) return send(res, { status: 429, body: { error: 'Too many sign-in attempts. Wait a minute.' } });
      const b = await readBody(req) as { username?: unknown; password?: unknown };
      const s = typeof b.username === 'string' && typeof b.password === 'string' ? login(b.username, b.password) : null;
      if (!s) return send(res, { status: 401, body: { error: 'Wrong username or password.' } });
      return send(res, { status: 200, body: { user: s.actor } }, { 'set-cookie': sessionCookie(s.token) });
    }
    if (path === '/auth/logout' && method === 'POST') { if (token) logout(token); return send(res, { status: 200, body: { ok: true } }, { 'set-cookie': clearCookie() }); }
    if (path === '/auth/me' && method === 'GET') return actor ? send(res, { status: 200, body: { user: actor } }) : send(res, { status: 401, body: { error: 'Not signed in.' } });

    const match = path.match(/^\/investigations(?:\/([^/]+)(?:\/(review|response|approve|label|trace|pack|summary|audit))?)?$/);
    if (!match) return send(res, { status: 404, body: { error: 'Unknown route.' } });
    if (!actor) return send(res, { status: 401, body: { error: 'Sign in to use the investigation API.' } });
    const [, id, action] = match;

    if (!id) {
      if (method === 'GET') { const caseId = url.searchParams.get('id'); return send(res, caseId ? getInvestigation(caseId) : listInvestigations()); }
      if (method !== 'POST') return send(res, { status: 405, body: { error: 'POST a dataset to open a case.' } });
      return send(res, openInvestigation(await readBody(req), actor));
    }
    if (method === 'GET') {
      if (!action) return send(res, getInvestigation(id));
      if (action === 'trace') return send(res, caseTrace(id));
      if (action === 'pack') return send(res, evidencePack(id, actor));
      if (action === 'audit') return send(res, auditStatus(id));
      return send(res, { status: 405, body: { error: 'Use POST for this step.' } });
    }
    if (method !== 'POST' || !action) return send(res, { status: 405, body: { error: 'Use GET for the case, or POST review, response, approve, label or summary.' } });
    const body = await readBody(req);
    const reply = action === 'review' ? reviewInvestigation(id, body, actor)
      : action === 'response' ? respondInvestigation(id, body, actor)
      : action === 'approve' ? approveInvestigation(id, body, actor)
      : action === 'label' ? labelInvestigation(id, body, actor)
      : action === 'summary' ? await summarise(id, actor)
      : { status: 405, body: { error: 'Unknown step.' } };
    send(res, reply);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    send(res, { status, body: { error: status === 500 ? 'Investigation API failed.' : err instanceof Error ? err.message : 'Request failed.' } });
    if (status === 500) console.error(err);
  }
}
