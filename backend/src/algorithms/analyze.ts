import { runInvestigation } from '../../../frontend/src/engines/investigationEngine';
import type { InvestigationResult } from '../../../frontend/src/types/investigation';
import type { Scenario } from '../../../frontend/src/types/merchant';
import { RULES } from '../../../rules/index';
import { parseCanonicalDataset } from '../adapters/canonicalDataset';
import { syncLiveRules } from '../rulesState';
import { verifiedPassports } from '../passports';

export type AnalysisResult =
  | { ok: true; scenario: Scenario; result: InvestigationResult; engineVersion: string }
  | { ok: false; errors: string[]; warnings: string[] };

/** Server-side entry point: the engine under the promoted rules and the merchant's verified Context Passports. */
export function analyzeDataset(raw: unknown): AnalysisResult {
  const parsed = parseCanonicalDataset(raw);
  if (!parsed.ok || !parsed.scenario) return { ok: false, errors: parsed.errors, warnings: parsed.warnings };
  syncLiveRules();
  const verified = verifiedPassports(parsed.scenario.primaryMerchantId);
  if (verified.length) parsed.scenario.passports = [...(parsed.scenario.passports ?? []).filter(p => !verified.some(v => v.id === p.id)), ...verified];
  return { ok: true, scenario: parsed.scenario, result: runInvestigation(parsed.scenario), engineVersion: RULES.version };
}
