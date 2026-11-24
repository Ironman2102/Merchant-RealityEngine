/** Empirical peer baselines grouped by MCC across a portfolio batch. */
import type { Scenario } from '../frontend/src/types/merchant';
import { istHour } from '../frontend/src/utils/format';
import { RULES } from '../rules/index';

export interface PeerBaseline {
  mcc: string;
  category: string;
  n: number;
  medianTicket: number;
  priorTicket: number;
  roundShare: number;
  priorRoundShare: number;
  offHoursShare: number;
  priorOffHoursShare: number;
  refundRate: number;
  priorRefundRate: number;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const isRound = (a: number) => a >= RULES.amounts.roundMin && a % RULES.amounts.roundStep === 0;
const outsideHours = (h: number, open: number, close: number) =>
  open < close ? h < open || h >= close : h < open && h >= close;

export function computePeerBaselines(scenarios: readonly Scenario[], minPeers = 10): PeerBaseline[] {
  const byMcc = new Map<string, Scenario[]>();
  for (const sc of scenarios) {
    const list = byMcc.get(sc.profile.mcc);
    if (list) list.push(sc);
    else byMcc.set(sc.profile.mcc, [sc]);
  }

  const out: PeerBaseline[] = [];
  for (const [mcc, group] of byMcc) {
    if (group.length < minPeers) continue;
    const norm = RULES.mcc(mcc);
    const meds: number[] = [];
    const roundRates: number[] = [];
    const offRates: number[] = [];
    const refundRates: number[] = [];

    for (const sc of group) {
      const amounts: number[] = [];
      let round = 0, off = 0, refunds = 0;
      for (const e of sc.events) {
        if (e.merchantId !== sc.profile.id) continue;
        if (e.type === 'SALE') {
          amounts.push(e.amount);
          if (isRound(e.amount)) round++;
          if (outsideHours(istHour(e.eventTime), norm.open, norm.close)) off++;
        } else if (e.type === 'REFUND') {
          refunds++;
        }
      }
      if (amounts.length) {
        meds.push(median(amounts));
        roundRates.push(round / amounts.length);
        offRates.push(off / amounts.length);
        refundRates.push(refunds / amounts.length);
      }
    }

    if (!meds.length) continue;
    out.push({
      mcc,
      category: norm.name,
      n: group.length,
      medianTicket: median(meds),
      priorTicket: norm.ticket.median,
      roundShare: median(roundRates),
      priorRoundShare: norm.roundShare,
      offHoursShare: median(offRates),
      priorOffHoursShare: norm.offHoursShare,
      refundRate: median(refundRates),
      priorRefundRate: norm.refundRate,
    });
  }
  return out.sort((a, b) => b.n - a.n || a.mcc.localeCompare(b.mcc));
}
