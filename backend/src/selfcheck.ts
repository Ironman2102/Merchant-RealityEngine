/** End-to-end check of the governed workflow on an in-memory database. Run: npm run check:api */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

process.env.MRE_CASE_STORE = 'memory';
const { approveInvestigation, labelInvestigation, openInvestigation, respondInvestigation, reviewInvestigation, auditStatus } = await import('./workflow');
const { createUser } = await import('./auth');
const { verifyAudit } = await import('./store');
const { getDb } = await import('./db');

const sweet = JSON.parse(readFileSync(new URL('../../frontend/public/samples/01-sweet-crumbs-betting-front.json', import.meta.url), 'utf8'));
const diwali = JSON.parse(readFileSync(new URL('../../frontend/public/samples/04-anand-sweets-diwali-genuine.json', import.meta.url), 'utf8'));
const pw = 'selfcheck-only-password-1';
const ana = createUser('ana', pw, 'analyst'), rev = createUser('rev', pw, 'reviewer'), rev2 = createUser('rev2', pw, 'reviewer'), leg = createUser('leg', pw, 'legal');

const opened = openInvestigation(sweet, ana);
assert.equal(opened.status, 200);
const id = opened.body.id as string;
const steps = () => (opened.body.workflow as { state: string; summary: string }[]);
assert.equal(steps().length, 7);
assert.equal((opened.body.result as { decision: string }).decision, 'OPEN_CASE');

assert.match((reviewInvestigation(id, { notes: 'Collections do not match a bakery.' }, ana).body.workflow as { summary: string }[])[4].summary, /bakery/);

// L3 needs a second person: the analyst proposes, the analyst cannot approve, a reviewer approves.
const proposed = respondInvestigation(id, { chosenLevel: 'L3', legalVerified: true }, ana);
assert.equal((proposed.body.user as { executed: boolean }).executed, false);
assert.equal(approveInvestigation(id, { approve: true }, ana).status, 403);
const approved = approveInvestigation(id, { approve: true }, rev);
assert.equal((approved.body.user as { executed: boolean }).executed, true);

// L5 needs legal approval by someone else AND a confirmed label from two people.
respondInvestigation(id, { chosenLevel: 'L5' }, ana);
assert.equal(approveInvestigation(id, { approve: true }, rev).status, 403);          // reviewer is not legal
const blocked = approveInvestigation(id, { approve: true }, leg);                     // label missing → blocked
assert.equal((blocked.body.workflow as { state: string }[])[5].state, 'blocked');
assert.match((blocked.body.workflow as { summary: string }[])[5].summary, /CONFIRMED_ILLICIT/);

labelInvestigation(id, { label: 'CONFIRMED_ILLICIT' }, rev);
assert.equal(labelInvestigation(id, { label: 'CONFIRMED_ILLICIT' }, rev).status, 403); // same person cannot confirm
const labelled = labelInvestigation(id, { label: 'CONFIRMED_ILLICIT' }, rev2);
assert.equal((labelled.body.user as { label: string }).label, 'CONFIRMED_ILLICIT');
assert.ok(((labelled.body.learning as { updates: unknown[] }).updates).length > 0);

// Audit chain intact, then tamper → detected.
assert.equal((auditStatus(id).body as { ok: boolean }).ok, true);
getDb().prepare("UPDATE audit SET detail = 'edited' WHERE case_id = ? AND seq = 2").run(id);
const v = verifyAudit(id);
assert.equal(v.ok, false); assert.equal(v.brokenAt, 2);

assert.equal((openInvestigation(diwali, ana).body.result as { decision: string }).decision, 'NO_CASE');
assert.equal(openInvestigation({ format: 'nope' }, ana).status, 400);
assert.equal(openInvestigation(sweet, leg).status, 403);                                // legal does not open cases
assert.equal(respondInvestigation('INV-rebuilt', { chosenLevel: 'L0' }, ana).status, 400);
assert.equal(respondInvestigation('INV-0000abcd', { chosenLevel: 'L0' }, ana).status, 404);

console.log('api selfcheck ok');
console.log(steps().map((s, i) => `L${i + 1} ${s.state}: ${s.summary}`).join('\n'));
