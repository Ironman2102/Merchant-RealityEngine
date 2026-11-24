import type { CoverageKey } from './merchant';

export type Family = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'K';
/** Where the evidence's data comes from. Two items with the same provenance are not independent sources. */
export type Provenance = 'payments' | 'calendar' | 'crawler' | 'panel' | 'orders' | 'fulfilment' | 'bank' | 'network' | 'kyc';
export type EvidenceStatus = 'ILLICIT' | 'BENIGN' | 'UNKNOWN';
export type Mechanism = 'ROTATION' | 'TRANSACTION_LAUNDERING' | 'FABRICATED_SUBSTANCE' | 'OTHER_ABUSE';

export interface EvidenceItem {
  id: string;                 // detector id, e.g. A4
  name: string;
  family: Family;
  status: EvidenceStatus;
  strength: number;           // 0..1, detector-local
  reliability: number;        // 0..1, data-quality weight
  fakeDifficulty: number;     // 0..1, how hard it is for an adversary to fake this evidence
  lineage: string;            // correlation key within a family
  system: string;             // source system, used for independence
  affinity: Record<Mechanism, number>;
  observed: string;
  expected: string;
  explanation: string;
  metrics: Record<string, string | number>;
  records: string[];          // event ids / link ids behind the signal
  requires: CoverageKey[];
  /* ---- statistical fields (v2 engine) ---- */
  llr: number;                // evidence weight in nats: >0 towards "front", <0 towards "genuine", 0 = UNKNOWN
  provenance: Provenance;
  test: string;               // the statistical test that produced p
  p: number | null;           // p-value against the category / peer norm (null for deterministic checks)
  effect: number | null;      // practical effect size (see test)
  effectLabel: string;        // what `effect` measures
  ci: [number, number] | null;// 90% interval for the observed rate / effect, where defined
  signal: 'profile' | 'conduct'; // profile = an honest change could explain it; conduct = it could not
  derived?: boolean;          // built from other detectors, so not independent
  n: number;                  // observations behind the test
  expectedSource: string;     // where the expectation came from (category norm, calendar, peers…)
}
