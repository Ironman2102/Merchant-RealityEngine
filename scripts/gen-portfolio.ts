/**
 * Synthetic portfolio in the generic PA layout. Parameters are seeds, not copies of rules/*.json.
 * Usage: npx tsx scripts/gen-portfolio.ts --n 1000 --seed 7 --out examples/portfolio
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeLayout } from './export-pa-files';
import type { MreDataset } from '../frontend/src/data/dataset';
import { mulberry32 } from '../frontend/src/utils/prng';

const GENUINE = ['04-anand-sweets-diwali-genuine.json', '06-shree-ganesh-sweets-genuine.json', '07-udupi-tiffin-steady.json', '08-nandi-kirana-genuine.json'];
const FRONTS: { file: string; typology: string }[] = [
  { file: '01-sweet-crumbs-betting-front.json', typology: 'betting' },
  { file: '02-merchant-rotation.json', typology: 'rotation' },
  { file: '03-fabricated-online-store.json', typology: 'fabricated' },
  { file: '05-chai-corner-night-betting.json', typology: 'night-betting' },
  { file: '09-telegram-betting-no-website.json', typology: 'telegram' },
];
const CITIES: { city: string; state: string; tier: 1 | 2 | 3 }[] = [
  { city: 'Mumbai, India', state: 'MH', tier: 1 }, { city: 'Delhi, India', state: 'DL', tier: 1 },
  { city: 'Bengaluru, India', state: 'KA', tier: 1 }, { city: 'Chennai, India', state: 'TN', tier: 1 },
  { city: 'Hyderabad, India', state: 'TS', tier: 1 }, { city: 'Pune, India', state: 'MH', tier: 2 },
  { city: 'Jaipur, India', state: 'RJ', tier: 2 }, { city: 'Lucknow, India', state: 'UP', tier: 2 },
  { city: 'Indore, India', state: 'MP', tier: 2 }, { city: 'Nagpur, India', state: 'MH', tier: 2 },
  { city: 'Mysuru, India', state: 'KA', tier: 3 }, { city: 'Udaipur, India', state: 'RJ', tier: 3 },
];

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const n = Number(arg('--n', '1000'));
const seed = Number(arg('--seed', '7'));
const out = arg('--out', 'examples/portfolio');
const r = mulberry32(seed);
const samples = new Map(readdirSync('frontend/public/samples').filter(f => /^0[1-9]-/.test(f)).map(f => [f, JSON.parse(readFileSync(join('frontend/public/samples', f), 'utf8')) as MreDataset]));

const datasets: MreDataset[] = [];
const truth: string[] = ['merchant_id,label,typology,city_tier'];
for (let i = 1; i <= n; i++) {
  const front = r() < 0.06;
  const pick = front ? FRONTS[Math.floor(r() * FRONTS.length)] : { file: GENUINE[Math.floor(r() * GENUINE.length)], typology: 'genuine' };
  const base = samples.get(pick.file)!;
  const d = JSON.parse(JSON.stringify(base)) as MreDataset;
  const id = `M-PF-${String(i).padStart(4, '0')}`;
  const place = CITIES[Math.floor(r() * CITIES.length)];
  const old = d.merchant.id;
  d.merchant = { ...d.merchant, id, name: `Merchant ${String(i).padStart(4, '0')}`, city: place.city, localStates: [place.state] };
  d.transactions.forEach(t => { if (t.merchantId === old) t.merchantId = id; });
  const shift = Math.floor(r() * 30) * 86_400_000;
  const keep = 0.7 + r() * 0.3;
  d.transactions = d.transactions.filter(t => t.merchantId !== id || t.type !== 'SALE' || r() < keep).map(t => {
    const amount = t.amount % 500 === 0 ? t.amount : Math.max(1, Math.round(t.amount * (0.85 + r() * 0.3)));
    const time = new Date(Date.parse(t.time) + shift).toISOString().replace('Z', '+00:00');
    return { ...t, amount, time };
  });
  if (!front && r() < 0.3) {
    const sales = d.transactions.filter(t => t.merchantId === id && t.type === 'SALE');
    const mode = Math.floor(r() * 4);
    if (mode === 0) for (const s of sales) if (r() < 0.3) s.payerState = CITIES[Math.floor(r() * CITIES.length)].state;
    if (mode === 1) for (const s of sales) if (r() < 0.3) s.amount = r() < 0.5 ? 500 : 1000;
  }
  datasets.push(d);
  truth.push(`${id},${front ? 1 : 0},${pick.typology},${place.tier}`);
}
writeLayout(out, datasets, 'generic');
const truthDir = 'examples/portfolio-truth';
mkdirSync(truthDir, { recursive: true });
writeFileSync(join(truthDir, 'truth.csv'), truth.join('\n') + '\n');
writeFileSync(join(truthDir, 'tiers.json'), JSON.stringify(Object.fromEntries(truth.slice(1).map(line => { const [id, , , tier] = line.split(','); return [id, Number(tier)]; }))));
console.log(`wrote ${n} merchants to ${out}`);
