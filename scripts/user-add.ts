/** Create a user. npm run user:add -- <username> <analyst|reviewer|legal|admin>
 * Password: from MRE_NEW_PASSWORD, otherwise a random one printed once to this terminal. */
import { randomBytes } from 'node:crypto';
import { createUser, ROLES, type Role } from '../backend/src/auth';
const [username, role] = process.argv.slice(2);
if (!username || !ROLES.includes(role as Role)) { console.error(`Usage: npm run user:add -- <username> <${ROLES.join('|')}>`); process.exit(2); }
const password = process.env.MRE_NEW_PASSWORD ?? randomBytes(15).toString('base64url');
createUser(username, password, role as Role);
console.log(`Created ${username} (${role}).${process.env.MRE_NEW_PASSWORD ? '' : ` Password (shown once): ${password}`}`);
