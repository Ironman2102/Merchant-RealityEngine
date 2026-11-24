/** What the product says about itself, as tests: two people to close, detectable tampering, privacy, isolation, determinism. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseCsv } from '../../adapters/csv';
import { loadHashKey } from '../../adapters/pseudonym';
import { analyzeDataset } from '../../backend/src/algorithms/analyze';
import * as auth from '../../backend/src/auth';
import { getDb, resetDb } from '../../backend/src/db';
import { handle } from '../../backend/src/http';
import * as improverApi from '../../backend/src/improverApi';
import * as passportApi from '../../backend/src/passports';
import { saveLiveRules, syncLiveRules } from '../../backend/src/rulesState';
import { createServiceKey, revokeServiceKey, authenticateServiceKey } from '../../backend/src/serviceKeys';
import { verifyAudit, appendAudit } from '../../backend/src/store';
import { caseTrace, evidencePack } from '../../backend/src/trace';
import { handleV1 } from '../../backend/src/v1';
import * as W from '../../backend/src/workflow';
import { runBatch } from '../../cli/batch';
import { analyze } from '../../engine/index';

const load = (f: string): any => JSON.parse(readFileSync(join('frontend/public/samples', f), 'utf8'));
const front = () => load('01-sweet-crumbs-betting-front.json');
const oven = () => load('10-golden-oven-betting-on-the-side.json');
const moonlight = () => load('11-moonlight-bakes-honest-change.json');
const honest = () => load('07-udupi-tiffin-steady.json');
const MAPPING = 'adapters/mappings/generic-pa-v1.json';

export default async function (): Promise<number> {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); } else console.log(`  ✓ ${name}`); };
  const refused = (fn: () => any) => { try { const r = fn(); return typeof r?.status === 'number' && r.status >= 400; } catch { return true; } };
  const saved = { ...process.env }, temp: string[] = [];
  const dir = () => { const d = mkdtempSync(join(tmpdir(), 'mre-claims-')); temp.push(d); return d; };
  process.env.MRE_CASE_STORE = 'memory';
  process.env.MRE_HASH_KEY = 'claims-only-hash-key-9f2c4e7a';
  delete process.env.MRE_WORKFLOW_DIR;
  const pw = 'claims-only-login-value-Q7';
  let ana: auth.Actor, rev: auth.Actor;
  const section = async (name: string, fn: () => void | Promise<void>) => {
    resetDb();
    try { ana = auth.createUser('cl-ana', pw, 'analyst'); rev = auth.createUser('cl-rev', pw, 'reviewer'); await fn(); }
    catch (e) { check(name, false, `threw: ${e instanceof Error ? e.message.slice(0, 200) : e}`); }
  };
  const open = (d: unknown) => W.openInvestigation(d, ana).body.id as string;
  const now = (id: string) => W.getInvestigation(id).body as any;
  const sql = (q: string, ...a: any[]) => getDb().prepare(q).run(...a);
  const go = (id: string, chosenLevel: string) => W.respondInvestigation(id, { chosenLevel }, ana);

  for (const [name, file, levels, free] of [['restriction case', oven, ['L0', 'L1', 'L2'], null], ['question', moonlight, ['L0'], 'L1'], ['due-diligence case', () => load('03-fabricated-online-store.json'), ['L0', 'L1'], 'L2']] as const) {
    await section(`closing a ${name}`, () => {
      for (const level of levels) {
        const id = open(file()); go(id, level);
        check(`${name}: ${level} alone waits`, !!now(id).pending.response && !now(id).user.executed);
        check(`${name}: proposer cannot approve ${level}`, W.approveInvestigation(id, { approve: true }, ana).status === 403);
        check(`${name}: a second person can approve ${level}`, W.approveInvestigation(id, { approve: true }, rev).status === 200 && now(id).user.executed);
      }
      if (free) { const id = open(file()); go(id, free); check(`${name}: recommended ${free} needs nobody else`, now(id).user.executed); }
      for (const label of ['UNRESOLVED', 'ADJUDICATED_BENIGN']) {
        const id = open(file()); W.labelInvestigation(id, { label }, ana);
        check(`${name}: ${label} alone waits`, !now(id).user.label && !!now(id).pending.label);
      }
    });
  }
  await section('no finding', () => {
    const id = open(honest()); go(id, 'L0');
    check('nothing to explain: L0 needs nobody else', now(id).user.executed);
  });
  await section('question returns', () => {
    const id = open(moonlight()), p = now(id).scenario.passports[0];
    passportApi.reviewPassport(id, { passportId: p.id, verify: true }, rev);
    W.labelInvestigation(id, { label: 'ADJUDICATED_BENIGN' }, ana); go(id, 'L0');
    passportApi.revokePassport(id, { passportId: p.id, reason: 'document not confirmed' }, rev);
    check('a returned question is open again', !now(id).user.label && !now(id).user.executed && now(id).result.followUp === 'ASK');
  });
  await section('approve what was seen', async () => {
    const srv = createServer((q, s) => void handle(q, s)).listen(0, '127.0.0.1');
    await new Promise(r => srv.once('listening', r));
    try {
      const id = open(oven()); go(id, 'L3');
      const seen = now(id).pending.response;
      await new Promise(r => setTimeout(r, 5)); go(id, 'L0');
      const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api`, cookie = `mre_session=${auth.login('cl-rev', pw)!.token}`;
      const post = async (body: object) => (await fetch(`${base}/investigations/${id}/approve`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) })).status;
      check('a swapped proposal is not approved', await post({ approve: true, proposedAt: seen.at, level: seen.level }) === 409);
      check('an approval must name what it approves', await post({ approve: true }) === 409);
      const current = now(id).pending.response;
      check('the proposal on screen can be approved', await post({ approve: true, proposedAt: current.at, level: current.level }) === 200);
    } finally { await new Promise(r => srv.close(r)); }
  });
  await section('proposals cannot be buried', () => {
    const base = { kind: 'threshold', patch: {}, rationale: '', backtest: {}, requestedBy: { id: ana.id, username: ana.username }, baseVersion: 'x', livePatch: {} };
    const save = (improverApi as any).saveProposal;
    for (let i = 0; i < 25; i++) save({ ...base, id: `P-${i}`, createdAt: new Date(1_700_000_000_000 + i * 1000).toISOString(), status: 'proposed' });
    check('an older proposal can still be decided', improverApi.approveRuleProposal('P-0', rev).status === 200);
  });

  // Tampering: whoever can write the database but does not hold the server key.
  const withCase = () => { const id = open(front()); return id; };
  const edits: [string, (id: string) => void][] = [
    ['decision in the record', id => sql(`UPDATE cases SET record_json = replace(record_json, '"decision":"OPEN_CASE"', '"decision":"NO_CASE"') WHERE id = ?`, id)],
    ['decision column', id => sql("UPDATE cases SET decision = 'NO_CASE' WHERE id = ?", id)],
    ['merchant column', id => sql("UPDATE cases SET merchant_key = 'M-ELSE' WHERE id = ?", id)],
    ['audit row', id => sql("UPDATE audit SET actor = 'someone-else' WHERE case_id = ?", id)],
    ['audit rows and head deleted', id => { sql('DELETE FROM audit WHERE case_id = ?', id); sql('DELETE FROM audit_heads WHERE case_id = ?', id); }],
    ['audit rows, head and its seal deleted', id => { sql('DELETE FROM audit WHERE case_id = ?', id); sql('DELETE FROM audit_heads WHERE case_id = ?', id); sql("DELETE FROM row_seals WHERE tbl = 'audit_heads' AND key = ?", id); }],
  ];
  for (const [name, edit] of edits) await section(`tamper: ${name}`, () => {
    const id = withCase(); edit(id);
    check(`tamper detected: ${name}`, !verifyAudit(id).ok && now(id).auditIntact === false);
    check(`tampered case takes no writes: ${name}`, refused(() => W.reviewInvestigation(id, { notes: 'x' }, ana)) && refused(() => evidencePack(id, rev)));
  });
  await section('tamper: trace', async () => {
    const id = withCase();
    sql("UPDATE cases SET decision = 'NO_CASE' WHERE id = ?", id);
    let no = false;
    try { no = (await caseTrace(id)).status >= 400; } catch { no = true; }
    check('a tampered case gives no trace', no);
  });
  await section('tamper: laundering', () => {
    const id = withCase();
    sql("UPDATE audit SET detail = 'edited' WHERE case_id = ?", id);
    check('appending cannot re-seal an edited trail', refused(() => appendAudit(id, [{ action: 'x', detail: '' }], ana)) && !verifyAudit(id).ok);
  });
  await section('tamper: case deleted', () => {
    const gone = withCase(), kept = open(honest());
    sql('PRAGMA foreign_keys = OFF'); sql('DELETE FROM cases WHERE id = ?', gone); sql("DELETE FROM row_seals WHERE tbl = 'cases' AND key = ?", gone);
    check('a deleted case is noticed', !verifyAudit(kept).ok);
  });
  const scores: [string, () => void][] = [
    ['rules inserted', () => sql('INSERT INTO rules_state VALUES (1, ?, ?)', 'forged', JSON.stringify({ B8: { minEffect: 9 } }))],
    ['rules edited', () => { saveLiveRules({ A4: { sensitivity: 0.9 } }, 'real'); sql("UPDATE rules_state SET patch_json = '{}'"); }],
    ['rules deleted with their seal', () => { saveLiveRules({ A4: { sensitivity: 0.9 } }, 'real'); sql('DELETE FROM rules_state'); sql("DELETE FROM row_seals WHERE tbl = 'rules_state'"); }],
    ['passport forged', () => {
      const id = open(moonlight()), p = { ...now(id).scenario.passports[0], status: 'VERIFIED', ref: `${id}:forged` };
      sql('INSERT INTO passports (id, case_id, merchant_id, passport_json) VALUES (?, ?, ?, ?)', p.ref, id, now(id).merchant.id, JSON.stringify(p));
    }],
  ];
  for (const [name, edit] of scores) await section(`tamper: ${name}`, () => {
    edit();
    check(`scoring stops: ${name}`, refused(() => { syncLiveRules(); return analyzeDataset(moonlight()); }));
    saveLiveRulesQuietly();
  });
  await section('tamper: proposal', () => {
    sql('INSERT INTO rules_proposals (id, created_at, created_by, status, approved_by, promoted_version, proposal_json) VALUES (?, ?, ?, ?, NULL, NULL, ?)', 'P-F', new Date().toISOString(), 'x', 'approved',
      JSON.stringify({ id: 'P-F', status: 'approved', requestedBy: { id: 99, username: 'x' }, baseVersion: 'x', livePatch: {} }));
    check('a forged proposal cannot be used', refused(() => improverApi.promoteRuleProposal('P-F', rev)) && !improverApi.verifyRulesAudit().ok);
  });
  await section('tamper: accounts', () => {
    const { token } = auth.login('cl-ana', pw)!;
    sql("UPDATE users SET role = 'admin' WHERE username = 'cl-ana'");
    check('an edited role gets no access', auth.actorFromToken(token) === null && auth.login('cl-ana', pw) === null);
    sql('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', createHash('sha256').update('forged').digest('hex'), rev.id, Date.now() + 1e7);
    check('a planted session gets no access', auth.actorFromToken('forged') === null);
    const k = createServiceKey('client-a', ['score']);
    sql("UPDATE service_keys SET scopes = 'score,cases,read' WHERE id = ?", k.id);
    check('an edited service key gets no access', authenticateServiceKey(`Bearer ${k.key}`) === null);
  });
  await section('tamper: seals dropped and restarted', () => {
    resetDb(); delete process.env.MRE_CASE_STORE; process.env.MRE_DB_FILE = join(dir(), 'x.db');
    try {
      ana = auth.createUser('cl-ana', pw, 'analyst');
      const id = open(front());
      getDb().exec('DROP TABLE audit_heads');
      resetDb();
      check('a dropped seal table is not rebuilt as trusted', !verifyAudit(id).ok);
      getDb().exec('DELETE FROM row_seals; DELETE FROM manifests');
      resetDb();
      check('an unsealed database is not blessed on restart', !verifyAudit(id).ok);
    } finally { resetDb(); process.env.MRE_CASE_STORE = 'memory'; delete process.env.MRE_DB_FILE; }
  });

  await section('tamper: trigger', () => {
    getDb().exec("CREATE TRIGGER forge AFTER INSERT ON users BEGIN UPDATE users SET role = 'admin' WHERE id = NEW.id; END");
    check('a planted trigger cannot get its change sealed', refused(() => auth.createUser('cl-new', pw, 'analyst')));
  });
  await section('tamper: replay', () => {
    const k = createServiceKey('client-a', ['score']);
    const was = getDb().prepare("SELECT mac FROM row_seals WHERE tbl = 'service_keys' AND key = ?").get(k.id) as { mac: string };
    revokeServiceKey(k.id);
    sql('UPDATE service_keys SET revoked = 0 WHERE id = ?', k.id);
    sql("UPDATE row_seals SET mac = ? WHERE tbl = 'service_keys' AND key = ?", was.mac, k.id);
    check('a revoked key cannot be replayed with its old seal', authenticateServiceKey(`Bearer ${k.key}`) === null);
  });
  await section('tamper: registry on revoke', () => {
    const id = open(moonlight()), p = now(id).scenario.passports[0];
    passportApi.reviewPassport(id, { passportId: p.id, verify: true }, rev);
    sql('DELETE FROM passports');
    check('revoking over a deleted registry is refused', refused(() => passportApi.revokePassport(id, { passportId: p.id, reason: 'forged' }, rev)));
  });

  await section('privacy', () => {
    const secrets = ['9000012345', '+91 90000 67890', 'ABCPE1234F', 'person@okbank', '2345 6789 0123', 'owner.name@example.com', '9000055555', '8000011111'];
    const d = front();
    d.merchant.ownerPhone = secrets[0]; d.merchant.category = `Bakery (call ${secrets[1]})`;
    d.kyc = { pan: secrets[2] }; d.title = `Upload for ${secrets[5]}`;
    d.orders = [...(d.orders ?? []), { orderId: secrets[6], saleId: 'x', status: 'DELIVERED', customer: secrets[3], aadhaar: secrets[4] }];
    d.transactions[0].orderId = 8000011111;
    d.transactions[0].note = secrets[2];
    d.externalSightings = [{ source: 'forum', place: `pay ${secrets[3]}`, paymentRef: 'PL-X', seenAt: '2026-10-01', note: secrets[4] }];
    const opened = W.openInvestigation(d, ana);
    check('the file is still scored', opened.status === 200 && (opened.body.result as any).decision === 'OPEN_CASE');
    const id = opened.body.id as string;
    W.reviewInvestigation(id, { notes: `called ${secrets[1]}`, clarification: secrets[3] }, ana);
    const link = now(id).scenario.events.find((e: any) => e.linkId).linkId;
    passportApi.proposePassport(id, { linkId: link, reason: secrets[5], document: `PAN ${secrets[2]}`, from: '2026-10-01', hours: [22, 2] }, ana);
    W.respondInvestigation(id, { chosenLevel: 'L3' }, ana);
    W.approveInvestigation(id, { approve: false, reason: secrets[0] }, rev);
    const everything = ['cases', 'audit', 'passports', 'idempotency', 'label_events'].map(t => JSON.stringify(getDb().prepare(`SELECT * FROM ${t}`).all())).join();
    for (const s of secrets) check(`not stored: ${s.slice(0, 3)}… (${s.length} characters)`, !everything.includes(s));

    const inDir = dir(), out = dir(); cpSync('examples/generic-pa', inDir, { recursive: true });
    const m = JSON.parse(readFileSync(MAPPING, 'utf8')), file = join(inDir, m.files.merchants);
    writeFileSync(file, readFileSync(file, 'utf8').replace('Sweet Crumbs Bakery', 'Sweet Crumbs 9000012345'));
    runBatch({ inDir, mappingPath: MAPPING, outDir: out, key: loadHashKey() });
    check('not written by batch', !['scores.csv', 'run.json', 'packs/M-SCB-001.json'].some(f => readFileSync(join(out, f), 'utf8').includes('9000012345')));
  });

  await section('client isolation', async () => {
    const key = createServiceKey('client-b', ['cases']).key;
    const call = (method: string, path: string, body: unknown = {}) => handleV1({ method, path, body, header: n => (n === 'authorization' ? `Bearer ${key}` : undefined) }) as Promise<any>;
    const staff = open(oven()), theirs = (await call('POST', '/v1/cases', oven())).body.id as string;
    go(theirs, 'L3'); W.approveInvestigation(theirs, { approve: true }, rev);
    W.reviewInvestigation(theirs, { notes: `same merchant as ${staff}` }, ana);
    go(staff, 'L0');
    check('a pending lift exists', !!now(staff).pending.response);
    W.approveInvestigation(staff, { approve: true }, rev);
    go(theirs, 'L0');
    for (const tail of ['', '/trace', '/pack']) {
      const seen = await call('GET', `/v1/cases/${theirs}${tail}`);
      check(`no other case id reaches a client${tail}`, seen.status === 200 && !JSON.stringify(seen.body).includes(staff));
    }
  });

  await section('time', () => {
    const tz = process.env.TZ, results: string[] = [];
    for (const file of [oven, moonlight, front]) for (const stamp of [(t: string) => t, (t: string) => t.slice(0, 19)]) {
      const each = ['Asia/Kolkata', 'UTC', 'America/Los_Angeles'].map(zone => {
        process.env.TZ = zone;
        const d = file();
        for (const t of d.transactions) { t.time = stamp(t.time); if (t.settledAt) t.settledAt = stamp(t.settledAt); }
        d.matchFixtures = (d.matchFixtures ?? []).map(stamp);
        const r: any = analyze(d);
        return `${r.result.fusion.decision}:${r.result.fusion.posterior}`;
      });
      results.push(...each);
      check(`same score in every host timezone (${d0(file())}${stamp('2026-10-01T00:00:00+05:30').length === 19 ? ', no offset' : ''})`, new Set(each).size === 1, each.join(' '));
    }
    for (let i = 0; i < results.length; i += 6) check(`a time without an offset is IST (${i / 6})`, results[i] === results[i + 3]);
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  });

  await section('report drafts', () => {
    const id = open(front());
    check('an open case drafts a report', (evidencePack(id, rev).body as any).strDraft.groundsOfSuspicion.length > 0);
    W.labelInvestigation(id, { label: 'ADJUDICATED_BENIGN' }, ana); W.labelInvestigation(id, { label: 'ADJUDICATED_BENIGN' }, rev);
    for (const [name, c] of [['cleared', id], ['no-case', open(honest())], ['question', open(moonlight())]]) {
      const draft = (evidencePack(c, rev).body as any).strDraft;
      check(`${name}: no suspicion is drafted`, !draft.groundsOfSuspicion.length && /not for filing/i.test(draft.status));
    }
  });

  await section('bad export rows', () => {
    const mapping = JSON.parse(readFileSync(MAPPING, 'utf8'));
    const col = (head: string[], spec: any) => head.indexOf(typeof spec === 'string' ? spec : spec.column);
    const batch = (edit: (inDir: string) => void) => {
      const inDir = dir(), out = dir(); cpSync('examples/generic-pa', inDir, { recursive: true }); edit(inDir);
      runBatch({ inDir, mappingPath: MAPPING, outDir: out, key: loadHashKey() });
      const [head, ...rows] = parseCsv(readFileSync(join(out, 'scores.csv'), 'utf8'));
      return (column: string) => rows.find(r => r[0] === 'M-SCB-001')?.[head.indexOf(column)];
    };
    const addRow = (change: Record<string, string>) => (inDir: string) => {
      const f = join(inDir, mapping.files.transactions), lines = readFileSync(f, 'utf8').trimEnd().split('\n');
      const head = lines[0].split(mapping.delimiter), row = lines.find(l => l.includes('M-SCB-001'))!.split(mapping.delimiter);
      for (const [k, v] of Object.entries(change)) row[col(head, mapping.transactions[k])] = v;
      writeFileSync(f, [...lines, row.join(mapping.delimiter)].join('\n') + '\n');
    };
    const setMerchant = (change: Record<string, string>) => (inDir: string) => {
      const f = join(inDir, mapping.files.merchants), lines = readFileSync(f, 'utf8').trimEnd().split('\n');
      const head = lines[0].split(mapping.delimiter), i = lines.findIndex(l => l.includes('M-SCB-001')), row = lines[i].split(mapping.delimiter);
      for (const [k, v] of Object.entries(change)) row[col(head, mapping.merchants[k])] = v;
      lines[i] = row.join(mapping.delimiter); writeFileSync(f, lines.join('\n') + '\n');
    };
    const setContext = (change: (c: any) => void) => (inDir: string) => {
      const f = join(inDir, 'context.json'), c = JSON.parse(readFileSync(f, 'utf8')); change(c.byMerchant['M-SCB-001']); writeFileSync(f, JSON.stringify(c));
    };
    const cases: [string, (d: string) => void][] = [
      ['repeated row', addRow({})], ['reused id', addRow({ amount: '777' })], ['negative sale', addRow({ id: 'X1', amount: '-5' })],
      ['amount above the cap', addRow({ id: 'X2', amount: '999999999999' })], ['row without an id', addRow({ id: '' })],
      ['stray quote', d => { const f = join(d, mapping.files.merchants); writeFileSync(f, readFileSync(f, 'utf8').replace('Sweet Crumbs Bakery', 'Sweet 5" Crumbs')); }],
      ['bad category code', setMerchant({ mcc: '54x2' })], ['blank name', setMerchant({ name: '' })], ['impossible hours', setMerchant({ openHour: '9', closeHour: '9' })],
      ['ticket range reversed', setMerchant({ ticketMin: '5000', ticketMax: '10' })],
      ['bad passport in context', setContext(c => { c.contextPassports = [{ id: 'P' }]; })],
      ['bad weekly row', d => { const f = join(d, mapping.files.weekly); writeFileSync(f, readFileSync(f, 'utf8').trimEnd() + `\nM-SCB-001${mapping.delimiter}${mapping.delimiter}oops\n`); }],
      ['broken context file', d => writeFileSync(join(d, 'context.json'), '{ not json')],
      ['bad context field', setContext(c => { c.orders = 'none'; })],
    ];
    for (const [name, edit] of cases) {
      const cell = batch(edit);
      check(`still scored, still a case: ${name}`, cell('decision') === 'OPEN_CASE', String(cell('decision') ?? 'missing'));
    }
    check('skipped rows are counted', Number(batch(addRow({ id: 'X3', amount: '-5' }))('rows_skipped')) === 1);
  });

  resetDb();
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  for (const d of temp) rmSync(d, { recursive: true, force: true });
  resetDb();
  return bad;

  function d0(d: any): string { return d.merchant.id; }
  /** The database may be deliberately broken here, so only the process's copy of the rules is cleared. */
  function saveLiveRulesQuietly(): void { resetDb(); syncLiveRules(); }
}
