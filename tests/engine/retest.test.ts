/** The nine findings of the re-test (R1–R9). Each test states the invariant, not one example of it. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHashKey } from '../../adapters/pseudonym';
import { parseCsv } from '../../adapters/csv';
import { mapExport } from '../../adapters/mapExport';
import * as auth from '../../backend/src/auth';
import { analyzeDataset } from '../../backend/src/algorithms/analyze';
import { getDb, resetDb } from '../../backend/src/db';
import { proposePassport, reviewPassport } from '../../backend/src/passports';
import { saveLiveRules } from '../../backend/src/rulesState';
import { setLiveDetectorPatch } from '../../rules/index';
import { createServiceKey } from '../../backend/src/serviceKeys';
import { evidencePack } from '../../backend/src/trace';
import { handleV1 } from '../../backend/src/v1';
import { postWebhook } from '../../backend/src/sinks/webhook';
import * as W from '../../backend/src/workflow';
import { runBatch } from '../../cli/batch';
import * as engine from '../../engine/index';
import { makeSuite } from '../../engine/synthetic';
import { validateWorkflow, loadWorkflow } from '../../engine/workflowConfig';
import { fuse } from '../../frontend/src/engines/evidenceFusion';
import { passportErrors } from '../../frontend/src/engines/passport';
import { runPatternPack } from '../../frontend/src/engines/patternPack';
import { actionLog, planResponse } from '../../frontend/src/engines/responseEngine';
import { buildTrace } from '../../frontend/src/engines/traceEngine';

const SAMPLES = 'frontend/public/samples';
const MAPPING = 'adapters/mappings/generic-pa-v1.json';
const load = (f: string): any => JSON.parse(readFileSync(join(SAMPLES, f), 'utf8'));
const front = () => load('01-sweet-crumbs-betting-front.json');
const moonlight = () => load('11-moonlight-bakes-honest-change.json');
const analyze = engine.analyze as (d: unknown, o?: { trustPassports?: boolean }) => any;
const toScenario = engine.datasetToScenario as (d: unknown, o?: { trustPassports?: boolean }) => any;
const user = { notes: '', clarification: '', chosenLevel: null, legalVerified: false, escrowConfirmed: false, executed: false, label: null, audit: [] };

export default async function (): Promise<number> {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); } else console.log(`  ✓ ${name}`); };
  const section = async (name: string, fn: () => void | Promise<void>) => {
    try { await fn(); } catch (e) { check(name, false, `threw: ${e instanceof Error ? e.message.slice(0, 200) : e}`); }
  };
  const refuses = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };
  const temp: string[] = [];
  const dir = () => { const d = mkdtempSync(join(tmpdir(), 'mre-retest-')); temp.push(d); return d; };
  const saved = { ...process.env };
  process.env.MRE_CASE_STORE = 'memory';
  process.env.MRE_HASH_KEY = 'retest-only-hash-key-0000';
  delete process.env.MRE_WORKFLOW_DIR;
  resetDb();
  const pw = 'retest-only-login-value-1';
  const ana = auth.createUser('rt-ana', pw, 'analyst'), ana2 = auth.createUser('rt-ana2', pw, 'analyst');
  const rev = auth.createUser('rt-rev', pw, 'reviewer'), rev2 = auth.createUser('rt-rev2', pw, 'reviewer'), leg = auth.createUser('rt-leg', pw, 'legal');
  const open = (d: unknown) => W.openInvestigation(d, ana).body.id as string;
  const now = (id: string) => W.getInvestigation(id).body as any;
  const taken = (id: string): string[] => (evidencePack(id, rev).body as any).strDraft.actionTaken;
  const batchRows = (inDir: string) => {
    const out = dir();
    runBatch({ inDir, mappingPath: MAPPING, outDir: out, key: loadHashKey() });
    const [head, ...rows] = parseCsv(readFileSync(join(out, 'scores.csv'), 'utf8'), ',');
    return { followUp: (id: string) => rows.find(r => r[0] === id)?.[head.indexOf('follow_up')], run: JSON.parse(readFileSync(join(out, 'run.json'), 'utf8')) };
  };

  await section('R1', () => {
    // As much as valid passports can cover, on every link, all at once.
    const everything = (d: any) => {
      const links = [...new Set(d.transactions.map((t: any) => t.paymentLinkId).filter(Boolean))];
      const bands = [[1, 10], [10, 100], [100, 1000], [1000, 10000], [10000, 100000]];
      const hours = [[0, 12], [12, 24]];
      return { ...d, contextPassports: links.flatMap((linkId, l) => bands.map((ticketBand, b) => ({
        id: `CP-${l}-${b}`, reason: 'change', document: 'doc', linkId, from: '2026-08-01', hours: hours[b % 2], states: ['*'], ticketBand, volumeUplift: 3, status: 'VERIFIED',
      }))) };
    };
    const c5only = front();
    c5only.transactions = c5only.transactions.filter((t: any) => t.type !== 'REFUND' && t.type !== 'TRANSFER');
    for (const t of c5only.transactions) if (t.type === 'SETTLEMENT') t.beneficiaryAccount = 'B';
    delete c5only.website; c5only.dataAvailability.website = 'MISSING';
    const all = [...readdirSync(SAMPLES).filter(f => /^\d\d-/.test(f)).map(load), c5only, ...makeSuite(15, 5151, { geo: true }).map(m => m.dataset)];
    let tested = 0; const moved: string[] = [];
    for (const d of all) {
      const base = analyze({ ...d, contextPassports: [] }).result;
      const fired = [...base.evidence.filter((e: any) => e.status === 'ILLICIT').map((e: any) => e.id), ...base.streams.flatMap((s: any) => s.fired)];
      const conduct = base.fusion.decision === 'OPEN_CASE' || fired.some((id: string) => engine.RULES.detector(id).class === 'conduct') || base.evidence.some((e: any) => e.status === 'ILLICIT' && e.signal === 'conduct');
      if (!conduct) continue;
      tested++;
      const got = analyze(everything(d), { trustPassports: true });
      const key = (r: any) => JSON.stringify([r.fusion.decision, r.fusion.followUp, r.fusion.posterior, r.fusion.priority, r.fusion.conductSignals, r.review.recommended, r.suspectLinks, r.scope]);
      if (!got.ok || key(got.result) !== key(base)) moved.push(d.merchant.id);
    }
    check('R1 passports change nothing once there is conduct', tested > 50 && !moved.length, `${moved.length}/${tested} moved: ${moved.slice(0, 4).join(', ')}`);
    const p = moonlight().contextPassports[0];
    check('R1 the demo passport is valid', passportErrors(p).length === 0);
    const tooWide: Record<string, unknown>[] = [
      { hours: [0, 24] }, { hours: [6, 22] }, { hours: [9, 9] }, { ticketBand: [0, 900] }, { ticketBand: [10, 101] },
      { states: ['AP', 'AS', 'BR', 'CG', 'DL', 'GA', 'GJ', 'HR', 'HP', 'JH', 'KA'] }, { hours: undefined, ticketBand: undefined, volumeUplift: undefined },
    ];
    tooWide.forEach((change, i) => check(`R1 too-wide passport ${i + 1} is refused`, passportErrors({ ...p, ...change }).length > 0));
    const sc = toScenario(moonlight(), { trustPassports: true }).scenario;
    Object.assign(sc.passports[0], { status: 'VERIFIED', hours: [0, 24] });
    check('R1 a stored invalid passport is ignored', engine.runInvestigation(sc).fusion.followUp === 'ASK');
    const honest = moonlight(); honest.contextPassports[0].status = 'VERIFIED';
    const cleared = analyze(honest, { trustPassports: true }).result;
    check('R1 an honest change still clears', cleared.fusion.followUp === 'NONE' && cleared.review.recommended === 'L0');
  });

  await section('R2', () => {
    const d = moonlight();
    Object.assign(d.contextPassports[0], { status: 'VERIFIED', submittedBy: 'x', reviewedBy: 'y' });
    const p = toScenario(d).scenario.passports[0];
    check('R2 a file is not trusted by default', p.status === 'SUBMITTED' && !p.submittedBy && !p.reviewedBy && analyze(d).result.fusion.followUp === 'ASK');
    const twice = moonlight(); twice.contextPassports.push({ ...twice.contextPassports[0] });
    check('R2 duplicate passport ids are refused', !analyze(twice).ok);
    const inDir = dir(); cpSync('examples/generic-pa', inDir, { recursive: true });
    const ctx = JSON.parse(readFileSync(join(inDir, 'context.json'), 'utf8'));
    ctx.byMerchant['M-MOB-112'].contextPassports[0].status = 'VERIFIED';
    writeFileSync(join(inDir, 'context.json'), JSON.stringify(ctx));
    const mapped: any = mapExport(inDir, MAPPING, loadHashKey()).datasets.find(x => x.merchant.id === 'M-MOB-112');
    check('R2 an export is not trusted', mapped.contextPassports[0].status === 'SUBMITTED');
    check('R2 batch still asks', batchRows(inDir).followUp('M-MOB-112') === 'ASK');
  });

  await section('R3', () => {
    const keys = ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty'];
    for (const mcc of [...keys, '', '54621']) { const d = front(); d.merchant.mcc = mcc; check(`R3 MCC "${mcc}" is refused`, !analyze(d).ok); }
    for (const key of keys) {
      const d = front(); d.merchant.localStates = [key]; d.transactions.forEach((t: any) => { t.payerState = key; });
      const r = analyze(d);
      check(`R3 state "${key}" is refused or scored`, !r.ok || Number.isFinite(r.result.fusion.posterior));
    }
    const hostile: unknown[] = [null, 0, -1, 1e308, NaN, Infinity, '', 'constructor', '__proto__', [], {}, [null], [{}], true];
    const base = load('07-udupi-tiffin-steady.json'), broken: string[] = [];
    const spots: [string, (d: any) => any][] = [['top', d => d], ['merchant', d => d.merchant], ['txn', d => d.transactions[0]], ['week', d => d.weeklySales[0]]];
    const fields = new Set(['payerId', 'payerState', 'paymentLinkId', 'paidTo', 'beneficiaryAccount', 'payerMobile', 'website', 'bankCredits', 'peers', 'orders', 'contextPassports', 'matchFixtures', 'dataAvailability', 'undeclared']);
    for (const [where, at] of spots) for (const field of new Set([...Object.keys(at(base)), ...fields])) for (const v of hostile) {
      const d = structuredClone(base); at(d)[field] = v;
      try { const r = analyze(d); if (r.ok && ![r.result.fusion.posterior, ...r.result.fusion.posteriorCi].every(Number.isFinite)) broken.push(`${where}.${field}`); }
      catch { broken.push(`${where}.${field} throws`); }
    }
    check('R3 hostile field: refused or a finite score', !broken.length, [...new Set(broken)].slice(0, 6).join(', '));
    const r = analyze(front()).result;
    check('R3 a score that is not a number never reads as NO_CASE', refuses(() => fuse(r.evidence.map((e: any) => (e.status === 'ILLICIT' ? { ...e, llr: NaN } : e)), r.scenario.profile)));
    const inDir = dir(); cpSync('examples/generic-pa', inDir, { recursive: true });
    const mapping = JSON.parse(readFileSync(MAPPING, 'utf8')), file = join(inDir, mapping.files.transactions);
    const before = mapExport(inDir, MAPPING, loadHashKey()).datasets.reduce((n, x) => n + x.transactions.length, 0);
    const [head, first] = readFileSync(file, 'utf8').split('\n');
    const cells = first.split(mapping.delimiter), col = head.split(mapping.delimiter).indexOf(typeof mapping.transactions.type === 'string' ? mapping.transactions.type : mapping.transactions.type.column);
    cells[col] = 'constructor';
    writeFileSync(file, `${readFileSync(file, 'utf8').trimEnd()}\n${cells.join(mapping.delimiter)}\n`);
    check('R3 an inherited key is not a mapped type', mapExport(inDir, MAPPING, loadHashKey()).datasets.reduce((n, x) => n + x.transactions.length, 0) === before);
    const numeric = load('07-udupi-tiffin-steady.json');
    numeric.transactions.find((t: any) => t.type === 'SALE').payerId = 9876501234;
    const stored = analyzeDataset(numeric);
    check('R3 a numeric payer id is pseudonymised', !stored.ok || !JSON.stringify(stored.scenario.events).includes('9876501234'));
  });

  await section('R4', () => {
    const d = load('07-udupi-tiffin-steady.json'), sale = d.transactions.find((t: any) => t.type === 'SALE'), t0 = Date.parse(sale.time);
    for (let i = 0; i < 250000; i++) d.transactions.push({ ...sale, id: `Z${i}`, payerId: `p${i % 60000}`, time: new Date(t0 + i * 8000).toISOString() });
    const r = analyze(d);
    check('R4 250,000 rows are scored', r.ok, r.ok ? '' : r.errors.join(' ').slice(0, 120));
    if (!r.ok) return;
    const plan = planResponse(r.result, user);
    engine.buildPack(r.result, { caseId: null, createdAt: '', datasetSha256: '', generatedBy: null });
    buildTrace(r.result);
    runPatternPack(r.result);
    check('R4 pack, patterns and response work at that size', actionLog(r.result, plan, 0).length > 0);
  });

  await section('R5', () => {
    const id = open(moonlight()), pass = now(id).scenario.passports[0].id;
    check('R5 reviewer verifies', reviewPassport(id, { passportId: pass, verify: true }, rev).status === 200);
    check('R5 batch applies verified passports', batchRows('examples/generic-pa').followUp('M-MOB-112') === 'NONE');
    saveLiveRules({ A4: { sensitivity: 0.95 } }, 'retest-live');
    setLiveDetectorPatch(null, null); // a process that has not scored anything since the promotion
    try { check('R5 batch uses promoted rules', batchRows('examples/generic-pa').run.rulesVersion === 'retest-live'); }
    finally { saveLiveRules(null, null); }
    getDb().prepare('DELETE FROM passports').run();
  });

  await section('R6', () => {
    const bad1 = { label: 'CONFIRMED_ILLICIT' }, good = { label: 'ADJUDICATED_BENIGN' }, unresolved = { label: 'UNRESOLVED' };
    let id = open(front()); W.labelInvestigation(id, bad1, ana);
    check('R6 UNRESOLVED cannot replace a pending label', W.labelInvestigation(id, unresolved, rev).status === 409 && !!now(id).pending.label);
    check('R6 another analyst cannot reject it', W.labelInvestigation(id, { reject: true }, ana2).status === 403);
    check('R6 a reviewer rejects it', W.labelInvestigation(id, { reject: true, reason: 'not enough' }, rev).status === 200 && !now(id).pending.label && !now(id).user.label);
    W.labelInvestigation(id, bad1, ana);
    check('R6 the proposer withdraws it', W.labelInvestigation(id, { reject: true }, ana).status === 200 && !now(id).pending.label);
    W.labelInvestigation(id, bad1, ana); W.labelInvestigation(id, bad1, rev);
    W.labelInvestigation(id, unresolved, ana);
    check('R6 changing a final label needs two people', now(id).user.label === 'CONFIRMED_ILLICIT' && !!now(id).pending.label);
    W.labelInvestigation(id, { reject: true }, rev);
    const honest = load('07-udupi-tiffin-steady.json');
    id = open(honest); W.labelInvestigation(id, bad1, ana); W.labelInvestigation(id, bad1, rev);
    const second = open(honest); W.labelInvestigation(second, good, ana);
    check('R6 another case cannot undo a confirmed merchant alone', now(second).user.label === null && !!now(second).pending.label);
  });

  await section('R7', () => {
    const go = (id: string, chosenLevel: string, by: auth.Actor = ana) => W.respondInvestigation(id, { chosenLevel }, by);
    let id = open(front()); go(id, 'L3'); W.approveInvestigation(id, { approve: true }, rev);
    const l3 = JSON.stringify(taken(id));
    for (const level of ['L0', 'L1', 'L2']) {
      go(id, level);
      check(`R7 ${level} over L3 waits, L3 stays in force`, now(id).pending.response?.level === level && JSON.stringify(taken(id)) === l3);
    }
    check('R7 the proposer cannot approve the lift', W.approveInvestigation(id, { approve: true }, ana).status === 403);
    check('R7 another analyst cannot either', W.approveInvestigation(id, { approve: true }, ana2).status === 403);
    W.approveInvestigation(id, { approve: false }, rev);
    check('R7 a rejected lift changes nothing', now(id).user.executed === true && now(id).user.chosenLevel === 'L3' && JSON.stringify(taken(id)) === l3);
    go(id, 'L2');
    check('R7 the proposer can withdraw', W.approveInvestigation(id, { approve: false }, ana).status === 200 && !now(id).pending.response && JSON.stringify(taken(id)) === l3);
    go(id, 'L5'); W.approveInvestigation(id, { approve: true }, leg);
    check('R7 a blocked step leaves L3 in force', now(id).workflow[5].state === 'blocked' && JSON.stringify(taken(id)) === l3);
    go(id, 'L0');
    check('R7 it cannot be lifted after a blocked step either', !!now(id).pending.response);
    W.approveInvestigation(id, { approve: true }, rev);
    check('R7 a second person can lift it', now(id).user.executed === true && now(id).user.chosenLevel === 'L0' && JSON.stringify(taken(id)) !== l3);

    id = open(front()); W.labelInvestigation(id, { label: 'CONFIRMED_ILLICIT' }, ana); W.labelInvestigation(id, { label: 'CONFIRMED_ILLICIT' }, rev);
    go(id, 'L5'); W.approveInvestigation(id, { approve: true }, leg); go(id, 'L2');
    check('R7 only legal lifts L5', W.approveInvestigation(id, { approve: true }, rev2).status === 403 && W.approveInvestigation(id, { approve: true }, leg).status === 200);

    id = open(front()); go(id, 'L3'); W.approveInvestigation(id, { approve: true }, rev); go(id, 'L0');
    const link = now(id).scenario.events.find((e: any) => e.linkId).linkId;
    proposePassport(id, { linkId: link, reason: 'change', document: 'doc', from: '2026-10-01', hours: [22, 2] }, ana);
    const p = now(id).scenario.passports.at(-1);
    reviewPassport(id, { passportId: p.id, verify: true }, rev);
    check('R7 a re-score leaves L3 in force', !now(id).pending.response && now(id).user.chosenLevel === 'L3' && now(id).user.executed === true);
    const row = getDb().prepare('SELECT record_json FROM cases WHERE id = ?').get(id) as { record_json: string };
    const legacy = JSON.parse(row.record_json); delete legacy.inForce;
    getDb().prepare('UPDATE cases SET record_json = ? WHERE id = ?').run(JSON.stringify(legacy), id);
    go(id, 'L0');
    check('R7 a case saved earlier keeps its restriction', !!now(id).pending.response);
    getDb().prepare('DELETE FROM passports').run();

    const wfDir = dir(); cpSync('workflow', wfDir, { recursive: true });
    const responses = loadWorkflow('workflow').responses;
    writeFileSync(join(wfDir, 'responses.json'), JSON.stringify(responses.map(r => (r.id === 'L3' ? { ...r, auto: true } : r))));
    process.env.MRE_WORKFLOW_DIR = wfDir;
    try { id = open(front()); go(id, 'L3'); check('R7 auto:true cannot skip approval of a restriction', !!now(id).pending.response); }
    finally { delete process.env.MRE_WORKFLOW_DIR; }
    const cfg = loadWorkflow('workflow');
    check('R7 a restriction cannot be relabelled harmless', validateWorkflow({ ...cfg, responses: cfg.responses.map(r => (r.id === 'L3' ? { ...r, restrictsFunds: false } : r)) }).length > 0);
  });

  await section('R8', async () => {
    const call = (key: string, method: string, path: string, body: unknown = {}) =>
      handleV1({ method, path, body, header: n => (n.toLowerCase() === 'authorization' ? `Bearer ${key}` : undefined) }) as Promise<any>;
    const a = createServiceKey('client-a', ['cases', 'batch']).key, b = createServiceKey('client-b', ['cases', 'batch', 'read']).key, aRead = createServiceKey('client-a', ['read']).key;
    const files: Record<string, string> = {};
    for (const f of readdirSync('examples/generic-pa')) files[f] = readFileSync(join('examples/generic-pa', f)).toString('base64');
    const batch = `/v1/batches/${(await call(a, 'POST', '/v1/batches', { mapping: 'generic-pa-v1', files })).body.batchId}`;
    check('R8 another client cannot read a batch', (await call(b, 'GET', batch)).status === 404);
    check('R8 the client can', (await call(a, 'GET', batch)).status === 200 && (await call(aRead, 'GET', batch)).status === 200);
    const path = `/v1/cases/${(await call(a, 'POST', '/v1/cases', front())).body.id}`;
    for (const tail of ['', '/trace', '/pack']) check(`R8 another client cannot read case${tail}`, (await call(b, 'GET', path + tail)).status === 404);
    check('R8 the client reads its case', (await call(a, 'GET', path)).status === 200 && (await call(aRead, 'GET', path)).status === 200);
    for (let i = 0; i < 100 && !['done', 'error'].includes((await call(a, 'GET', batch)).body.status); i++) await new Promise(r => setTimeout(r, 50));
  });

  await section('R9', async () => {
    const hosted = ['NODE_ENV', 'MRE_STATELESS_SESSIONS', 'NETLIFY', 'VERCEL', 'AWS_LAMBDA_FUNCTION_NAME'];
    const key = process.env.MRE_HASH_KEY;
    for (const n of hosted) delete process.env[n];
    for (const v of ['change-me', 'short', 'x'.repeat(40), 'change-me-before-you-deploy', 'placeholder-secret-value', 'replace-me-with-a-secret', 'your-secret-goes-in-here']) {
      process.env.MRE_HASH_KEY = v;
      check(`R9 weak key "${v.slice(0, 22)}" is refused everywhere`, refuses(loadHashKey));
    }
    for (const n of hosted) {
      delete process.env.MRE_HASH_KEY;
      process.env[n] = n === 'NODE_ENV' ? 'production' : '1';
      check(`R9 a key is required when ${n} says hosted`, refuses(loadHashKey));
      delete process.env[n];
    }
    process.env.MRE_HASH_KEY = key;
    check('R9 a real key works', !refuses(loadHashKey));
    process.env.MRE_BOOT_USERS = 'boot-x:change-me-please:admin';
    check('R9 a placeholder password is not an account', auth.bootAccounts().length === 0);
    delete process.env.MRE_BOOT_USERS;
    process.env.MRE_SESSION_SECRET = 'change-me-before-you-deploy';
    const assertSecrets = (auth as any).assertSecrets;
    check('R9 a placeholder session secret stops start-up', typeof assertSecrets === 'function' && refuses(assertSecrets));
    delete process.env.MRE_SESSION_SECRET;
    const realFetch = globalThis.fetch; let sent = 0;
    globalThis.fetch = (async () => { sent++; return new Response('', { status: 200 }); }) as typeof fetch;
    try {
      delete process.env.MRE_RETEST_HOOK;
      await postWebhook({ type: 'webhook', url: 'http://127.0.0.1:9/hook', secretEnv: 'MRE_RETEST_HOOK', events: [] }, { event: 'case.opened', caseId: 'INV-00000000', at: '', data: {} });
      check('R9 a webhook is never signed with an empty secret', sent === 0);
    } finally { globalThis.fetch = realFetch; }
  });

  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  for (const d of temp) rmSync(d, { recursive: true, force: true });
  resetDb();
  return bad;
}
