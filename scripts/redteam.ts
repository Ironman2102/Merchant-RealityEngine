/** A short red-team pass: thin a front until it is no-case, and record the rate with a Wilson interval. Synthetic. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { MreDataset } from '../frontend/src/data/dataset';
import { analyze } from '../engine/index';

function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 1];
  const p = k / n, den = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / den;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / den;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

const base = JSON.parse(readFileSync('frontend/public/samples/09-telegram-betting-no-website.json', 'utf8')) as MreDataset;
const variants = 24;
let evaded = 0;
const lines: string[] = [];
for (let i = 0; i < variants; i++) {
  const d = structuredClone(base);
  const old = d.merchant.id;
  d.merchant = { ...d.merchant, id: `M-RT-${i}` };
  d.transactions.forEach(t => { if (t.merchantId === old) t.merchantId = d.merchant.id; });
  const sales = d.transactions.filter(t => t.type === 'SALE');
  const keep = Math.max(8, Math.floor(sales.length * (0.08 + (i % 5) * 0.01)));
  const ids = new Set(sales.slice(0, keep).map(t => t.id));
  d.transactions = d.transactions.filter(t => t.type !== 'SALE' || ids.has(t.id));
  const ran = analyze(d);
  const decision = ran.ok ? ran.result.fusion.decision : 'ERROR';
  const p = ran.ok ? ran.result.fusion.posterior : 0;
  if (decision === 'NO_CASE') evaded++;
  lines.push(JSON.stringify({ baseMerchantId: base.merchant.id, operators: ['thinSales'], cost: 5, posterior: p, decision }));
}
const ci = wilson(evaded, variants);
const text = `# Red team (synthetic)

**Synthetic.** ${variants} thinned copies of the Telegram betting sample. This is not a live attacker.

- Evasion rate ${evaded}/${variants} = ${(evaded / variants).toFixed(3)}, Wilson 95% ${ci[0].toFixed(3)}–${ci[1].toFixed(3)}
- Operator: thinSales (keep about 8–12% of sales). Attacker cost 5 in rules/redteam.json units.
- Backstop: lowering minN inside its band catches this evasion. See \`mre demo:learn\`.
`;
mkdirSync('reports', { recursive: true });
mkdirSync('examples/redteam', { recursive: true });
writeFileSync('reports/redteam.md', text);
writeFileSync('examples/redteam/evasions.jsonl', lines.join('\n') + '\n');
console.log(text);
