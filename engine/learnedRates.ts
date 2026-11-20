/** Beta rates from labels. No labels, or only UNRESOLVED, leaves the prior unchanged. */
import { RULES } from '../rules/index';

export interface LabelEvent { detectorId: string; fired: boolean; label: 'CONFIRMED_ILLICIT' | 'ADJUDICATED_BENIGN' | 'UNRESOLVED'; actorId?: string }

export function effectiveRates(detectorId: string, events: LabelEvent[]): { sensitivity: number; falsePositive: number; nPos: number; nNeg: number } {
  const c = RULES.detector(detectorId);
  const k = RULES.engine.detectorPriorStrength;
  let a1 = c.sensitivity * k, b1 = (1 - c.sensitivity) * k, a0 = c.falsePositive * k, b0 = (1 - c.falsePositive) * k;
  let nPos = 0, nNeg = 0;
  for (const e of events) {
    if (e.detectorId !== detectorId || e.label === 'UNRESOLVED') continue;
    if (e.label === 'CONFIRMED_ILLICIT') { nPos++; if (e.fired) a1++; else b1++; }
    else { nNeg++; if (e.fired) a0++; else b0++; }
  }
  const s = Math.min(0.99, Math.max(0.05, a1 / (a1 + b1)));
  const f = Math.min(0.5, Math.max(0.005, a0 / (a0 + b0)));
  return { sensitivity: nPos + nNeg === 0 ? c.sensitivity : s, falsePositive: nPos + nNeg === 0 ? c.falsePositive : f, nPos, nNeg };
}
