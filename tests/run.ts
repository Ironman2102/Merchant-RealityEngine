/** Runs every tests/**\/*.test.ts file plus the SciPy reference fixtures. Exit 1 on any failure. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as S from './stats/all';

let fails = 0, n = 0;
const ref = JSON.parse(readFileSync('tests/stats/fixtures/reference.json', 'utf8')) as { fn: string; args: unknown[]; expect: number | number[]; tol: number }[];
for (const c of ref) {
  n++;
  const f = (S as Record<string, (...a: unknown[]) => unknown>)[c.fn];
  if (!f) { fails++; console.log(`MISSING ${c.fn}`); continue; }
  const got = f(...c.args) as number | number[] | { p: number };
  const g = typeof got === 'object' && !Array.isArray(got) ? got.p : got;
  const exp = Array.isArray(c.expect) ? c.expect : [c.expect], val = Array.isArray(g) ? g : [g];
  const ok = exp.length === val.length && exp.every((e, i) => Math.abs(e - val[i]) <= c.tol);
  if (!ok) { fails++; console.log(`FAIL ${c.fn}(${JSON.stringify(c.args)}) expected ${JSON.stringify(c.expect)} got ${JSON.stringify(g)}`); }
}
const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.test.ts') ? [p] : []; });
for (const file of walk('tests')) {
  const mod = await import('../' + file) as { default?: () => number | Promise<number> };
  const bad = mod.default ? await mod.default() : 0; n++; if (bad) { fails += bad; console.log(`FAIL ${file}: ${bad} assertion(s)`); }
}
console.log(`${n - fails}/${n} stats checks passed`);
process.exit(fails ? 1 : 0);
