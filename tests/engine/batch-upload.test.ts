/** A batch file name is a basename. ../ and absolute paths are not written. */
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleV1 } from '../../backend/src/v1';
import { resetDb } from '../../backend/src/db';
import { createServiceKey } from '../../backend/src/serviceKeys';

export default async function (): Promise<number> {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); } else console.log(`  ✓ ${name}`); };
  const prev = process.env.MRE_CASE_STORE;
  process.env.MRE_CASE_STORE = 'memory';
  resetDb();
  const { key } = createServiceKey('batch-path', ['batch']);
  const header = (name: string) => name.toLowerCase() === 'authorization' ? `Bearer ${key}` : undefined;
  const probes = [join(tmpdir(), `mre-batch-abs-${process.pid}.txt`), join(tmpdir(), `mre-batch-up-${process.pid}.txt`)];
  for (const p of probes) if (existsSync(p)) rmSync(p);
  try {
    for (const name of [probes[0], `../${probes[1].split('/').pop()}`]) {
      const opened = await handleV1({ method: 'POST', path: '/v1/batches', header, body: { mapping: 'adapters/mappings/generic-pa-v1.json', files: { [name]: Buffer.from('nope').toString('base64') } } });
      if (!opened) throw new Error('batch route missing');
      const id = opened.body.batchId as string;
      let status = '';
      for (let i = 0; i < 50 && status !== 'error' && status !== 'done'; i++) {
        const got = await handleV1({ method: 'GET', path: `/v1/batches/${id}`, header, body: {} });
        if (!got) throw new Error('batch status route missing');
        status = String(got.body.status ?? '');
        if (status !== 'error' && status !== 'done') await new Promise(r => setTimeout(r, 20));
      }
      check(`rejected ${name.includes('..') ? 'parent' : 'absolute'} batch name`, status === 'error');
    }
    check('absolute path was not written', !existsSync(probes[0]));
    check('parent path was not written', !existsSync(probes[1]));
  } finally {
    for (const p of probes) if (existsSync(p)) rmSync(p);
    if (prev === undefined) delete process.env.MRE_CASE_STORE; else process.env.MRE_CASE_STORE = prev;
    resetDb();
  }
  return bad;
}
