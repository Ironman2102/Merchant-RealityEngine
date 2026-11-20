/**
 * Portfolio queue. p = 1 − posterior is a proxy, so this is a Bayesian false-discovery count,
 * not a classical Benjamini–Hochberg p-value. expectedFalseAlarms = Σ(1 − P) over the opened cases.
 */
import { RULES } from '../rules/index';

export interface PortfolioRow {
  merchantId: string;
  name: string;
  posterior: number;
  ci: [number, number];
  expectedLoss: number;
  action: string;
  decision: string;
}

export function scorePortfolio(rows: PortfolioRow[], q = RULES.engine.portfolio.fdrQ): { queue: PortfolioRow[]; opened: number; expectedFalseAlarms: number } {
  const m = rows.length;
  const byP = [...rows].sort((a, b) => (1 - a.posterior) - (1 - b.posterior) || a.merchantId.localeCompare(b.merchantId));
  let keep = 0;
  for (let i = 0; i < m; i++) if ((1 - byP[i].posterior) <= ((i + 1) / m) * q) keep = i + 1;
  const opened = byP.slice(0, keep);
  const expectedFalseAlarms = opened.reduce((s, r) => s + (1 - r.posterior), 0);
  const queue = [...opened].sort((a, b) => b.expectedLoss - a.expectedLoss || a.merchantId.localeCompare(b.merchantId));
  return { queue, opened: opened.length, expectedFalseAlarms };
}
