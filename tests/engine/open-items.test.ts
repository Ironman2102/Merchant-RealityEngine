/** Items left open after the re-test, and the two-person rules as one property: nobody can do alone what needs two. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createSign, generateKeyPairSync } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as csv from '../../adapters/csv';
import { loadHashKey, weakSecret } from '../../adapters/pseudonym';
import * as auth from '../../backend/src/auth';
import { analyzeDataset } from '../../backend/src/algorithms/analyze';
import { getDb, resetDb } from '../../backend/src/db';
import * as improverApi from '../../backend/src/improverApi';
import { verifyIdToken } from '../../backend/src/oidc';
import * as passportApi from '../../backend/src/passports';
import { saveLiveRules, syncLiveRules } from '../../backend/src/rulesState';
import { createServiceKey } from '../../backend/src/serviceKeys';
import { evidencePack } from '../../backend/src/trace';
import { handleV1 } from '../../backend/src/v1';
import * as W from '../../backend/src/workflow';
import { runBatch } from '../../cli/batch';
import { analyze, datasetToScenario, runInvestigation } from '../../engine/index';
import { passportsInForce } from '../../frontend/src/engines/passport';
import { mulberry32 } from '../../frontend/src/utils/prng';
import { getLiveDetectorPatch } from '../../rules/index';

const P = passportApi as any, I = improverApi as any;
const load = (f: string): any => JSON.parse(readFileSync(join('frontend/public/samples', f), 'utf8'));
const front = () => load('01-sweet-crumbs-betting-front.json');
const honest = () => load('07-udupi-tiffin-steady.json');
const moonlight = () => load('11-moonlight-bakes-honest-change.json');

export default async function (): Promise<number> {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); } else console.log(`  ✓ ${name}`); };
  const saved = { ...process.env };
  const temp: string[] = [];
  const dir = () => { const d = mkdtempSync(join(tmpdir(), 'mre-open-')); temp.push(d); return d; };
  process.env.MRE_CASE_STORE = 'memory';
  process.env.MRE_HASH_KEY = 'open-items-only-hash-key-0000';
  delete process.env.MRE_WORKFLOW_DIR;
  const pw = 'open-items-only-login-value-1';
  let ana: auth.Actor, ana2: auth.Actor, rev: auth.Actor, rev2: auth.Actor, leg: auth.Actor;
  /** Every section starts from an empty database. */
  const section = async (name: string, fn: () => void | Promise<void>) => {
    resetDb(); saveLiveRules(null, null);
    ana = auth.createUser('oi-ana', pw, 'analyst'); ana2 = auth.createUser('oi-ana2', pw, 'analyst');
    rev = auth.createUser('oi-rev', pw, 'reviewer'); rev2 = auth.createUser('oi-rev2', pw, 'reviewer'); leg = auth.createUser('oi-leg', pw, 'legal');
    try { await fn(); } catch (e) { check(name, false, `threw: ${e instanceof Error ? e.message.slice(0, 200) : e}`); }
  };
  const open = (d: unknown, by = ana) => W.openInvestigation(d, by).body.id as string;
  const now = (id: string) => W.getInvestigation(id).body as any;
  const restrict = (id: string) => { W.respondInvestigation(id, { chosenLevel: 'L3' }, ana); W.approveInvestigation(id, { approve: true }, rev); };
  const confirm = (id: string, origin?: string) => { W.labelInvestigation(id, { label: 'CONFIRMED_ILLICIT' }, ana); W.labelInvestigation(id, { label: 'CONFIRMED_ILLICIT', origin }, rev); };
  const v1 = (key: string, method: string, path: string, body: unknown = {}) =>
    handleV1({ method, path, body, header: n => (n.toLowerCase() === 'authorization' ? `Bearer ${key}` : undefined) }) as Promise<any>;
  const batchAsks = () => {
    const out = dir();
    runBatch({ inDir: 'examples/generic-pa', mappingPath: 'adapters/mappings/generic-pa-v1.json', outDir: out, key: loadHashKey() });
    const [head, ...rows] = csv.parseCsv(readFileSync(join(out, 'scores.csv'), 'utf8'));
    return rows.find(r => r[0] === 'M-MOB-112')?.[head.indexOf('follow_up')] === 'ASK';
  };

  await section('spreadsheets', () => {
    for (const cell of ['=1+1', '+cmd', '-2+3', '@SUM(A1)', '\t=1', ' =1', '＝1+1']) {
      check(`CSV neutralises ${JSON.stringify(cell)}`, csv.parseCsv(csv.toCsv([['M', cell]]))[0][1].startsWith("'"));
    }
    check('CSV neutralises a formula behind a semicolon', !/;\s*=/.test(csv.toCsv([['M', 'ok; =2+2']])));
    check('CSV leaves numbers alone', csv.toCsv([[-2.5, '-0.5', '1e-9', 'Golden Oven']]) === '-2.5,-0.5,1e-9,Golden Oven\r\n');
  });

  await section('evidence packs', () => {
    const inDir = dir(), out = dir(); cpSync('examples/generic-pa', inDir, { recursive: true });
    const mapping = JSON.parse(readFileSync('adapters/mappings/generic-pa-v1.json', 'utf8'));
    for (const file of [mapping.files.merchants, mapping.files.transactions, mapping.files.weekly]) {
      const rows = readFileSync(join(inDir, file), 'utf8').trimEnd().split('\n'), extra: string[] = [];
      for (const [n, id] of ['Z/1', 'Z_1', 'z_1'].entries())
        for (const row of rows) if (row.includes('M-SCB-001')) extra.push(row.replaceAll('M-SCB-001', id).replace(/^(T|S|R|P)([^,]*)/, `$1${n}$2`));
      writeFileSync(join(inDir, file), [...rows, ...extra].join('\n') + '\n');
    }
    const ran = runBatch({ inDir, mappingPath: 'adapters/mappings/generic-pa-v1.json', outDir: out, key: loadHashKey() });
    check('one evidence pack per scored merchant', ran.merchants - ran.failed > 11 && readdirSync(join(out, 'packs')).length === ran.merchants - ran.failed, `${readdirSync(join(out, 'packs')).length}/${ran.merchants - ran.failed}`);
  });

  await section('single sign-on', () => {
    const k = generateKeyPairSync('rsa', { modulusLength: 2048 }), part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const cfg = { issuer: 'https://idp.test', audience: 'mre', nonce: 'n', jwk: k.publicKey.export({ format: 'jwk' }) as any, groupsToRoles: { g: 'admin', v: 'reviewer' } };
    const login = (sub: string, group = 'g') => {
      const body = `${part({ alg: 'RS256' })}.${part({ iss: cfg.issuer, aud: 'mre', nonce: 'n', exp: 9999999999, sub, groups: [group] })}`;
      return auth.loginWithIdToken(`${body}.${createSign('RSA-SHA256').update(body).sign(k.privateKey).toString('base64url')}`, cfg);
    };
    for (const sub of ['oi-ana', 'OI-ANA', 'oi|-ana']) check(`sign-on cannot become local user via "${sub}"`, login(sub) === null);
    check('the local role is untouched', (getDb().prepare("SELECT role FROM users WHERE username = 'oi-ana'").get() as any).role === 'analyst');
    process.env.MRE_BOOT_USERS = 'oi-boot:open-items-only-login-value-2:admin';
    check('sign-on cannot claim a configured account first', login('oi-boot') === null);
    delete process.env.MRE_BOOT_USERS;
    const one = login('sso.user', 'v'), two = login('sso|.user', 'v'), again = login('sso.user', 'v');
    check('two identities never share an account', !!one && !!two && one.actor.id !== two.actor.id);
    check('the same identity keeps its account', !!one && again?.actor.id === one.actor.id && again.actor.role === 'reviewer');
    (auth as any).linkSsoIdentity?.('oi-ana2', cfg.issuer, 'person-2');
    check('an operator can link a local account', login('person-2', 'v')?.actor.id === ana2.id);
    let refused = false;
    try { auth.createUser('OI-LEG', pw, 'reviewer'); } catch { refused = true; }
    check('usernames differing only by case are refused', refused);
    let threw = false, result: any;
    try { result = verifyIdToken('x.y.z', cfg); } catch { threw = true; }
    check('a malformed token is simply refused', !threw && result?.ok === false);
  });

  await section('secrets', () => {
    for (const s of ['secretsecretsecret', 'password12345678', 'Change Me please 123', 'admin-password-123456']) check(`guessable secret "${s}" is refused`, weakSecret(s));
    check('a generated secret passes', !weakSecret('9f2c4e7a1b8d3f6059ac7e21d4b8f3a6') && !weakSecret('q7ZVxv2mKp0RtLw9sYdH'));
  });

  await section('passport makers', async () => {
    const key = createServiceKey('client-a', ['cases']).key;
    const id = (await v1(key, 'POST', '/v1/cases', moonlight())).body.id, p = now(id).scenario.passports[0];
    check('an API-filed passport needs a human maker', P.reviewPassport(id, { passportId: p.id, verify: true }, rev).status === 409);
    check('an analyst takes it on', P.proposePassport(id, { endorse: p.id }, ana).status === 200 && now(id).scenario.passports[0].submittedBy === ana.username);
    check('then a different person verifies', P.reviewPassport(id, { passportId: p.id, verify: true }, rev).status === 200 && now(id).result.followUp === 'NONE');
    const other = moonlight(); other.contextPassports[0].document = 'Another document';
    const mine = open(other, rev);
    check('whoever uploads it is named as its maker', now(mine).scenario.passports.some((x: any) => x.submittedBy === rev.username));
  });

  await section('passports do not stack', () => {
    const id = open(moonlight()), first = now(id).scenario.passports[0];
    P.reviewPassport(id, { passportId: first.id, verify: true }, rev);
    P.proposePassport(id, { linkId: first.linkId, reason: 'more', document: 'doc', from: first.from, hours: [10, 22] }, ana);
    const second = now(id).scenario.passports.at(-1);
    check('overlapping passport on one QR is refused', P.reviewPassport(id, { passportId: second.id, verify: true }, rev).status === 409);
    const d = moonlight(), base = { ...d.contextPassports[0], status: 'VERIFIED' };
    d.contextPassports = [{ ...base, id: 'A', hours: [0, 12] }, { ...base, id: 'B', hours: [12, 24] }];
    const sc = datasetToScenario(d, { trustPassports: true }).scenario!;
    check('the engine applies one per QR at a time', passportsInForce(sc).length === 1);
    d.contextPassports = [{ ...base, id: 'A', from: '2026-07-01', until: '2026-09-30' }, { ...base, id: 'B', from: '2026-10-01' }];
    check('periods that follow each other are fine', passportsInForce(datasetToScenario(d, { trustPassports: true }).scenario!).length === 2);
  });

  await section('revocation', () => {
    const id = open(moonlight()), pass = now(id).scenario.passports[0];
    P.reviewPassport(id, { passportId: pass.id, verify: true }, rev);
    const later = open(moonlight()), carried = now(later).scenario.passports.find((x: any) => x.status === 'VERIFIED');
    check('an answered question stays on the record', now(later).result.followUp === 'NONE' && /answered by passport/i.test(now(later).result.gateReason));
    check('batch applies it before revocation', !batchAsks());
    check('an analyst cannot revoke', P.revokePassport(later, { passportId: carried.id, reason: 'forged' }, ana).status === 403);
    check('revocation needs a reason', P.revokePassport(later, { passportId: carried.id }, rev).status === 400);
    check('a reviewer revokes', P.revokePassport(later, { passportId: carried.id, reason: 'forged' }, rev).status === 200);
    check('every case it answered asks again', [id, later].every(c => now(c).result.followUp === 'ASK' && now(c).scenario.passports.some((x: any) => x.status === 'REVOKED') && now(c).auditIntact));
    check('later uploads ask again', now(open(moonlight())).result.followUp === 'ASK');
    check('batch asks again', batchAsks());
    check('a revoked passport cannot be verified', P.reviewPassport(id, { passportId: pass.id, verify: true }, rev2).status === 404);
    check('a new one can be', (() => { P.proposePassport(id, { linkId: pass.linkId, reason: 'real', document: 'doc', from: pass.from, hours: pass.hours, ticketBand: pass.ticketBand, volumeUplift: 2 }, ana); return P.reviewPassport(id, { passportId: now(id).scenario.passports.at(-1).id, verify: true }, rev).status === 200; })());
  });

  await section('passports between clients', async () => {
    const a = createServiceKey('client-a', ['cases', 'score']).key, b = createServiceKey('client-b', ['cases', 'score']).key;
    const first = (await v1(a, 'POST', '/v1/cases', moonlight())).body.id, p = now(first).scenario.passports[0];
    P.proposePassport(first, { endorse: p.id }, ana); P.reviewPassport(first, { passportId: p.id, verify: true }, rev);
    check('another client is not scored with it', (await v1(b, 'POST', '/v1/score', moonlight())).body.followUp === 'ASK');
    const other = await v1(b, 'GET', `/v1/cases/${(await v1(b, 'POST', '/v1/cases', moonlight())).body.id}`);
    check('another client cannot see it', !JSON.stringify(other.body).includes(rev.username));
    check('the owner is scored with it', (await v1(a, 'POST', '/v1/score', moonlight())).body.followUp === 'NONE');
    resetDb(); ana = auth.createUser('oi-ana', pw, 'analyst'); rev = auth.createUser('oi-rev', pw, 'reviewer');
    const key = createServiceKey('client-b', ['cases']).key, staff = moonlight();
    staff.contextPassports[0].document = 'STAFF-ONLY-DOCUMENT';
    const s = open(staff); P.reviewPassport(s, { passportId: now(s).scenario.passports[0].id, verify: true }, rev);
    const mine = (await v1(key, 'POST', '/v1/cases', moonlight())).body.id;
    for (const tail of ['', '/pack']) {
      const seen = await v1(key, 'GET', `/v1/cases/${mine}${tail}`);
      check(`staff passport applies without showing its document${tail}`, seen.status === 200 && !JSON.stringify(seen.body).includes('STAFF-ONLY-DOCUMENT') && now(mine).result.followUp === 'NONE');
    }
  });

  await section('restrictions follow the merchant', async () => {
    const x = open(front()); restrict(x);
    const y = open(front());
    check('a new case shows the restriction', now(y).restrictions?.some((r: any) => r.caseId === x && r.level === 'L3'));
    check('its pack shows it', JSON.stringify(evidencePack(y, rev).body).includes(x));
    W.respondInvestigation(y, { chosenLevel: 'L0' }, ana);
    check('lifting from a new case waits', !!now(y).pending.response && now(x).inForce.level === 'L3');
    check('an analyst cannot approve that', W.approveInvestigation(y, { approve: true }, ana2).status === 403);
    W.approveInvestigation(y, { approve: true }, rev);
    check('an approved lift reaches the first case', !now(x).inForce.restricts && !now(x).restrictions.length && now(x).auditIntact);

    const z = open(front()); W.respondInvestigation(z, { chosenLevel: 'L0' }, ana);
    check('once lifted, L0 applies at once', !now(z).pending.response);
    restrict(x); const q = open(front()); restrict(q);
    check('restrictions add up across cases', now(y).restrictions.length === 2);

    W.respondInvestigation(y, { chosenLevel: 'L2' }, ana);
    const w = open(front()); confirm(w); W.respondInvestigation(w, { chosenLevel: 'L5' }, ana); W.approveInvestigation(w, { approve: true }, leg);
    check('a lift proposed before a new restriction is stale', W.approveInvestigation(y, { approve: true }, leg).status === 409);
    W.approveInvestigation(y, { approve: false }, leg); W.respondInvestigation(y, { chosenLevel: 'L2' }, ana);
    check('lifting L5 from any case needs legal', W.approveInvestigation(y, { approve: true }, rev).status === 403 && W.approveInvestigation(y, { approve: true }, leg).status === 200 && !now(w).restrictions.length);

    restrict(x);
    getDb().prepare('UPDATE cases SET merchant_key = NULL, in_force_json = NULL').run();
    check('cases saved earlier are found too', now(open(front())).restrictions.length === 1);
    const key = createServiceKey('client-b', ['cases']).key, theirs = (await v1(key, 'POST', '/v1/cases', front())).body.id;
    check('a client is not shown other cases', !JSON.stringify((await v1(key, 'GET', `/v1/cases/${theirs}`)).body).includes(x) && !JSON.stringify((await v1(key, 'GET', `/v1/cases/${theirs}/pack`)).body).includes(x));
    for (const id of [' M-SCB-001', 'M-SCB-001 ', 'M-SCB-001​']) {
      const d = front(); d.merchant.id = id; d.transactions.forEach((t: any) => { if (t.merchantId === 'M-SCB-001') t.merchantId = id; });
      check(`merchant id ${JSON.stringify(id)} cannot escape its history`, !analyze(d).ok);
    }
  });

  await section('earlier decisions', () => {
    const first = open(honest()); confirm(first, 'merchant_dispute');
    const second = open(honest()); W.labelInvestigation(second, { label: 'ADJUDICATED_BENIGN' }, ana2);
    check('a dispute tag cannot hide a confirmation', !now(second).user.label && !!now(second).pending.label);
    check('a new case shows the earlier decision', now(second).history?.some((h: any) => h.id === first && h.label === 'CONFIRMED_ILLICIT'));
  });

  await section('rollback', () => {
    saveLiveRules({ A4: { sensitivity: 0.9 } }, 'open-items-live');
    I.rollbackRulesLive(rev);
    check('one reviewer only requests', getLiveDetectorPatch().version === 'open-items-live' && !!I.getRulesStatus().body.rollbackRequest);
    check('the requester cannot confirm', I.rollbackRulesLive(rev).status === 403 && getLiveDetectorPatch().version === 'open-items-live');
    check('an analyst cannot confirm', I.rollbackRulesLive(ana).status === 403);
    check('a second reviewer can reject', I.rollbackRulesLive(rev2, { reject: true }).status === 200 && !I.getRulesStatus().body.rollbackRequest);
    I.rollbackRulesLive(rev);
    check('a second reviewer confirms', I.rollbackRulesLive(rev2).status === 200 && !getLiveDetectorPatch().patch);
    saveLiveRules({ A4: { sensitivity: 0.9 } }, 'open-items-live-2');
    check('emergency stop needs a reason', I.rollbackRulesEmergency('').status === 400);
    check('emergency stop works from the server', I.rollbackRulesEmergency('bad calibration').status === 200 && !getLiveDetectorPatch().patch && I.verifyRulesAudit().ok);
  });

  // One person, every role, random action sequences. Whatever two people decided must still stand.
  for (const role of ['analyst', 'reviewer', 'legal', 'admin'] as auth.Role[]) await section(`one ${role} acting alone`, async () => {
    const x = open(front()); restrict(x);
    const y = open(honest()); confirm(y, 'merchant_dispute');
    const key = createServiceKey('client-a', ['cases']).key, z = (await v1(key, 'POST', '/v1/cases', moonlight())).body.id as string;
    saveLiveRules({ A4: { sensitivity: 0.9 } }, 'walk-live');
    const solo = auth.createUser('oi-solo', pw, role), r = mulberry32(7000 + role.length), cases = [x, y, z], broken = new Set<string>();
    const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
    const files = [front, honest, moonlight];
    for (let step = 0; step < 700 && !broken.size; step++) {
      const id = pick(cases), op = Math.floor(r() * 10);
      if (op === 0 && cases.length < 14) { const made = W.openInvestigation(pick(files)(), solo); if (made.status === 200) cases.push(made.body.id as string); }
      else if (op === 1 || op === 2) W.respondInvestigation(id, { chosenLevel: pick(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']) }, solo);
      else if (op === 3) W.approveInvestigation(id, { approve: pick([true, false]) }, solo);
      else if (op === 4) W.labelInvestigation(id, pick<any>([{ label: 'CONFIRMED_ILLICIT' }, { label: 'ADJUDICATED_BENIGN' }, { label: 'UNRESOLVED' }, { label: 'ADJUDICATED_BENIGN', origin: 'merchant_dispute' }, { reject: true }]), solo);
      else if (op === 5 || op === 6 || op === 7) {
        const list = now(id).scenario.passports ?? [], p = list.length ? pick<any>(list) : null;
        if (op === 5 && p) P.reviewPassport(id, { passportId: p.id, verify: true }, solo);
        else if (op === 6 && p) P.proposePassport(id, { endorse: p.id }, solo);
        else if (op === 7) P.proposePassport(id, { linkId: now(id).scenario.events.find((e: any) => e.linkId)?.linkId, reason: 'r', document: 'd', from: '2026-10-15', hours: [22, 2] }, solo);
      } else if (op === 8) I.rollbackRulesLive(solo, pick<any>([undefined, {}]));
      else if (op === 9) { await Promise.resolve(); analyzeDataset(pick(files)()); }
      if (step % 10 && step < 699) continue;
      syncLiveRules();
      if (now(x).inForce?.level !== 'L3') broken.add('lifted a restriction');
      if (now(y).user.label !== 'CONFIRMED_ILLICIT') broken.add('changed a final label');
      if (getLiveDetectorPatch().version !== 'walk-live') broken.add('rolled rules back');
      for (const c of cases.map(now)) {
        if (c.id !== x && c.inForce?.restricts) broken.add('imposed a restriction');
        if (c.id !== y && ['CONFIRMED_ILLICIT', ...(c.merchant.id === now(y).merchant.id || c.merchant.id === now(x).merchant.id ? ['ADJUDICATED_BENIGN'] : [])].includes(c.user.label)) broken.add('decided a label');
        if (c.scenario.passports?.some((p: any) => p.status === 'VERIFIED')) broken.add('verified a passport');
      }
    }
    check(`one ${role} alone cannot override two people`, !broken.size, [...broken].join(', '));
  });

  await section('engine', () => {
    const d = moonlight(); d.contextPassports[0].status = 'REVOKED';
    const sc = datasetToScenario(d, { trustPassports: true }).scenario!;
    check('a revoked passport explains nothing', runInvestigation(sc).fusion.followUp === 'ASK');
  });

  resetDb(); saveLiveRules(null, null); resetDb();
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  for (const d of temp) rmSync(d, { recursive: true, force: true });
  return bad;
}
