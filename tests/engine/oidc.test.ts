/** A test identity provider: a valid group maps to a role; a bad signature, audience or expiry does not. */
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { verifyIdToken } from '../../backend/src/oidc';

function token(privateKey: KeyObject, body: Record<string, unknown>, opts?: { tamper?: boolean }): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url');
  return `${h}.${p}.${opts?.tamper ? sig.slice(0, -2) + 'aa' : sig}`;
}

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean) => { if (!ok) { bad++; console.log(`  ✗ ${name}`); } };
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = key.publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  const now = 1_700_000_000;
  const base = { iss: 'https://idp.example', aud: 'mre', exp: now + 60, nonce: 'n1', sub: 'user-1', groups: ['risk-reviewers'] };
  const checkIn = { issuer: 'https://idp.example', audience: 'mre', nonce: 'n1', now, jwk, groupsToRoles: { 'risk-reviewers': 'reviewer' } };
  const good = verifyIdToken(token(key.privateKey, base), checkIn);
  check('group maps to reviewer', good.ok && good.ok && good.role === 'reviewer');
  check('bad signature', verifyIdToken(token(key.privateKey, base, { tamper: true }), checkIn).ok === false);
  check('wrong audience', verifyIdToken(token(key.privateKey, { ...base, aud: 'other' }), checkIn).ok === false);
  check('expired', verifyIdToken(token(key.privateKey, { ...base, exp: now - 10 }), checkIn).ok === false);
  return bad;
}
