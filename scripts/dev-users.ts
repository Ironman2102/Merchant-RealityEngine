/** Local development only: one account per demo persona, each with a random password saved to
 * backend/data/dev-users.txt (0600, git-ignored). Nothing in the source can be used to sign in. */
import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createUser, type Actor, type Role } from '../backend/src/auth';
import { getDb } from '../backend/src/db';

export const DEV_USERS_FILE = 'backend/data/dev-users.txt';
const PEOPLE: [string, Role][] = [['dev-analyst', 'analyst'], ['dev-reviewer', 'reviewer'], ['dev-legal', 'legal'], ['dev-admin', 'admin']];

export function ensureDevUsers(): Actor {
  if (process.env.NODE_ENV === 'production') throw new Error('dev-users is for local development only.');
  mkdirSync('backend/data', { recursive: true });
  const find = getDb().prepare('SELECT id, username, role FROM users WHERE username = ?');
  const missing = PEOPLE.filter(([name]) => !find.get(name));
  if (missing.length) {
    if (!existsSync(DEV_USERS_FILE)) writeFileSync(DEV_USERS_FILE, '# Local test accounts (development only): username, role, password\n', { mode: 0o600 });
    for (const [name, role] of missing) {
      const password = randomBytes(15).toString('base64url');
      createUser(name, password, role);
      appendFileSync(DEV_USERS_FILE, `${name}\t${role}\t${password}\n`);
    }
    chmodSync(DEV_USERS_FILE, 0o600);
  }
  return find.get('dev-analyst') as unknown as Actor;
}

if (process.argv[1]?.endsWith('dev-users.ts')) {
  ensureDevUsers();
  console.log(`Local test accounts are ready; credentials are in ${DEV_USERS_FILE}.`);
}
