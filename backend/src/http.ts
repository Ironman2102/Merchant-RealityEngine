import type { IncomingMessage, ServerResponse } from 'node:http';
import { approveInvestigation, auditStatus, getInvestigation, labelInvestigation, listInvestigations, openInvestigation, openInvestigationWithStage2, respondInvestigation, reviewInvestigation, type ApiReply } from './workflow';
import { actorFromToken, clearCookie, login, loginWithIdToken, logout, readCookie, sessionCookie, switchDemoRole, userCount, type Actor, type Role } from './auth';
import { oidcCheckFromEnv } from './oidc';
import { caseTrace, evidencePack } from './trace';
import { llmEnabled, summarise } from './llm';
import { v1FromNode } from './v1';
import { modelHostConfigured, modelOnline, startModelSandbox, stopModelSandbox } from './modelHost';
import { detectRings } from '../../engine/ringDetector';
import { getCase } from './store';
import { approveRuleProposal, getRulesStatus, promoteRuleProposal, rollbackRulesLive, runImproverProposal } from './improverApi';

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
    if (!allowed(`all:${ip}`, 300)) return send(res, { status: 429, body: { error: 'Too many requests. Try again in a minute.' } });
    const url = new URL(req.url || '/', 'http://localhost');
    const path = (url.pathname.replace(/\/+$/, '') || '/').replace(/^\/api/, '') || '/';
    const method = req.method || 'GET';
    // CSRF: state-changing requests must be JSON (a cross-site HTML form cannot send that without a CORS preflight)
    // and the session cookie is SameSite=Strict.
    if (method !== 'GET' && !(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, { status: 415, body: { error: 'Send JSON (content-type: application/json).' } });

    if (path === '/health' && method === 'GET') return send(res, { status: 200, body: { status: 'ok', service: 'merchant-reality-engine-api', storage: process.env.MRE_CASE_STORE === 'memory' ? 'memory' : 'sqlite', users: userCount() > 0, llm: llmEnabled(), liveConnectors: 0 } });

    const token = readCookie(req), actor: Actor | null = actorFromToken(token);
    if (path === '/auth/login' && method === 'POST') {
      const b = await readBody(req) as { username?: unknown; password?: unknown; idToken?: unknown };
      const who = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
      if (!allowed(`login:${ip}:${who}`, 30)) return send(res, { status: 429, body: { error: 'Too many sign-in attempts. Wait a minute.' } });
      const check = typeof b.idToken === 'string' ? oidcCheckFromEnv() : null;
      const s = typeof b.idToken === 'string'
        ? (check ? loginWithIdToken(b.idToken, check) : null)
        : typeof b.username === 'string' && typeof b.password === 'string' ? login(b.username, b.password) : null;
      if (!s) return send(res, { status: 401, body: { error: typeof b.idToken === 'string' ? 'The identity token was not accepted.' : 'Wrong username or password.' } });
      return send(res, { status: 200, body: { user: s.actor } }, { 'set-cookie': sessionCookie(s.token) });
    }
    if (path === '/auth/logout' && method === 'POST') { if (token) logout(token); return send(res, { status: 200, body: { ok: true } }, { 'set-cookie': clearCookie() }); }
    if (path === '/auth/me' && method === 'GET') return send(res, { status: 200, body: { user: actor } });
    if (path === '/auth/demo-switch' && method === 'POST') {
      if (!actor) return send(res, { status: 401, body: { error: 'Sign in first before switching demo roles.' } });
      const b = await readBody(req) as { role?: unknown };
      const switched = typeof b.role === 'string' ? switchDemoRole(b.role as Role) : null;
      if (!switched) return send(res, { status: 400, body: { error: 'Role must be analyst, reviewer, legal, or admin.' } });
      return send(res, { status: 200, body: { user: switched.actor } }, { 'set-cookie': sessionCookie(switched.token) });
    }
    if (path === '/rules/status' && method === 'GET') {
      if (!actor) return send(res, { status: 401, body: { error: 'Sign in to view self-improvement status.' } });
      return send(res, getRulesStatus());
    }
    if (path === '/rules/proposals/run' && method === 'POST') {
      if (!actor) return send(res, { status: 401, body: { error: 'Sign in to run the red-team improver.' } });
      const b = await readBody(req) as { mode?: string };
      return send(res, runImproverProposal(actor, b.mode === 'self' ? 'self' : 'mre-improver'));
    }
    if (path === '/rules/rollback' && method === 'POST') {
      if (!actor) return send(res, { status: 401, body: { error: 'Sign in to roll back rules.' } });
      return send(res, rollbackRulesLive(actor));
    }
    const rulesMatch = path.match(/^\/rules\/proposals\/([^/]+)\/(approve|promote)$/);
    if (rulesMatch && method === 'POST') {
      if (!actor) return send(res, { status: 401, body: { error: 'Sign in to approve or promote rule proposals.' } });
      const [, propId, propAction] = rulesMatch;
      return send(res, propAction === 'approve' ? approveRuleProposal(propId, actor) : promoteRuleProposal(propId, actor));
    }
    if (path === '/model' && method === 'GET') {
      if (!actor) return send(res, { status: 401, body: { error: 'Sign in to see the model sandbox.' } });
      const online = await modelOnline();
      return send(res, { status: 200, body: { online, configured: modelHostConfigured(), detail: online ? 'The model is answering.' : 'The model sandbox is not answering.' } });
    }
    if (path === '/model/start' && method === 'POST') {
      if (!actor) return send(res, { status: 401, body: { error: 'Sign in to start the model sandbox.' } });
      const started = await startModelSandbox();
      return send(res, { status: started.state === 'unconfigured' ? 503 : 200, body: { ...started, configured: modelHostConfigured() } });
    }
    if (path === '/model/stop' && method === 'POST') {
      if (!actor) return send(res, { status: 401, body: { error: 'Sign in to stop the model sandbox.' } });
      await stopModelSandbox();
      return send(res, { status: 200, body: { online: false, state: 'stopped', configured: modelHostConfigured(), detail: 'Model sandbox stopped.' } });
    }

    if (path.startsWith('/v1')) {
      const v1 = await v1FromNode(method, path, req, method === 'GET' ? {} : await readBody(req));
      if (v1) return send(res, v1);
    }

    if (path === '/investigations/bulk' && method === 'POST') {
      if (!actor) return send(res, { status: 401, body: { error: 'Sign in to use the investigation API.' } });
      const raw = await readBody(req);
      const list = Array.isArray(raw) ? raw : Array.isArray((raw as { datasets?: unknown[] })?.datasets) ? (raw as { datasets: unknown[] }).datasets : null;
      if (!list || !list.length) return send(res, { status: 400, body: { error: 'Send a non-empty array of merchant datasets.' } });
      if (list.length > 100) return send(res, { status: 400, body: { error: 'Bulk upload is capped at 100 merchants per request.' } });
      const results: Record<string, unknown>[] = [];
      const scenarios = [];
      for (const ds of list) {
        const opened = await openInvestigationWithStage2(ds, actor);
        const caseId = typeof opened.body.id === 'string' ? opened.body.id : '';
        if (opened.status === 200 && caseId) {
          const rec = getCase(caseId);
          if (rec) scenarios.push(rec.result.scenario);
        }
        results.push({ status: opened.status, ...opened.body });
      }
      const rings = detectRings(scenarios);
      return send(res, { status: 200, body: { count: results.length, rings, cases: results } });
    }

    const match = path.match(/^\/investigations(?:\/([^/]+)(?:\/(review|response|approve|label|trace|pack|summary|audit))?)?$/);
    if (!match) return send(res, { status: 404, body: { error: 'Unknown route.' } });
    if (!actor) return send(res, { status: 401, body: { error: 'Sign in to use the investigation API.' } });
    const [, id, action] = match;

    if (!id) {
      if (method === 'GET') { const caseId = url.searchParams.get('id'); return send(res, caseId ? getInvestigation(caseId) : listInvestigations()); }
      if (method !== 'POST') return send(res, { status: 405, body: { error: 'POST a dataset to open a case.' } });
      const opened = await openInvestigationWithStage2(await readBody(req), actor);
      return send(res, opened);
    }
    if (method === 'GET') {
      if (!action) return send(res, getInvestigation(id));
      if (action === 'trace') return send(res, await caseTrace(id));
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
