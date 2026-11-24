import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { assertSecrets, bootAccounts, createUser } from '../../backend/src/auth.ts';
import { getDb } from '../../backend/src/db.ts';
import { handle } from '../../backend/src/http.ts';

if (!process.env.MRE_DB_FILE) process.env.MRE_DB_FILE = '/tmp/mre.db';
// Instances share no database, so this host needs short signed sessions (see backend/src/auth.ts).
process.env.MRE_STATELESS_SESSIONS = '1';

function publishEnv(): void {
  for (const name of ['MRE_BOOT_USERS', 'MRE_BOOT_USER', 'MRE_BOOT_PASSWORD', 'MRE_HASH_KEY', 'MRE_SESSION_SECRET', 'MRE_ML_URL', 'MRE_ML_TIMEOUT', 'DAYTONA_API_KEY', 'DAYTONA_API_URL', 'DAYTONA_SANDBOX_ID', 'DAYTONA_ORGANIZATION_ID']) {
    const value = boot(name);
    if (value) process.env[name] = value;
  }
}

function boot(name: string): string | undefined {
  const fromPlatform = typeof Netlify !== 'undefined' ? Netlify.env.get(name) : undefined;
  return fromPlatform || process.env[name];
}

let seeded = false;
/** Every function instance gets the same accounts. A temporary database does not share rows. */
function ensureAdmin(): void {
  if (seeded) return;
  assertSecrets();
  seeded = true;
  const db = getDb();
  for (const u of bootAccounts()) {
    const row = db.prepare('SELECT id FROM users WHERE username = ?').get(u.username);
    if (!row) createUser(u.username, u.password, u.role);
  }
}

function nodeReq(req: Request, ip: string, body: Buffer): IncomingMessage {
  const url = new URL(req.url);
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
  const stream = Readable.from(body);
  return Object.assign(stream, {
    method: req.method,
    url: url.pathname + url.search,
    headers,
    socket: { remoteAddress: ip || 'netlify' },
  }) as unknown as IncomingMessage;
}

function nodeRes(): { res: ServerResponse; finish: () => { status: number; headers: Record<string, string>; body: Buffer } } {
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  const res = {
    statusCode: 200,
    setHeader(key: string, value: string | number) { headers[key.toLowerCase()] = String(value); },
    end(payload?: string | Buffer) {
      if (payload) chunks.push(Buffer.isBuffer(payload) ? payload : Buffer.from(payload));
    },
  };
  return {
    res: res as unknown as ServerResponse,
    finish: () => ({ status: res.statusCode, headers, body: Buffer.concat(chunks) }),
  };
}

export default async (req: Request) => {
  publishEnv();
  ensureAdmin();
  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'netlify';
  const body = Buffer.from(await req.arrayBuffer());
  const { res, finish } = nodeRes();
  await handle(nodeReq(req, ip, body), res);
  const out = finish();
  return new Response(out.body, { status: out.status, headers: out.headers });
};

export const config = { path: ['/api', '/api/*'], timeout: 60 };
