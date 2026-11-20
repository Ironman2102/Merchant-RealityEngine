/** OIDC id_token checks using node:crypto. Group names map to roles through workflow/roles.json. */
import { createPublicKey, createVerify } from 'node:crypto';

export interface OidcCheck {
  issuer: string;
  audience: string;
  nonce: string;
  now?: number;
  jwk: Record<string, unknown>;
  groupsToRoles: Record<string, string>;
}

function b64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function roleFromGroups(groups: string[], map: Record<string, string>): string | null {
  for (const g of groups) if (map[g]) return map[g];
  return null;
}

export function verifyIdToken(token: string, check: OidcCheck): { ok: true; role: string; sub: string } | { ok: false; error: string } {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, error: 'malformed' };
  const [h, p, s] = parts;
  const header = JSON.parse(b64url(h).toString('utf8')) as { alg?: string };
  if (header.alg !== 'RS256') return { ok: false, error: 'algorithm' };
  let ok = false;
  try { ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(createPublicKey({ key: check.jwk as never, format: 'jwk' }), b64url(s)); } catch { ok = false; }
  if (!ok) return { ok: false, error: 'signature' };
  const body = JSON.parse(b64url(p).toString('utf8')) as { iss?: string; aud?: string | string[]; exp?: number; nonce?: string; sub?: string; groups?: string[] };
  const now = check.now ?? Math.floor(Date.now() / 1000);
  if (body.iss !== check.issuer) return { ok: false, error: 'issuer' };
  const aud = Array.isArray(body.aud) ? body.aud : [body.aud];
  if (!aud.includes(check.audience)) return { ok: false, error: 'audience' };
  if (typeof body.exp !== 'number' || body.exp <= now) return { ok: false, error: 'expired' };
  if (body.nonce !== check.nonce) return { ok: false, error: 'nonce' };
  const role = roleFromGroups(body.groups ?? [], check.groupsToRoles);
  if (!role || !body.sub) return { ok: false, error: 'no-role' };
  return { ok: true, role, sub: body.sub };
}
