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
  const homeFrom = d.merchant.localStates[0] ?? 'KA';
  const homeTo = place.state;
  const swapState = (st?: string) => (st === homeFrom ? homeTo : st === homeTo ? homeFrom : st);
  d.merchant = { ...d.merchant, id, name: `Merchant ${String(i).padStart(4, '0')}`, city: place.city, localStates: [homeTo] };
  const shiftDays = Math.floor(r() * 30);
  const shift = shiftDays * 86_400_000;
  const shiftIso = (iso: string) => new Date(Date.parse(iso) + shift).toISOString().replace('Z', '+00:00');
  const keep = 0.7 + r() * 0.3;
  const droppedSales = new Set<string>();
  for (const t of d.transactions) {
    if (t.merchantId === old && t.type === 'SALE' && r() >= keep) droppedSales.add(t.id);
  }
  const amountBySale = new Map<string, number>();
  d.transactions = d.transactions
    .filter(t => !droppedSales.has(t.id) && !(t.refundOfTransactionId && droppedSales.has(t.refundOfTransactionId)))
    .map(t => {
      const merchantId = t.merchantId === old ? id : t.merchantId;
      let amount = t.amount;
      if (t.type === 'SALE') {
        amount = t.amount % 500 === 0 ? t.amount : Math.max(1, Math.round(t.amount * (0.85 + r() * 0.3)));
        amountBySale.set(t.id, amount);
      } else if (t.type === 'REFUND' && t.refundOfTransactionId && amountBySale.has(t.refundOfTransactionId)) {
        amount = amountBySale.get(t.refundOfTransactionId)!;
      }
      const time = shiftIso(t.time);
      const settledAt = t.settledAt ? shiftIso(t.settledAt) : undefined;
      const payerState = swapState(t.payerState);
      return { ...t, merchantId, amount, time, ...(settledAt ? { settledAt } : {}), ...(payerState ? { payerState } : {}) };
    });
  if (d.orders) d.orders = d.orders.filter(o => !droppedSales.has(o.saleId));
  if (d.weeklySales) {
    d.weeklySales = d.weeklySales.map(w => ({
      ...w,
      week: /^\d{4}-\d{2}-\d{2}$/.test(w.week) ? shiftIso(`${w.week}T00:00:00+05:30`).slice(0, 10) : w.week,
      actual: w.actual === null ? null : Math.round(w.actual * keep),
    }));
  }
  if (d.matchFixtures) d.matchFixtures = d.matchFixtures.map(shiftIso);
  if (d.website?.embeds) {
    d.website.embeds = d.website.embeds.map(e => ({ ...e, merchantId: e.merchantId === old ? id : e.merchantId }));
  }
  if (!front && r() < 0.3) {
    const sales = d.transactions.filter(t => t.merchantId === id && t.type === 'SALE');
    const mode = Math.floor(r() * 4);
    if (mode === 0) for (const s of sales) if (r() < 0.3) s.payerState = CITIES[Math.floor(r() * CITIES.length)].state;
    if (mode === 1) for (const s of sales) if (r() < 0.3) s.amount = r() < 0.5 ? 500 : 1000;
    if (mode === 2) {
      const stls = d.transactions.filter(t => t.merchantId === id && t.type === 'SETTLEMENT');
      stls.slice(Math.floor(stls.length / 2)).forEach(s => { s.beneficiaryAccount = 'BEN-NEW-BANK'; });
      if (d.bankCredits) d.bankCredits = stls.map(s => ({ amount: s.amount, beneficiaryAccount: s.beneficiaryAccount ?? 'BEN-001' }));
    }
    if (mode === 3) {
      for (const s of sales) if (r() < 0.3) s.time = `${s.time.slice(0, 11)}22:30:00+05:30`;
    }
  }
  if (front && r() < 0.35) {
    const sales = d.transactions.filter(t => t.merchantId === id && t.type === 'SALE');
    const evMode = Math.floor(r() * 5);
    if (evMode === 0) {
      for (const s of sales) if (s.amount % 500 === 0) s.amount += 13 + Math.floor(r() * 35);
    } else if (evMode === 1) {
      for (const s of sales) s.time = `${s.time.slice(0, 11)}20:${String(10 + Math.floor(r() * 45)).padStart(2, '0')}:00+05:30`;
    } else if (evMode === 2) {
      d.transactions = d.transactions.filter(t => t.type !== 'REFUND' && t.type !== 'TRANSFER');
      d.transactions.filter(t => t.type === 'SETTLEMENT').forEach(s => { s.beneficiaryAccount = 'BEN-STABLE-01'; });
    } else if (evMode === 3) {
      delete d.website;
      delete d.externalSightings;
      d.dataAvailability = { ...(d.dataAvailability ?? { acquiring: 'AVAILABLE' }), acquiring: 'AVAILABLE', website: 'MISSING' };
    } else if (evMode === 4) {
      // Stealth split-account evasion: thin transactions to 10-14 sales, drop crawler/calendar, nudge round amounts
      const keepCount = 10 + Math.floor(r() * 5);
      const keptIds = new Set(sales.slice(0, keepCount).map(s => s.id));
      d.transactions = d.transactions.filter(t => (t.type === 'SALE' ? keptIds.has(t.id) : t.type === 'SETTLEMENT'));
      for (const s of d.transactions) if (s.type === 'SALE' && s.amount % 500 === 0 && r() < 0.65) s.amount += 23;
      delete d.website;
      delete d.externalSightings;
      d.matchFixtures = [];
      d.dataAvailability = { acquiring: 'AVAILABLE', website: 'MISSING', orders: 'MISSING', bank: 'MISSING', fulfillment: 'MISSING', calendar: 'MISSING', verification: 'MISSING' };
    }
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
