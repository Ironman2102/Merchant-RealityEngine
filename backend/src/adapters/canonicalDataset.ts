import { createHash, createHmac, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { datasetToScenario } from '../../../frontend/src/data/dataset';
import type { Scenario } from '../../../frontend/src/types/merchant';

export interface DatasetAdapterResult {
  ok: boolean;
  scenario?: Scenario;
  errors: string[];
  warnings: string[];
}

/** HMAC key for identifiers. Production must supply MRE_HASH_KEY; development keeps a local random key file (0600). */
let key: Buffer | null = null;
function hashKey(): Buffer {
  if (key) return key;
  if (process.env.MRE_HASH_KEY) return (key = Buffer.from(process.env.MRE_HASH_KEY, 'utf8'));
  if (process.env.NODE_ENV === 'production') throw new Error('MRE_HASH_KEY is required in production.');
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', '.hashkey');
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  chmodSync(file, 0o600);
  return (key = Buffer.from(readFileSync(file, 'utf8').trim(), 'utf8'));
}

export const pseudonym = (raw: string) => 'p_' + createHmac('sha256', hashKey()).update(raw).digest('hex').slice(0, 24);
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const ID_FIELDS = ['payerId', 'paidTo', 'beneficiaryAccount', 'payerMobile', 'destHolder'] as const;

/** Replace every personal identifier with a keyed pseudonym before anything else sees the file. */
export function pseudonymize(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const d = structuredClone(raw) as Record<string, unknown>;
  if (Array.isArray(d.transactions)) for (const t of d.transactions as Record<string, unknown>[]) {
    if (!t || typeof t !== 'object') continue;
    for (const f of ID_FIELDS) if (typeof t[f] === 'string' && t[f]) t[f] = pseudonym(t[f] as string);
  }
  if (Array.isArray(d.bankCredits)) for (const b of d.bankCredits as Record<string, unknown>[])
    if (b && typeof b.beneficiaryAccount === 'string') b.beneficiaryAccount = pseudonym(b.beneficiaryAccount);
  return d;
}

/** First pilot adapter: uploaded mre-dataset/v1 JSON. Provider adapters should map into the same canonical shape. */
export function parseCanonicalDataset(raw: unknown): DatasetAdapterResult {
  const parsed = datasetToScenario(pseudonymize(raw));
  return { ok: parsed.ok, scenario: parsed.scenario, errors: parsed.errors, warnings: parsed.warnings };
}
