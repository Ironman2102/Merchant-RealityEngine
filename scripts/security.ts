/** Security + governance probes against the real HTTP handler. Every probe must print "blocked". Run: npm run security */
import { createServer } from 'node:http';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
process.env.MRE_CASE_STORE = 'memory';
const { handle } = await import('../backend/src/http');
const { createUser } = await import('../backend/src/auth');
const { getDb } = await import('../backend/src/db');

const ds = readFileSync('frontend/public/samples/01-sweet-crumbs-betting-front.json', 'utf8');
const pw = 'security-probe-password-1';
createUser('ana', pw, 'analyst'); createUser('rev', pw, 'reviewer');
const srv = createServer((q, s) => void handle(q, s)).listen(0, '127.0.0.1');
await new Promise(r => srv.once('listening', r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api`;
const call = (path: string, opts: { method?: string; body?: string; cookie?: string; type?: string } = {}) =>
  fetch(base + path, { method: opts.method ?? 'GET', body: opts.body, headers: { ...(opts.body !== undefined ? { 'content-type': opts.type ?? 'application/json' } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}) } });
const signIn = async (u: string) => { const r = await call('/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: pw }) }); return (r.headers.get('set-cookie') ?? '').split(';')[0]; };

const results: [string, boolean][] = [];
const probe = (name: string, blocked: boolean) => results.push([name, blocked]);

probe('anonymous cannot list cases', (await call('/investigations')).status === 401);
probe('anonymous cannot open a case', (await call('/investigations', { method: 'POST', body: ds })).status === 401);
probe('wrong password rejected', (await call('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'ana', password: 'nope-nope-nope' }) })).status === 401);
const ana = await signIn('ana'), rev = await signIn('rev');
probe('CSRF: non-JSON POST refused', (await call('/investigations', { method: 'POST', body: ds, cookie: ana, type: 'text/plain' })).status === 415);

const target = join(process.cwd(), 'audit', 'PWNED.json'); rmSync(target, { force: true });
const w = await call('/investigations/..%2F..%2F..%2Faudit%2FPWNED/review', { method: 'POST', body: '{"notes":"x"}', cookie: ana });
probe('path traversal via case id', w.status >= 400 && !existsSync(target));
probe('path traversal via ?id=', (await call('/investigations?id=../../../package', { cookie: ana })).status === 400);

const opened = await (await call('/investigations', { method: 'POST', body: ds, cookie: ana })).json() as { id: string };
probe('server mints case ids', /^INV-[0-9a-f]{8}$/.test(opened.id));
await call(`/investigations/${opened.id}/review`, { method: 'POST', body: JSON.stringify({ notes: 'n', user: { label: 'CONFIRMED_ILLICIT', legalVerified: true } }), cookie: ana });
const after = await (await call(`/investigations/${opened.id}`, { cookie: ana })).json() as { user: { label: string | null; legalVerified: boolean } };
probe('client-supplied user state ignored', after.user.label === null && after.user.legalVerified === false);

await call(`/investigations/${opened.id}/response`, { method: 'POST', body: JSON.stringify({ chosenLevel: 'L3' }), cookie: ana });
probe('maker cannot approve own L3', (await call(`/investigations/${opened.id}/approve`, { method: 'POST', body: '{"approve":true}', cookie: ana })).status === 403);
await call(`/investigations/${opened.id}/response`, { method: 'POST', body: JSON.stringify({ chosenLevel: 'L5', legalVerified: true }), cookie: ana });
probe('L5 not approvable without legal role', (await call(`/investigations/${opened.id}/approve`, { method: 'POST', body: '{"approve":true}', cookie: rev })).status === 403);
await call(`/investigations/${opened.id}/label`, { method: 'POST', body: '{"label":"CONFIRMED_ILLICIT"}', cookie: ana });
probe('one person cannot confirm illicit alone', (await call(`/investigations/${opened.id}/label`, { method: 'POST', body: '{"label":"CONFIRMED_ILLICIT"}', cookie: ana })).status === 403);

const stored = (getDb().prepare('SELECT record_json FROM cases WHERE id = ?').get(opened.id) as { record_json: string }).record_json;
probe('raw payer identifiers not stored', !stored.includes('cust001@upi') && !stored.includes('"dataset"'));
getDb().prepare("UPDATE audit SET actor = 'someone-else' WHERE case_id = ? AND seq = 1").run(opened.id);
probe('audit tampering detected', ((await (await call(`/investigations/${opened.id}/audit`, { cookie: ana })).json()) as { ok: boolean }).ok === false);
probe('unknown case not created on update', (await call('/investigations/INV-00000000/review', { method: 'POST', body: '{}', cookie: ana })).status === 404);

srv.close();
let failed = 0;
for (const [name, ok] of results) { console.log(`${ok ? 'blocked' : 'OPEN   '}  ${name}`); if (!ok) failed++; }
console.log(`\n${results.length - failed}/${results.length} probes blocked`);
process.exit(failed ? 1 : 0);
