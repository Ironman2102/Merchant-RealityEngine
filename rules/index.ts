/** Typed access to every rules file. Engines read numbers only from here. */
import mcc from './mcc.json';
import calendar from './calendar.json';
import states from './states.json';
import amounts from './amounts.json';
import hosts from './hosts.json';
import costs from './costs.json';
import priors from './priors.json';
import overrides from './overrides.json';
import detectors from './detectors.json';
import engine from './engine.json';

export interface MccNorm {
  name: string; ticket: { median: number; sigma: number }; open: number; close: number; roundShare: number; offHoursShare: number;
  offAreaShare: number; catchment: 'LOCAL' | 'NATIONAL'; refundRate: number; heavyRepeatShare: number; bonusShare: number;
  payoutBeneficiaries: number; beneficiaryChangesPerYear: number; festivalSector: string; reviewedOn: string;
}
export interface DetectorCfg {
  name: string; family: string; lineage: string; provenance: string; requires: string[];
  sensitivity: number; falsePositive: number; alpha: number; minEffect: number; effectFull: number; minN: number;
  fakeDifficulty: number; affinity: [number, number, number, number]; test: string;
}
export type ResponseKey = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

const { _note: _m, default: mccDefault, ...mccRows } = mcc as unknown as { _note: string; default: MccNorm } & Record<string, MccNorm>;
const { _note: _s, ...adjacency } = states as unknown as Record<string, string[]>;
const { _note: _d, ...detectorRows } = detectors as unknown as Record<string, DetectorCfg | string>;

/** Synchronous only. Do not await inside `fn`: the override is a process-wide map. */
let detectorOverrides: Record<string, Partial<DetectorCfg>> | null = null;
let livePatch: Record<string, Partial<DetectorCfg>> | null = null;
let liveVersion: string | null = null;

export function withDetectorOverrides<T>(patch: Record<string, Partial<Pick<DetectorCfg, 'minEffect' | 'alpha' | 'minN'>>>, fn: () => T): T {
  const prev = detectorOverrides;
  detectorOverrides = patch;
  try { return fn(); } finally { detectorOverrides = prev; }
}

export function setLiveDetectorPatch(patch: Record<string, Partial<Pick<DetectorCfg, 'minEffect' | 'alpha' | 'minN'>>> | null, version: string | null = null): void {
  livePatch = patch;
  liveVersion = version;
}

export function getLiveDetectorPatch(): { patch: Record<string, Partial<DetectorCfg>> | null; version: string } {
  return { patch: livePatch, version: liveVersion ?? engine.version };
}

export const RULES = {
  get version(): string { return liveVersion ?? engine.version; },
  engine,
  mcc: (code: string): MccNorm => mccRows[code] ?? mccDefault,
  neighbours: (state: string): string[] => adjacency[state] ?? [],
  calendar, amounts, hosts, overrides,
  costs: costs as { missCost: number; actions: Record<ResponseKey, { falseAlarmCost: number; missFactor: number; label: string }>; autoRecommendMax: ResponseKey },
  priors: priors as { default: { rate: number; strength: number }; byMcc: Record<string, { rate: number; strength: number }>; ageOdds: { maxDays: number; odds: number }[] },
  detector: (id: string): DetectorCfg => {
    const d = detectorRows[id];
    if (!d || typeof d === 'string') throw new Error(`rules/detectors.json has no entry for ${id}`);
    const p = detectorOverrides?.[id] ?? livePatch?.[id];
    return p ? { ...d, ...p } : d;
  },
};
