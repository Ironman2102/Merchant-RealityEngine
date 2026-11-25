/** engine/fraudMath.ts: each statistic against a hand-computed or known value. */
import { BENFORD, benford, firstDigit, payerConcentration, repeatPayers, timing } from '../../engine/fraudMath';

export default function (): number {
  let bad = 0;
  const ok = (cond: boolean, msg: string) => { if (!cond) { bad++; console.log('  fraud-math:', msg); } };
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

  // First digit and the Benford shares.
  ok(firstDigit(0.042) === 4 && firstDigit(987) === 9 && firstDigit(1) === 1 && firstDigit(0) === 0 && firstDigit(-5) === 0, 'firstDigit');
  ok(near(BENFORD.reduce((s, x) => s + x, 0), 1, 1e-12) && near(BENFORD[0], 0.30103, 1e-5), 'Benford shares sum to 1, P(1) = 0.301');

  // A sample that follows Benford exactly has chi2 = 0, p = 1, MAD = 0.
  const exact: number[] = [];
  const n = 100_000;
  BENFORD.forEach((p, i) => { for (let k = 0; k < Math.round(p * n); k++) exact.push((i + 1) * 10 + (k % 10)); });
  const bx = benford(exact);
  ok(bx.mad < 2e-5 && bx.chi2PerN < 1e-6 && bx.p > 0.99, `exact Benford sample conforms (mad ${bx.mad}, chi2/n ${bx.chi2PerN})`);
  // Round deposits (all 500 / 1000 / 2000) are wildly nonconforming (Nigrini's cutoff is MAD > 0.015).
  const deposits = Array.from({ length: 300 }, (_, i) => [500, 1000, 2000][i % 3]);
  const bd = benford(deposits);
  ok(bd.mad > 0.05 && bd.p < 1e-10, `round deposits do not conform (mad ${bd.mad})`);
  // Hand check: 30 amounts all starting with 1 -> chi2 = n(1/P1 - 1), MAD = (2/9)(1 - P1).
  const ones = benford(Array(30).fill(150));
  ok(near(ones.chi2PerN, 1 / BENFORD[0] - 1, 1e-9) && near(ones.mad, (2 / 9) * (1 - BENFORD[0]), 1e-12), 'all-ones hand formula');
  ok(benford([1, 2, 3]).p === 1 && benford([1, 2, 3]).mad === 0, 'neutral below MIN_N');

  // Timing: perfectly periodic sales -> burstiness -1, gap CV 0, dispersion 0 (same count every day).
  const day = 86_400_000;
  const periodic = Array.from({ length: 70 }, (_, i) => i * (day / 10));
  const tp = timing(periodic, 0);
  ok(near(tp.burstiness, -1, 1e-9) && near(tp.gapCv, 0, 1e-9) && near(tp.dispersion, 0, 1e-9), `periodic timing ${JSON.stringify(tp)}`);
  // All sales packed into one day out of ten -> dispersion = Var/Mean = (n^2/10 - n^2/100)/(n/10) = 0.9 n.
  const packed = [...Array.from({ length: 40 }, (_, i) => i * 1000), 9 * day];
  const tk = timing(packed, 0);
  const counts = [40, 0, 0, 0, 0, 0, 0, 0, 0, 1], m = 4.1, v = counts.reduce((s, c) => s + (c - m) ** 2, 0) / 10;
  ok(near(tk.dispersion, v / m, 1e-9) && tk.burstiness > 0.7, `bursty timing ${JSON.stringify(tk)}`);
  ok(timing([1, 2, 3]).dispersion === 1, 'timing neutral below MIN_N');

  // Payer concentration.
  const eq = payerConcentration([5, 5, 5, 5]);
  ok(near(eq.entropy, 1, 1e-12) && near(eq.gini, 0, 1e-12), 'equal payers: entropy 1, gini 0');
  const g = payerConcentration([1, 2, 3, 4]);   // Gini by definition: sum|xi-xj| / (2 n^2 mean) = 20 / (2*16*2.5) = 0.25
  ok(near(g.gini, 0.25, 1e-12), `gini [1,2,3,4] = 0.25, got ${g.gini}`);
  const h = payerConcentration([3, 1]);         // entropy -(.75 ln .75 + .25 ln .25)/ln 2 = 0.811278
  ok(near(h.entropy, 0.8112781244591328, 1e-12), `entropy [3,1] = 0.8113, got ${h.entropy}`);
  ok(payerConcentration([7]).entropy === 1 && payerConcentration([]).gini === 0, 'concentration neutral with < 2 payers');

  // Repeat payers: one clockwork depositor (gap CV 0) and two one-off customers.
  const rp = repeatPayers(new Map([['a', [0, 10, 20, 30]], ['b', [5]], ['c', [7]]]));
  ok(near(rp.returningShare, 4 / 6, 1e-12) && near(rp.repeatGapCv, 0, 1e-12), `repeat payers ${JSON.stringify(rp)}`);
  ok(repeatPayers(new Map()).repeatGapCv === 1, 'repeat neutral when empty');
  return bad;
}
