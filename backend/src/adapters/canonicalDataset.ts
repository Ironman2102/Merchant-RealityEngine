import { createHash } from 'node:crypto';
import { asSubmitted, datasetToScenario } from '../../../frontend/src/data/dataset';
import type { Scenario } from '../../../frontend/src/types/merchant';
import { loadHashKey, maskIds, pseudonym as hmacPseudonym } from '../../../adapters/pseudonym';

export interface DatasetAdapterResult {
  ok: boolean;
  scenario?: Scenario;
  errors: string[];
  warnings: string[];
}

/** HMAC key for identifiers. Production must supply MRE_HASH_KEY; development keeps a local random key file (0600). */
export const pseudonym = (raw: string) => hmacPseudonym(raw, loadHashKey());
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Replace every personal identifier with a keyed pseudonym before anything else sees the file. */
export function pseudonymize(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const d = structuredClone(raw) as Record<string, unknown>;
  if (Array.isArray(d.transactions)) for (const t of d.transactions) if (t && typeof t === 'object') maskIds(t, loadHashKey);
  if (Array.isArray(d.bankCredits)) for (const b of d.bankCredits) if (b && typeof b === 'object') maskIds(b, loadHashKey, ['beneficiaryAccount']);
  // An upload cannot verify its own Context Passport, nor name someone else as its maker.
  if (Array.isArray(d.contextPassports)) d.contextPassports = d.contextPassports.map(asSubmitted);
  return d;
}

/** First pilot adapter: uploaded mre-dataset/v1 JSON. Provider adapters should map into the same canonical shape. */
export function parseCanonicalDataset(raw: unknown): DatasetAdapterResult {
  const parsed = datasetToScenario(pseudonymize(raw));
  return { ok: parsed.ok, scenario: parsed.scenario, errors: parsed.errors, warnings: parsed.warnings };
}
