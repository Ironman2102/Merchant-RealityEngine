/** Bayesian FDR queue: opened count and the expected false-alarm sum. */
import { scorePortfolio } from '../../engine/portfolio';

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); } else console.log(`  ✓ ${name}`); };
  const rows = [
    { merchantId: 'a', name: 'a', posterior: 0.99, ci: [0.9, 0.999] as [number, number], expectedLoss: 100, action: 'L3', decision: 'OPEN_CASE' },
    { merchantId: 'b', name: 'b', posterior: 0.5, ci: [0.4, 0.6] as [number, number], expectedLoss: 40, action: 'L2', decision: 'OPEN_CASE' },
    { merchantId: 'c', name: 'c', posterior: 0.01, ci: [0, 0.05] as [number, number], expectedLoss: 1, action: 'L0', decision: 'NO_CASE' },
  ];
  const q = scorePortfolio(rows, 0.1);
  check('opens the strong case', q.opened >= 1 && q.queue.some(r => r.merchantId === 'a'));
  check('does not open the near-zero case', !q.queue.some(r => r.merchantId === 'c'));
  const sum = q.queue.reduce((s, r) => s + (1 - r.posterior), 0);
  check('expected false alarms is the sum', Math.abs(q.expectedFalseAlarms - sum) < 1e-12, String(q.expectedFalseAlarms));
  return bad;
}
