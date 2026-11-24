import { runInvestigation, type LearnedRateOverride } from '../../../frontend/src/engines/investigationEngine';
import type { InvestigationResult } from '../../../frontend/src/types/investigation';
import type { Scenario } from '../../../frontend/src/types/merchant';
import { parseCanonicalDataset } from '../adapters/canonicalDataset';

export const ENGINE_VERSION = 'mre-rules-0.1';

export type AnalysisResult =
  | { ok: true; scenario: Scenario; result: InvestigationResult; engineVersion: string }
  | { ok: false; errors: string[]; warnings: string[] };

/** Server-side entry point for the deterministic evidence algorithms. */
export function analyzeDataset(
  raw: unknown,
  options?: { learnedRatesForMcc?: (mcc: string) => LearnedRateOverride | undefined },
): AnalysisResult {
  const parsed = parseCanonicalDataset(raw);
  if (!parsed.ok || !parsed.scenario) return { ok: false, errors: parsed.errors, warnings: parsed.warnings };
  const learnedRates = options?.learnedRatesForMcc?.(parsed.scenario.profile.mcc);
  return { ok: true, scenario: parsed.scenario, result: runInvestigation(parsed.scenario, { learnedRates }), engineVersion: ENGINE_VERSION };
}
