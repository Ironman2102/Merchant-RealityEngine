/** Service-to-service keys. Only the SHA-256 of the secret is stored. The secret is shown once. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getDb } from './db';
import { rowTrusted, rowValid, sealedWrite } from './integrity';

export const SCOPES = ['score', 'cases', 'batch', 'read'] as const;
export type Scope = (typeof SCOPES)[number];

export interface ServicePrincipal { id: string; name: string; scopes: Scope[] }

const hash = (key: string) => createHash('sha256').update(key).digest('hex');

export function createServiceKey(name: string, scopes: string[]): { id: string; key: string; scopes: Scope[] } {
  const clean = [...new Set(scopes)] as Scope[];
  if (!name.trim() || clean.length === 0 || clean.some(s => !SCOPES.includes(s))) throw new Error(`Scopes must be among ${SCOPES.join(', ')}.`);
  const id = `sk_${randomBytes(8).toString('hex')}`;
  const key = `mre_${randomBytes(32).toString('base64url')}`;
  sealedWrite('service_keys', id, () => getDb().prepare('INSERT INTO service_keys (id, name, key_hash, scopes, created_at, revoked) VALUES (?, ?, ?, ?, ?, 0)')
    .run(id, name.trim(), hash(key), clean.join(','), new Date().toISOString()));
  return { id, key, scopes: clean };
}

export function revokeServiceKey(id: string): void {
  sealedWrite('service_keys', id, () => getDb().prepare('UPDATE service_keys SET revoked = 1 WHERE id = ?').run(id));
}

export function authenticateServiceKey(header: string | undefined): ServicePrincipal | null {
  const m = /^Bearer\s+(\S+)$/.exec(header ?? '');
  if (!m) return null;
  const row = getDb().prepare('SELECT id, name, key_hash, scopes, revoked FROM service_keys WHERE key_hash = ?').get(hash(m[1])) as
    { id: string; name: string; key_hash: string; scopes: string; revoked: number } | undefined;
  if (!row) return null;
  const a = Buffer.from(row.key_hash, 'hex'), b = Buffer.from(hash(m[1]), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b) || row.revoked || !rowTrusted('service_keys', row.id)) return null;
  return { id: row.id, name: row.name, scopes: row.scopes.split(',').filter(Boolean) as Scope[] };
}

const DAY = 24 * 3600 * 1000;

export function idempotent(key: string | undefined, bodyHash: string, make: () => { status: number; body: Record<string, unknown> }): { status: number; body: Record<string, unknown>; replay?: boolean } {
  if (!key) return make();
  const row = getDb().prepare('SELECT body_sha256, response_json, created_at FROM idempotency WHERE key = ?').get(key) as
    { body_sha256: string; response_json: string; created_at: string } | undefined;
  if (row && !rowValid('idempotency', key)) return { status: 409, body: { error: 'The saved response for this Idempotency-Key failed its tamper check.' } };
  if (row && Date.now() - Date.parse(row.created_at) < DAY) {
    if (row.body_sha256 !== bodyHash) return { status: 409, body: { error: 'Idempotency-Key was already used with a different body.' } };
    return { ...JSON.parse(row.response_json), replay: true };
  }
  const reply = make();
  sealedWrite('idempotency', key, () => getDb().prepare('INSERT INTO idempotency (key, body_sha256, response_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET body_sha256 = excluded.body_sha256, response_json = excluded.response_json, created_at = excluded.created_at')
    .run(key, bodyHash, JSON.stringify({ status: reply.status, body: reply.body }), new Date().toISOString()));
  return reply;
}
