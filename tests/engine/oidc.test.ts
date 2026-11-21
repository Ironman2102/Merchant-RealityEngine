/** A test identity provider: a valid group maps to a role; a bad signature, audience or expiry does not. */
import { createServer } from 'node:http';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { verifyIdToken } from '../../backend/src/oidc';
import { handle } from '../../backend/src/http';
import { getDb, resetDb } from '../../backend/src/db';

function token(privateKey: KeyObject, body: Record<string, unknown>, opts?: { tamper?: boolean }): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const flipped = alphabet[(alphabet.indexOf(sig[0]) + 1) % alphabet.length] + sig.slice(1);
  return `${h}.${p}.${opts?.tamper ? flipped : sig}`;
}

export default async function (): Promise<number> {
  let bad = 0;
  const check = (name: string, ok: boolean) => { if (!ok) { bad++; console.log(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`); };
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = key.publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  const now = 1_700_000_000;
  const base = { iss: 'https://idp.example', aud: 'mre', exp: now + 60, nonce: 'n1', sub: 'user-1', groups: ['risk-reviewers'] };
  const checkIn = { issuer: 'https://idp.example', audience: 'mre', nonce: 'n1', now, jwk, groupsToRoles: { 'risk-reviewers': 'reviewer' } };
  const good = verifyIdToken(token(key.privateKey, base), checkIn);
  check('group maps to reviewer', good.ok && good.role === 'reviewer');
  check('bad signature', verifyIdToken(token(key.privateKey, base, { tamper: true }), checkIn).ok === false);
  check('wrong audience', verifyIdToken(token(key.privateKey, { ...base, aud: 'other' }), checkIn).ok === false);
  check('expired', verifyIdToken(token(key.privateKey, { ...base, exp: now - 10 }), checkIn).ok === false);

  const prev = {
    store: process.env.MRE_CASE_STORE, issuer: process.env.MRE_OIDC_ISSUER, audience: process.env.MRE_OIDC_AUDIENCE,
    nonce: process.env.MRE_OIDC_NONCE, jwk: process.env.MRE_OIDC_JWK, groups: process.env.MRE_OIDC_GROUPS,
  };
  process.env.MRE_CASE_STORE = 'memory';
  process.env.MRE_OIDC_ISSUER = 'https://idp.example';
  process.env.MRE_OIDC_AUDIENCE = 'mre';
  process.env.MRE_OIDC_NONCE = 'n1';
  process.env.MRE_OIDC_JWK = JSON.stringify(jwk);
  process.env.MRE_OIDC_GROUPS = JSON.stringify({ 'risk-reviewers': 'reviewer' });
  resetDb();
  const server = createServer((req, res) => { void handle(req, res); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  const wall = Math.floor(Date.now() / 1000);
  const live = { ...base, exp: wall + 60 };
  try {
    const signed = await fetch(`http://127.0.0.1:${port}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: token(key.privateKey, live) }) });
    const body = await signed.json() as { user?: { role?: string } };
    const setCookie = signed.headers.getSetCookie().find(c => c.startsWith('mre_session=')) ?? '';
    const me = await fetch(`http://127.0.0.1:${port}/auth/me`, { headers: { cookie: setCookie.split(';')[0] } });
    const who = await me.json() as { user?: { role?: string } | null };
    check('id token signs in as reviewer', signed.status === 200 && body.user?.role === 'reviewer' && who.user?.role === 'reviewer');
    const sessions = () => (getDb().prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
    const afterGood = sessions();
    for (const [name, claims, tamper] of [
      ['bad signature', live, true],
      ['wrong audience', { ...live, aud: 'other' }, false],
      ['expired', { ...live, exp: wall - 10 }, false],
    ] as const) {
      const denied = await fetch(`http://127.0.0.1:${port}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: token(key.privateKey, claims, { tamper }) }) });
      check(`${name} does not sign in`, denied.status === 401 && sessions() === afterGood);
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const [k, v] of Object.entries({ MRE_CASE_STORE: prev.store, MRE_OIDC_ISSUER: prev.issuer, MRE_OIDC_AUDIENCE: prev.audience, MRE_OIDC_NONCE: prev.nonce, MRE_OIDC_JWK: prev.jwk, MRE_OIDC_GROUPS: prev.groups })) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    resetDb();
  }
  return bad;
}
