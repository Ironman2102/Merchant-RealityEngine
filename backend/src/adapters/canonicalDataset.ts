import { datasetToScenario } from '../../../frontend/src/data/dataset';
import type { Scenario } from '../../../frontend/src/types/merchant';

export interface DatasetAdapterResult {
  ok: boolean;
  scenario?: Scenario;
  errors: string[];
  warnings: string[];
}

/** First pilot adapter: uploaded mre-dataset/v1 JSON. Provider adapters should map into the same canonical shape. */
export function parseCanonicalDataset(raw: unknown): DatasetAdapterResult {
  const parsed = datasetToScenario(raw);
  return { ok: parsed.ok, scenario: parsed.scenario, errors: parsed.errors, warnings: parsed.warnings };
}
