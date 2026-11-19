/** Simulation-recovery tests: each routine must recover the truth it was given. Returns the number of failures. */
import { fitPoissonGlm } from '../../frontend/src/stats/glm';
import { calibrateH, arl0, bocpdRecentChange } from '../../frontend/src/stats/changepoint';
import { fitBetaBinomial, shrunkRate } from '../../frontend/src/stats/eb';
import { rng, gamma, beta, normal } from '../../frontend/src/stats/rng';
import { wilson } from '../../frontend/src/stats/intervals';

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); } };
  const r = rng(11);

  // Poisson GLM recovers log-linear coefficients (intercept 5, festival effect log 2).
  const X: number[][] = [], y: number[] = [];
  for (let i = 0; i < 400; i++) {
    const fest = i % 5 === 0 ? 1 : 0, mu = Math.exp(5 + Math.log(2) * fest);
    let k = 0, p = Math.exp(-mu), s = p; const u = r(); while (u > s) { k++; p *= mu / k; s += p; }
    X.push([1, fest]); y.push(k);
  }
  const fit = fitPoissonGlm(X, y);
  check('glm intercept', Math.abs(fit.beta[0] - 5) < 0.02, String(fit.beta[0]));
  check('glm festival effect', Math.abs(fit.beta[1] - Math.log(2)) < 0.05, String(fit.beta[1]));
  check('glm converged', fit.converged);

  // One-sided CUSUM, k = 0.5. Siegmund: ARL0 ≈ (e^{2kb} − 2kb − 1)/(2k²), b = h + 1.166 → h ≈ 2.24 for ARL0 = 52;
  // h = 4 gives ≈ 336 (the often-quoted 168 is the two-sided chart).
  const h = calibrateH(0.5, 52), a4 = arl0(0.5, 4, 800);
  check('cusum h calibration', h > 2.05 && h < 2.6, String(h));
  check('cusum ARL0 at h=4', a4 > 290 && a4 < 390, String(a4));

  // BOCPD: flat series → low recent-change probability; a +3σ shift in the last 3 weeks → high.
  const flat = Array.from({ length: 30 }, () => normal(r) * 0.5);
  check('bocpd quiet', bocpdRecentChange(flat) < 0.3, String(bocpdRecentChange(flat)));
  check('bocpd shift', bocpdRecentChange([...flat, 3.2, 3.5, 3.1]) > 0.7, String(bocpdRecentChange([...flat, 3.2, 3.5, 3.1])));

  // Beta-binomial EB: peers draw rates from Beta(6, 94) (mean 6%); the fit recovers the mean.
  const xs: number[] = [], ns: number[] = [];
  for (let i = 0; i < 300; i++) { const p = beta(r, 6, 94), n = 50 + Math.floor(r() * 300); let x = 0; for (let j = 0; j < n; j++) if (r() < p) x++; xs.push(x); ns.push(n); }
  const pr = fitBetaBinomial(xs, ns), mean = pr.a / (pr.a + pr.b);
  check('eb mean', Math.abs(mean - 0.06) < 0.006, String(mean));
  check('eb concentration plausible', pr.a + pr.b > 40 && pr.a + pr.b < 250, String(pr.a + pr.b));
  check('eb shrinks small merchant', shrunkRate(4, 20, pr) < 0.12, String(shrunkRate(4, 20, pr)));

  // Gamma sampler mean, Wilson coverage sanity.
  const g = Array.from({ length: 4000 }, () => gamma(r, 3)), gm = g.reduce((s, v) => s + v, 0) / g.length;
  check('gamma mean', Math.abs(gm - 3) < 0.12, String(gm));
  let cover = 0; for (let t = 0; t < 2000; t++) { let x = 0; for (let j = 0; j < 40; j++) if (r() < 0.2) x++; const [lo, hi] = wilson(x, 40); if (lo <= 0.2 && 0.2 <= hi) cover++; }
  check('wilson 95% coverage', cover / 2000 > 0.93, String(cover / 2000));
  return bad;
}
