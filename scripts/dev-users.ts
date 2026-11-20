/** Development only: create test users (analyst, reviewer, legal) with random passwords saved to
 * backend/data/dev-users.txt (0600, git-ignored). Refuses to run with NODE_ENV=production. */
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { createUser, userCount, type Role } from '../backend/src/auth';
if (process.env.NODE_ENV === 'production') { console.error('dev-users is for local development only.'); process.exit(1); }
const file = 'backend/data/dev-users.txt';
if (existsSync(file) || userCount() > 0) { console.log(`Users already exist; see ${file}.`); process.exit(0); }
const rows = (['analyst', 'reviewer', 'legal'] as Role[]).map(role => { const u = `dev-${role}`, p = randomBytes(15).toString('base64url'); createUser(u, p, role); return `${u}\t${role}\t${p}`; });
writeFileSync(file, `# Local test accounts (development only)\n${rows.join('\n')}\n`, { mode: 0o600 });
console.log(`Created ${rows.length} test users; credentials in ${file}.`);
