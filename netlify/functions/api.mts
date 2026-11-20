import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createUser, type Role } from '../../backend/src/auth.ts';
import { getDb } from '../../backend/src/db.ts';
import { handle } from '../../backend/src/http.ts';

if (!process.env.MRE_DB_FILE) process.env.MRE_DB_FILE = '/tmp/mre.db';

function boot(name: string): string | undefined {
  const fromPlatform = typeof Netlify !== 'undefined' ? Netlify.env.get(name) : undefined;
  return fromPlatform || process.env[name];
}

let seeded = false;
function bootUsers(): { username: string; password: string; role: Role }[] {
  const out: { username: string; password: string; role: Role }[] = [];
  const many = boot('MRE_BOOT_USERS');
  if (many) {
    for (const part of many.split(',')) {
      const [username, password, role] = part.split(':');
      if (!username || !password || password.length < 12) continue;
      if (role !== 'admin' && role !== 'reviewer' && role !== 'legal' && role !== 'analyst') continue;
      out.push({ username, password, role });
    }
  }
  const password = boot('MRE_BOOT_PASSWORD');
  const username = boot('MRE_BOOT_USER') || 'admin';
  if (password && password.length >= 12 && !out.some(u => u.username === username)) out.push({ username, password, role: 'admin' });
  return out;
}

/** Every function instance gets the same accounts. A temporary database does not share rows. */
function ensureAdmin(): void {
  if (seeded) return;
  seeded = true;
  const db = getDb();
  for (const u of bootUsers()) {
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
  ensureAdmin();
  const ip = req.headers.get('x-nf-client-connection-ip') || 'netlify';
  const body = Buffer.from(await req.arrayBuffer());
  const { res, finish } = nodeRes();
  await handle(nodeReq(req, ip, body), res);
  const out = finish();
  return new Response(out.body, { status: out.status, headers: out.headers });
};

export const config = { path: ['/api', '/api/*'], timeout: 60 };
