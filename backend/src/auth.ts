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
export const COOKIE = 'mre_session';
const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');
const sessionSecret = () => process.env.MRE_SESSION_SECRET || process.env.MRE_HASH_KEY || '';

/** A signed cookie still names the user after the function's temporary database is gone. */
function signActor(actor: Actor): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const body = Buffer.from(JSON.stringify({ id: actor.id, username: actor.username, role: actor.role, exp: Date.now() + SESSION_MS })).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `v1.${body}.${sig}`;
}

function actorFromSigned(token: string): Actor | null {
  const secret = sessionSecret();
  if (!secret || !token.startsWith('v1.')) return null;
  const [, body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as { id?: number; username?: string; role?: Role; exp?: number };
    if (!payload.exp || payload.exp < Date.now() || typeof payload.id !== 'number' || !payload.username || !payload.role || !ROLES.includes(payload.role)) return null;
    return { id: payload.id, username: payload.username, role: payload.role };
  } catch { return null; }
}

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
    const existing = getDb().prepare('SELECT id, username, role, disabled FROM users WHERE username = ?').get(name) as { id: number; username: string; role: Role; disabled: number } | undefined;
    if (existing?.disabled) return null;
    const actor = existing ? { id: existing.id, username: existing.username, role: existing.role } : createUser(boot.username, boot.password, boot.role);
    return { token: issueSession(actor), actor };
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

export function logout(token: string): void { getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token)); }

export function actorFromToken(token: string | undefined): Actor | null {
  if (!token) return null;
  const signed = actorFromSigned(token);
  if (signed) return signed;
  const row = getDb().prepare('SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0')
    .get(tokenHash(token), Date.now()) as Actor | undefined;
  return row ?? null;
}

export function readCookie(req: IncomingMessage, name = COOKIE): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return decodeURIComponent(v.join('=')); }
  return undefined;
}

export const sessionCookie = (token: string) => `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
export const clearCookie = () => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
export const userCount = () => (getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
