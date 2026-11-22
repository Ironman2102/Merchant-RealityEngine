/**
 * Local accounts. scrypt password hashes, random session tokens (only their SHA-256 is stored), HttpOnly SameSite=Strict
 * cookie. Roles: analyst < reviewer; legal and admin are separate powers (see workflow.ts for who may do what).
 * Upgrade path: the pilot PA's SSO (OIDC) replaces login(); sessions and roles stay.
 */
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { getDb } from './db';
import { verifyIdToken, type OidcCheck } from './oidc';

export type Role = 'analyst' | 'reviewer' | 'legal' | 'admin';
export const ROLES: Role[] = ['analyst', 'reviewer', 'legal', 'admin'];
export interface Actor { id: number; username: string; role: Role }

const SESSION_MS = 12 * 3600 * 1000;
const STATELESS_SESSION_MS = 30 * 60 * 1000;
export const COOKIE = 'mre_session';
const TOKEN_VERSION = 'v2';
const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');

/**
 * Sessions live in the database, so signing out revokes them. Only a serverless host, whose instances share no
 * database, sets MRE_STATELESS_SESSIONS=1 and gets short signed cookies for configured boot accounts.
 */
const stateless = () => envValue('MRE_STATELESS_SESSIONS') === '1';
const sessionSecret = () => {
  const secret = envValue('MRE_SESSION_SECRET') || envValue('MRE_HASH_KEY');
  return secret.length >= 16 ? secret : '';
};
const hmac = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('base64url');

/** The cookie names a boot account and carries a fingerprint of its current password and role. Changing either revokes it. */
function signActor(actor: Actor): string | null {
  const secret = sessionSecret();
  const boot = bootAccounts().find(u => u.username === actor.username);
  if (!stateless() || !secret || !boot) return null;
  const body = Buffer.from(JSON.stringify({
    username: boot.username, fp: hmac(secret, `${boot.username}:${boot.role}:${boot.password}`),
    exp: Date.now() + STATELESS_SESSION_MS, nonce: randomBytes(8).toString('hex'),
  })).toString('base64url');
  return `${TOKEN_VERSION}.${body}.${hmac(secret, body)}`;
}

function actorFromSigned(token: string): Actor | null {
  const secret = sessionSecret();
  if (!stateless() || !secret || !token.startsWith(`${TOKEN_VERSION}.`)) return null;
  const [, body, sig] = token.split('.');
  if (!body || !sig || !sameSecret(sig, hmac(secret, body))) return null;
  try {
    const claim = JSON.parse(Buffer.from(body, 'base64url').toString()) as { username?: string; fp?: string; exp?: number };
    if (!claim.exp || claim.exp < Date.now() || !claim.fp) return null;
    const boot = bootAccounts().find(u => u.username === claim.username);
    if (!boot || !sameSecret(claim.fp, hmac(secret, `${boot.username}:${boot.role}:${boot.password}`))) return null;
    if (getDb().prepare('SELECT 1 FROM revoked_tokens WHERE token_hash = ?').get(tokenHash(token))) return null;
    // Row ids differ between instances, so the identity is always resolved by username.
    return bootActor(boot);
  } catch { return null; }
}

function bootActor(boot: { username: string; password: string; role: Role }): Actor | null {
  const row = getDb().prepare('SELECT id, disabled FROM users WHERE username = ?').get(boot.username) as { id: number; disabled: number } | undefined;
  if (!row) return createUser(boot.username, boot.password, boot.role);
  return row.disabled ? null : { id: row.id, username: boot.username, role: boot.role };
}

/** Maker/checker compares people by id and by name, because ids are not stable across serverless instances. */
export const samePerson = (a: { id: number; username: string }, b: { id: number; username: string }) =>
  a.username.toLowerCase() === b.username.toLowerCase() || (a.id > 0 && a.id === b.id);

function envValue(name: string): string {
  const platform = (globalThis as { Netlify?: { env?: { get?: (key: string) => string | undefined } } }).Netlify?.env?.get?.(name);
  return platform || process.env[name] || '';
}

export function bootAccounts(): { username: string; password: string; role: Role }[] {
  const out: { username: string; password: string; role: Role }[] = [];
  const many = envValue('MRE_BOOT_USERS');
  for (const part of many.split(',')) {
    const [username, password, role] = part.split(':');
    if (!username || !password || password.length < 12 || !ROLES.includes(role as Role)) continue;
    out.push({ username, password, role: role as Role });
  }
  const password = envValue('MRE_BOOT_PASSWORD');
  const username = envValue('MRE_BOOT_USER') || 'admin';
  if (password.length >= 12 && !out.some(u => u.username === username)) out.push({ username, password, role: 'admin' });
  return out;
}

function sameSecret(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function issueSession(actor: Actor): string {
  const signed = signActor(actor);
  const token = signed ?? randomBytes(32).toString('base64url');
  getDb().prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), actor.id, Date.now() + SESSION_MS);
  return token;
}
const scrypt = (pw: string, salt: string) => scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');

export function createUser(username: string, password: string, role: Role): Actor {
  if (!/^[a-z0-9._-]{3,40}$/i.test(username)) throw Object.assign(new Error('Username: 3–40 letters, digits, dot, dash or underscore.'), { status: 400 });
  if (password.length < 12) throw Object.assign(new Error('Password must be at least 12 characters.'), { status: 400 });
  if (!ROLES.includes(role)) throw Object.assign(new Error('Unknown role.'), { status: 400 });
  const salt = randomBytes(16).toString('hex');
  const r = getDb().prepare('INSERT INTO users (username, role, pw_salt, pw_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(username, role, salt, scrypt(password, salt), new Date().toISOString());
  return { id: Number(r.lastInsertRowid), username, role };
}

/** Returns a session token, or null. Same work whether or not the user exists (no username probing by timing). */
export function login(username: string, password: string): { token: string; actor: Actor } | null {
  const name = username.trim();
  const pw = password.trim();
  const boot = bootAccounts().find(u => u.username === name);
  if (boot) {
    if (!sameSecret(pw, boot.password)) return null;
    const actor = bootActor(boot);
    return actor ? { token: issueSession(actor), actor } : null;
  }
  const row = getDb().prepare('SELECT id, username, role, pw_salt, pw_hash, disabled FROM users WHERE username = ?').get(name) as
    { id: number; username: string; role: Role; pw_salt: string; pw_hash: string; disabled: number } | undefined;
  const got = Buffer.from(scrypt(pw, row?.pw_salt ?? 'no-such-user-salt'), 'hex');
  const want = Buffer.from(row?.pw_hash ?? '00'.repeat(64), 'hex');
  if (!row || row.disabled || !timingSafeEqual(got, want)) return null;
  const actor = { id: row.id, username: row.username, role: row.role };
  return { token: issueSession(actor), actor };
}

function usernameFromSub(sub: string): string {
  const cleaned = sub.replace(/[^a-z0-9._-]/gi, '').slice(0, 40);
  return cleaned.length >= 3 ? cleaned : `oidc-${createHash('sha256').update(sub).digest('hex').slice(0, 12)}`;
}

/** Opens a session for a verified ID token. The role is the group map, not a password. */
export function loginWithIdToken(idToken: string, check: OidcCheck): { token: string; actor: Actor } | null {
  const verified = verifyIdToken(idToken, check);
  if (!verified.ok || !ROLES.includes(verified.role as Role)) return null;
  const role = verified.role as Role;
  const username = usernameFromSub(verified.sub);
  const existing = getDb().prepare('SELECT id, disabled FROM users WHERE username = ?').get(username) as { id: number; disabled: number } | undefined;
  let id: number;
  if (!existing) {
    const salt = randomBytes(16).toString('hex');
    const made = getDb().prepare('INSERT INTO users (username, role, pw_salt, pw_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(username, role, salt, scrypt(randomBytes(24).toString('base64url'), salt), new Date().toISOString());
    id = Number(made.lastInsertRowid);
  } else if (existing.disabled) return null;
  else {
    id = existing.id;
    getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }
  const actor = { id, username, role };
  return { token: issueSession(actor), actor };
}

export function logout(token: string): void {
  const hash = tokenHash(token);
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
  getDb().prepare('INSERT OR IGNORE INTO revoked_tokens (token_hash, at) VALUES (?, ?)').run(hash, Date.now());
}

export function actorFromToken(token: string | undefined): Actor | null {
  if (!token) return null;
  if (token.startsWith(`${TOKEN_VERSION}.`)) return actorFromSigned(token);
  const row = getDb().prepare('SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0')
    .get(tokenHash(token), Date.now()) as Actor | undefined;
  return row ?? null;
}

export function readCookie(req: IncomingMessage, name = COOKIE): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) { try { return decodeURIComponent(v.join('=')); } catch { return undefined; } } }
  return undefined;
}

export const sessionCookie = (token: string) => `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${process.env.NODE_ENV === 'production' || stateless() ? '; Secure' : ''}`;
export const clearCookie = () => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
export const userCount = () => (getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
