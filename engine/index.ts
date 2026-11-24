/** Public engine entry. No pseudonymisation, no React, no Node-only imports. */
export { RULES } from '../rules/index';
import { RULES } from '../rules/index';
import { datasetToScenario } from '../frontend/src/data/dataset';
import { runInvestigation } from '../frontend/src/engines/investigationEngine';
import { buildTrace, type Trace } from '../frontend/src/engines/traceEngine';
import type { InvestigationResult } from '../frontend/src/types/investigation';

export const ENGINE_VERSION: string = RULES.version;
export { datasetToScenario, scenarioToDataset, toIst, DATASET_FORMAT, type MreDataset, type DatasetTransaction } from '../frontend/src/data/dataset';
export { runInvestigation } from '../frontend/src/engines/investigationEngine';
export { buildTrace, type Trace } from '../frontend/src/engines/traceEngine';
export { DETECTORS } from '../frontend/src/engines/detectors';
export { buildPack } from './pack';
export { features, FEATURE_COLUMNS, behavioralFeatures, BEHAVIORAL_FEATURE_COLUMNS } from './features';
export { computePeerBaselines, type PeerBaseline } from './peerBaselines';
export { computeBatchDrift, type DriftReport, type DetectorDrift } from './driftMonitor';

export function analyze(dataset: unknown):
  | { ok: true; result: InvestigationResult; trace: Trace; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] } {
  const parsed = datasetToScenario(dataset);
  if (!parsed.ok || !parsed.scenario) return { ok: false, errors: parsed.errors, warnings: parsed.warnings };
  const result = runInvestigation(parsed.scenario);
  return { ok: true, result, trace: buildTrace(result), warnings: parsed.warnings };
}
