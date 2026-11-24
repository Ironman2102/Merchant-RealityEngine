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
  /** P × the money that moved through the flagged scope in the window. */
  exposure?: number;
  scope?: string;
}

export function scorePortfolio(rows: PortfolioRow[], q = RULES.engine.portfolio.fdrQ): { queue: PortfolioRow[]; opened: number; expectedFalseAlarms: number } {
  const candidates = rows.filter(r => r.decision === 'OPEN_CASE');
  const byP = [...candidates].sort((a, b) => (1 - a.posterior) - (1 - b.posterior) || a.merchantId.localeCompare(b.merchantId));
  let keep = 0;
  let runningFalseAlarms = 0;
  for (let i = 0; i < byP.length; i++) {
    runningFalseAlarms += 1 - byP[i].posterior;
    if (runningFalseAlarms / (i + 1) <= q) keep = i + 1;
  }
  const opened = byP.slice(0, keep);
  const expectedFalseAlarms = opened.reduce((s, r) => s + (1 - r.posterior), 0);
  const queue = [...opened].sort((a, b) => (b.exposure ?? b.expectedLoss) - (a.exposure ?? a.expectedLoss) || a.merchantId.localeCompare(b.merchantId));
  return { queue, opened: opened.length, expectedFalseAlarms };
}
