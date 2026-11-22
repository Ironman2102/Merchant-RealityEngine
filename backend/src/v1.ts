/** Versioned API. Service keys, not browser sessions. /v1/score does not create a case. */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { loadHashKey } from '../../adapters/pseudonym';
import { runBatch } from '../../cli/batch';
import { analyzeDataset } from './algorithms/analyze';
import type { ApiReply } from './workflow';
import { openInvestigation } from './workflow';
import { caseTrace, evidencePack } from './trace';
import { getInvestigation } from './workflow';
import { authenticateServiceKey, idempotent, type Scope, type ServicePrincipal } from './serviceKeys';
import type { Actor } from './auth';
import { mlScore } from './ml';
import { getCase } from './store';

export interface V1Req { method: string; path: string; header: (name: string) => string | undefined; body: unknown }

interface BatchState { client: string; status: 'queued' | 'running' | 'done' | 'error'; result?: unknown; error?: string }
const batches = new Map<string, BatchState>();
let batchLock: Promise<void> = Promise.resolve();

/** One client's idempotency key must never replay another client's response. */
const scopedKey = (p: ServicePrincipal, key: string | undefined) => (key ? `${p.id}:${key}` : undefined);
/** Batch callers pick a shipped mapping by name; they never supply a path to read. */
const MAPPINGS = ['generic-pa-v1', 'alt-pa-example'];

async function scoreOf(raw: unknown, client: string): Promise<ApiReply> {
  const ran = analyzeDataset(raw, client);
  if (!ran.ok) return { status: 400, body: { error: ran.errors.join(' ') } };
  const f = ran.result.fusion;
  const top = [...f.mechanisms].sort((a, b) => b.score - a.score)[0];
  const topEvidence = ran.result.evidence.filter(e => e.status === 'ILLICIT').sort((a, b) => b.llr - a.llr).slice(0, 8)
    .map(e => ({ id: e.id, name: e.name, observed: e.observed, llr: e.llr }));
  const ml = mlScore(ran.result);
  return {
    status: 200,
    body: {
      decision: f.decision, posterior: f.posterior, ci: f.posteriorCi, prior: f.prior,
      recommended: ran.result.review.recommended, mechanism: top?.id ?? null, topEvidence,
      rulesVersion: f.rulesVersion,
      ml: { p: ml.p, threshold: ml.threshold, drivers: ml.drivers, modelVersion: ml.modelVersion, synthetic: true },
      followUp: f.followUp, passportAnswered: ran.result.passportAnswered ?? [], scope: ran.result.scope, streams: ran.result.streams, suspectLinks: ran.result.suspectLinks,
    },
  };
}

function allow(p: ServicePrincipal, scope: Scope): ApiReply | null {
  return p.scopes.includes(scope) ? null : { status: 403, body: { error: `This key does not have the ${scope} scope.` } };
}

/**
 * A client is a key name, which only the operator sets, so a replacement key of the same name keeps access.
 * Anything else answers 404: a client cannot learn that another client's case or batch exists.
 */
const ownsCase = (p: ServicePrincipal, id: string) => getCase(id)?.client === p.name;

/** A client's view of its case never names another case: other case ids are replaced wherever they appear. */
function ownIdsOnly(reply: ApiReply, id: string): ApiReply {
  if (reply.status !== 200) return reply;
  let redacted = false;
  const text = JSON.stringify(reply.body).replace(/INV-[0-9a-f]{8}/g, found => (found === id ? found : ((redacted = true), 'another case')));
  // The server checked the chain on the full text. A client cannot recompute it over redacted entries.
  return redacted ? { status: 200, body: { ...JSON.parse(text), redacted: 'References to other cases were removed, so audit hashes do not recompute from this copy.' } } : reply;
}

function serviceActor(p: ServicePrincipal): Actor {
  return { id: 0, username: `key:${p.name}`, role: 'analyst' };
}

export async function handleV1(req: V1Req): Promise<ApiReply | null> {
  if (!req.path.startsWith('/v1')) return null;
  if (req.path === '/v1/health' && req.method === 'GET') return { status: 200, body: { status: 'ok', service: 'merchant-reality-engine-v1' } };
  const principal = authenticateServiceKey(req.header('authorization'));
  if (!principal) return { status: 401, body: { error: 'Send Authorization: Bearer <service key>.' } };

  if (req.path === '/v1/score' && req.method === 'POST') {
    const denied = allow(principal, 'score'); if (denied) return denied;
    return await scoreOf(req.body, principal.name);
  }

  const caseMatch = req.path.match(/^\/v1\/cases(?:\/([^/]+)(?:\/(trace|pack))?)?$/);
  if (caseMatch && req.method === 'POST' && !caseMatch[1]) {
    const denied = allow(principal, 'cases'); if (denied) return denied;
    const score = await scoreOf(req.body, principal.name);
    if (score.status !== 200) return score;
    const raw = JSON.stringify(req.body);
    const idem = scopedKey(principal, req.header('idempotency-key'));
    return idempotent(idem, createHash('sha256').update(raw).digest('hex'), () => {
      const opened = openInvestigation(req.body, serviceActor(principal), principal.name);
      if (opened.status !== 200) return opened;
      const id = (opened.body as { id?: string }).id;
      return { status: 200, body: { id, ...score.body } };
    });
  }
  if (caseMatch && req.method === 'GET' && caseMatch[1]) {
    if (!principal.scopes.includes('read') && !principal.scopes.includes('cases')) return { status: 403, body: { error: 'This key cannot read cases.' } };
    const id = caseMatch[1];
    if (!ownsCase(principal, id)) return { status: 404, body: { error: 'No case with that id.' } };
    if (caseMatch[2] === 'trace') return ownIdsOnly(await caseTrace(id), id);
    if (caseMatch[2] === 'pack') return ownIdsOnly(evidencePack(id, serviceActor(principal), false), id);
    return ownIdsOnly(getInvestigation(id, false), id);
  }

  if (req.path === '/v1/batches' && req.method === 'POST') {
    const denied = allow(principal, 'batch'); if (denied) return denied;
    const body = (req.body ?? {}) as { files?: Record<string, string>; mapping?: string };
    const idem = scopedKey(principal, req.header('idempotency-key'));
    return idempotent(idem, createHash('sha256').update(JSON.stringify(body)).digest('hex'), () => {
      const id = `bat_${randomBytes(6).toString('hex')}`;
      batches.set(id, { client: principal.name, status: 'queued' });
      const run = async () => {
        const state = batches.get(id)!;
        state.status = 'running';
        const dir = join(tmpdir(), id);
        try {
          if (!body.mapping || !body.files) throw new Error('Body needs mapping and files.');
          mkdirSync(dir, { recursive: true });
          for (const [name, b64] of Object.entries(body.files)) {
            if (name !== basename(name) || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) throw new Error('Batch file name must be a single basename.');
            writeFileSync(join(dir, name), Buffer.from(b64, 'base64'));
          }
          const name = String(body.mapping).replace(/^adapters\/mappings\//, '').replace(/\.json$/, '');
          if (!MAPPINGS.includes(name)) throw new Error(`mapping must be one of ${MAPPINGS.join(', ')}.`);
          const out = join(dir, 'out');
          const ran = runBatch({ inDir: dir, mappingPath: `adapters/mappings/${name}.json`, outDir: out, key: loadHashKey(), client: principal.name });
          state.result = { ...ran, scoresCsv: readFileSync(join(out, 'scores.csv'), 'utf8') };
          state.status = 'done';
        } catch (e) {
          state.status = 'error';
          state.error = e instanceof Error ? e.message : 'Batch failed.';
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      };
      const start = batchLock.then(run, run);
      batchLock = start.then(() => undefined, () => undefined);
      return { status: 202, body: { batchId: id } };
    });
  }
  const batchGet = req.path.match(/^\/v1\/batches\/([^/]+)$/);
  if (batchGet && req.method === 'GET') {
    if (!principal.scopes.includes('read') && !principal.scopes.includes('batch')) return { status: 403, body: { error: 'This key cannot read batches.' } };
    const state = batches.get(batchGet[1]);
    if (!state || state.client !== principal.name) return { status: 404, body: { error: 'No batch with that id.' } };
    return { status: 200, body: { batchId: batchGet[1], status: state.status, ...(state.error ? { error: state.error } : {}), ...(state.result ? { result: state.result } : {}) } };
  }
  return { status: 404, body: { error: 'Unknown /v1 route.' } };
}

export function v1FromNode(method: string, path: string, req: IncomingMessage, body: unknown): Promise<ApiReply | null> {
  return handleV1({ method, path, body, header: n => { const v = req.headers[n.toLowerCase()]; return Array.isArray(v) ? v[0] : v; } });
}
