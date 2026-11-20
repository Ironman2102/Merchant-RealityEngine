/**
 * Local accounts. scrypt password hashes, random session tokens (only their SHA-256 is stored), HttpOnly SameSite=Strict
 * cookie. Roles: analyst < reviewer; legal and admin are separate powers (see workflow.ts for who may do what).
 * Upgrade path: the pilot PA's SSO (OIDC) replaces login(); sessions and roles stay.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { getDb } from './db';
import { verifyIdToken, type OidcCheck } from './oidc';

export type Role = 'analyst' | 'reviewer' | 'legal' | 'admin';
export const ROLES: Role[] = ['analyst', 'reviewer', 'legal', 'admin'];
export interface Actor { id: number; username: string; role: Role }

const SESSION_MS = 12 * 3600 * 1000;
export const COOKIE = 'mre_session';
const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');
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
  const row = getDb().prepare('SELECT id, username, role, pw_salt, pw_hash, disabled FROM users WHERE username = ?').get(username) as
    { id: number; username: string; role: Role; pw_salt: string; pw_hash: string; disabled: number } | undefined;
  const got = Buffer.from(scrypt(password, row?.pw_salt ?? 'no-such-user-salt'), 'hex');
  const want = Buffer.from(row?.pw_hash ?? '00'.repeat(64), 'hex');
  if (!row || row.disabled || !timingSafeEqual(got, want)) return null;
  const token = randomBytes(32).toString('base64url');
  getDb().prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), row.id, Date.now() + SESSION_MS);
  return { token, actor: { id: row.id, username: row.username, role: row.role } };
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
  const token = randomBytes(32).toString('base64url');
  getDb().prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), id, Date.now() + SESSION_MS);
  return { token, actor: { id, username, role } };
}

export function logout(token: string): void { getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token)); }

export function actorFromToken(token: string | undefined): Actor | null {
  if (!token) return null;
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
