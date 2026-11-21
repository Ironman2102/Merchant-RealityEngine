/** Beta rates from labels with MCC partial pooling and a per-analyst 20% weight cap. */
import { RULES } from '../rules/index';

export interface LabelEvent {
  detectorId: string;
  fired: boolean;
  label: 'CONFIRMED_ILLICIT' | 'ADJUDICATED_BENIGN' | 'UNRESOLVED';
  mcc?: string;
  actorId?: string | number;
  origin?: string;
}

export interface LearnedRate {
  detectorId: string;
  name: string;
  priorSensitivity: number;
  priorFalsePositive: number;
  sensitivity: number;
  falsePositive: number;
  nPos: number;
  nNeg: number;
}

export function effectiveRates(detectorId: string, events: LabelEvent[], mcc?: string): LearnedRate {
  const c = RULES.detector(detectorId);
  const k = RULES.engine.detectorPriorStrength;
  const poolKappa = 20;
  const analystCap = 0.2;

  const valid = events.filter(
    e => e.detectorId === detectorId && e.label !== 'UNRESOLVED' && e.origin !== 'merchant_dispute',
  );
  if (valid.length === 0) {
    return {
      detectorId,
      name: c.name,
      priorSensitivity: c.sensitivity,
      priorFalsePositive: c.falsePositive,
      sensitivity: c.sensitivity,
      falsePositive: c.falsePositive,
      nPos: 0,
      nNeg: 0,
    };
  }

  // Per-analyst cap: if actorId is tracked and one actor dominates, cap their weight to analystCap * N_total / N_actor.
  const byActor = new Map<string, number>();
  for (const e of valid) {
    if (e.actorId !== undefined && e.actorId !== null) {
      const key = String(e.actorId);
      byActor.set(key, (byActor.get(key) ?? 0) + 1);
    }
  }
  const weightOf = (e: LabelEvent): number => {
    if (e.actorId === undefined || e.actorId === null) return 1;
    const nActor = byActor.get(String(e.actorId)) ?? 1;
    const nOthers = valid.length - nActor;
    return Math.min(1, (analystCap * (k + nOthers)) / nActor);
  };

  let a1All = c.sensitivity * k, b1All = (1 - c.sensitivity) * k;
  let a0All = c.falsePositive * k, b0All = (1 - c.falsePositive) * k;
  let a1Mcc = 0, b1Mcc = 0, a0Mcc = 0, b0Mcc = 0;
  let nPos = 0, nNeg = 0;

  for (const e of valid) {
    const w = weightOf(e);
    const inMcc = !mcc || !e.mcc || e.mcc === mcc;
    if (e.label === 'CONFIRMED_ILLICIT') {
      nPos++;
      if (e.fired) { a1All += w; if (inMcc) a1Mcc += w; }
      else { b1All += w; if (inMcc) b1Mcc += w; }
    } else if (e.label === 'ADJUDICATED_BENIGN') {
      nNeg++;
      if (e.fired) { a0All += w; if (inMcc) a0Mcc += w; }
      else { b0All += w; if (inMcc) b0Mcc += w; }
    }
  }

  const sAll = a1All / (a1All + b1All);
  const fAll = a0All / (a0All + b0All);
  const sPooled = mcc ? (a1Mcc + poolKappa * sAll) / (a1Mcc + b1Mcc + poolKappa) : sAll;
  const fPooled = mcc ? (a0Mcc + poolKappa * fAll) / (a0Mcc + b0Mcc + poolKappa) : fAll;
  const s = Math.min(0.99, Math.max(0.05, sPooled));
  const f = Math.min(0.5, Math.max(0.005, fPooled));
  return {
    detectorId,
    name: c.name,
    priorSensitivity: c.sensitivity,
    priorFalsePositive: c.falsePositive,
    sensitivity: s,
    falsePositive: f,
    nPos,
    nNeg,
  };
}
