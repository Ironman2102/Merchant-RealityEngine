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
  class: 'profile' | 'conduct'; categoryNorm?: boolean; level?: 'merchant'; derivedFrom?: string[]; conductWith?: string[];
}
/** The only fields an approved rule change or calibration may move. */
export type RulePatch = Record<string, Partial<Pick<DetectorCfg, 'minEffect' | 'alpha' | 'minN' | 'sensitivity' | 'falsePositive'>>>;
export type ResponseKey = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

const { _note: _m, default: mccDefault, ...mccRows } = mcc as unknown as { _note: string; default: MccNorm } & Record<string, MccNorm>;
const { _note: _s, ...adjacency } = states as unknown as Record<string, string[]>;
const { _note: _d, ...detectorRows } = detectors as unknown as Record<string, DetectorCfg | string>;

/** Keys come from uploads and exports, so inherited ones such as "constructor" must never resolve. */
export const own = <T>(row: Record<string, T> | null | undefined, key: string): T | undefined => (row && Object.hasOwn(row, key) ? row[key] : undefined);

/** Synchronous only. Do not await inside `fn`: the override is a process-wide map. */
let detectorOverrides: Record<string, Partial<DetectorCfg>> | null = null;
let livePatch: RulePatch | null = null;
let liveVersion: string | null = null;

export function withDetectorOverrides<T>(patch: RulePatch, fn: () => T): T {
  const prev = detectorOverrides;
  detectorOverrides = patch;
  try { return fn(); } finally { detectorOverrides = prev; }
}

export function setLiveDetectorPatch(patch: RulePatch | null, version: string | null = null): void {
  livePatch = patch;
  liveVersion = version;
}

export function getLiveDetectorPatch(): { patch: RulePatch | null; version: string } {
  return { patch: livePatch, version: liveVersion ?? engine.version };
}

export const RULES = {
  get version(): string { return liveVersion ?? engine.version; },
  engine,
  mcc: (code: string): MccNorm => own(mccRows, code) ?? mccDefault,
  /** False = we have no idea what is normal here. Callers abstain instead of borrowing the default shop. */
  knowsCategory: (code: string): boolean => Object.hasOwn(mccRows, code),
  categories: (): [string, MccNorm][] => Object.entries(mccRows),
  neighbours: (state: string): string[] => own(adjacency, state) ?? [],
  calendar, amounts, hosts, overrides,
  costs: costs as { missCost: number; actions: Record<ResponseKey, { falseAlarmCost: number; missFactor: number; label: string }>; autoRecommendMax: ResponseKey },
  priors: priors as { default: { rate: number; strength: number }; byMcc: Record<string, { rate: number; strength: number }>; ageOdds: { maxDays: number; odds: number }[] },
  /** The committed prior. Learning starts here, so re-calibrating never counts the same labels twice. */
  baseDetector: (id: string): DetectorCfg => {
    const d = own(detectorRows, id);
    if (!d || typeof d === 'string') throw new Error(`rules/detectors.json has no entry for ${id}`);
    return d;
  },
  detector: (id: string): DetectorCfg => {
    const d = own(detectorRows, id);
    if (!d || typeof d === 'string') throw new Error(`rules/detectors.json has no entry for ${id}`);
    const live = own(livePatch, id), trial = own(detectorOverrides, id);
    return live || trial ? { ...d, ...live, ...trial } : d;
  },
};
