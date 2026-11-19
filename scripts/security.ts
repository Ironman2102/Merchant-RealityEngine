/** Security + governance probes. Each probe must print "blocked". Run: npm run security */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
process.env.MRE_CASE_STORE = 'memory';
const { getInvestigation, openInvestigation, reviewInvestigation } = await import('../backend/src/workflow');
const { getCase } = await import('../backend/src/store');

const ds = JSON.parse(readFileSync('frontend/public/samples/01-sweet-crumbs-betting-front.json', 'utf8'));
const results: [string, boolean][] = [];
const probe = (name: string, blocked: boolean) => results.push([name, blocked]);

const target = join(process.cwd(), 'audit', 'PWNED.json');
rmSync(target, { force: true });
const w = reviewInvestigation('../../../audit/PWNED', { dataset: ds, notes: 'x' });
probe('path traversal write via case id', w.status === 400 && !existsSync(target));
probe('path traversal read via ?id=', getInvestigation('../../../package').status === 400);

const opened = openInvestigation(ds), id = opened.body.id as string;
probe('server mints case ids', /^INV-[0-9a-f]{8}$/.test(id));
reviewInvestigation(id, { notes: 'n', user: { label: 'CONFIRMED_ILLICIT', legalVerified: true, chosenLevel: 'L5' } });
const rec = getCase(id)!;
probe('client-supplied user state ignored', rec.user.label === null && rec.user.legalVerified === false && rec.user.chosenLevel === null);
const stored = JSON.stringify(rec);
probe('raw payer identifiers not stored', !stored.includes('cust001@upi') && !('dataset' in rec));
probe('unknown case id is not created on update', reviewInvestigation('INV-00000000', { dataset: ds }).status === 404);

let failed = 0;
for (const [name, ok] of results) { console.log(`${ok ? 'blocked' : 'OPEN   '}  ${name}`); if (!ok) failed++; }
console.log(`\n${results.length - failed}/${results.length} probes blocked`);
process.exit(failed ? 1 : 0);
