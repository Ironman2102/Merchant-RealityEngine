/**
 * Write a synthetic portfolio as a PA export, to try batch mode on. The benchmark does not need these files.
 * Usage: npx tsx scripts/gen-portfolio.ts --n 100 --seed 7 --out examples/portfolio
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePortfolio } from '../engine/synthetic';
import { writeLayout } from './export-pa-files';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const out = arg('--out', 'examples/portfolio');
const portfolio = makePortfolio(Number(arg('--n', '100')), Number(arg('--seed', '7')));
writeLayout(out, portfolio.map(m => m.dataset), 'generic');
writeFileSync(join(out, 'truth.csv'), ['merchant_id,label,kind', ...portfolio.map(m => `${m.dataset.merchant.id},${m.label},${m.kind}`)].join('\n') + '\n');
console.log(`wrote ${portfolio.length} merchants to ${out}`);
