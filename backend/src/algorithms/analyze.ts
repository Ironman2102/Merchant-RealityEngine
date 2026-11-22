import { runInvestigation } from '../../../frontend/src/engines/investigationEngine';
import type { InvestigationResult } from '../../../frontend/src/types/investigation';
import type { Scenario } from '../../../frontend/src/types/merchant';
import { RULES } from '../../../rules/index';
import { datasetToScenario } from '../../../frontend/src/data/dataset';
import { scoringFailed } from '../../../engine/index';
import { parseCanonicalDataset, type DatasetAdapterResult } from '../adapters/canonicalDataset';
import { syncLiveRules } from '../rulesState';
import { sameTerms, verifiedPassports } from '../passports';

export type AnalysisResult =
  | { ok: true; scenario: Scenario; result: InvestigationResult; engineVersion: string }
  | { ok: false; errors: string[]; warnings: string[] };

/**
 * Scores a dataset whose identifiers are already pseudonyms (an upload after pseudonymize, or a mapped export) with the
 * merchant's verified Context Passports. Call syncLiveRules() first: a batch syncs once so all its rows share one version.
 */
export function analyseCanonical(dataset: unknown, client?: string): AnalysisResult {
  return score(datasetToScenario(dataset), client);
}

/** Server-side entry point: the engine under the promoted rules and the merchant's verified Context Passports. */
export function analyzeDataset(raw: unknown, client?: string): AnalysisResult {
  syncLiveRules();
  return score(parseCanonicalDataset(raw), client);
}

function score(parsed: DatasetAdapterResult, client?: string): AnalysisResult {
  if (!parsed.ok || !parsed.scenario) return { ok: false, errors: parsed.errors, warnings: parsed.warnings };
  const verified = verifiedPassports(parsed.scenario.primaryMerchantId, client);
  if (verified.length) {
    // The same passport filed again is already verified. A different one that reuses its id stays, under its own id.
    const filed = (parsed.scenario.passports ?? []).filter(p => !verified.some(v => sameTerms(v, p)))
      .map(p => (verified.some(v => v.id === p.id) ? { ...p, id: `${p.id}-filed` } : p));
    parsed.scenario.passports = [...filed, ...verified];
  }
  try {
    return { ok: true, scenario: parsed.scenario, result: runInvestigation(parsed.scenario), engineVersion: RULES.version };
  } catch (e) { return { ok: false, errors: [scoringFailed(e)], warnings: parsed.warnings }; }
}
