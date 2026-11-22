/** Keyed pseudonyms for payer and beneficiary identifiers. Same output the server already stores. */
import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function pseudonym(raw: string, key: Buffer): string {
  return 'p_' + createHmac('sha256', key).update(raw).digest('hex').slice(0, 24);
}

export const ID_FIELDS = ['payerId', 'paidTo', 'beneficiaryAccount', 'payerMobile', 'destHolder'] as const;

/** Replaces identifiers in place. A phone or account number sent as a JSON number is still an identifier. */
export function maskIds(row: object, key: () => Buffer, fields: readonly string[] = ID_FIELDS): void {
  const r = row as Record<string, unknown>;
  for (const f of fields) {
    const v = r[f];
    if ((typeof v === 'string' && v) || typeof v === 'number') r[f] = pseudonym(String(v), key());
  }
}

let cached: Buffer | null = null;

const PLACEHOLDER = /change[-_ ]?me|placeholder|replace[-_ ]?(me|this)|your[-_ ](secret|key|password)/i;
const GUESSABLE = /passw(or|0r)d|secret|admin|qwerty|letmein|welcome|merchant|bakery|netlify|default|example|123456789|12345678|1234567|123456|12345|1234/gi;
/** Too short, a documented placeholder, hardly any distinct characters, or little more than guessable words. */
export const weakSecret = (value: string, minLength = 16) => value.length < minLength || PLACEHOLDER.test(value) || new Set(value).size < 5
  || value.replace(GUESSABLE, '').replace(/[-_ .!@]/g, '').length < 6;

/** A host other than a developer's machine. Function hosts often leave NODE_ENV unset. */
export const hosted = () => process.env.NODE_ENV === 'production' || process.env.MRE_STATELESS_SESSIONS === '1'
  || ['NETLIFY', 'VERCEL', 'AWS_LAMBDA_FUNCTION_NAME'].some(n => !!process.env[n]);

/** A weak key is refused everywhere. A host requires a key; development keeps backend/data/.hashkey (mode 0600). */
export function loadHashKey(): Buffer {
  const given = process.env.MRE_HASH_KEY;
  if (given) {
    if (weakSecret(given)) throw new Error('MRE_HASH_KEY must be a random secret of at least 16 characters, not a placeholder.');
    return Buffer.from(given, 'utf8');
  }
  if (hosted()) throw new Error('MRE_HASH_KEY is required on a hosted or production server.');
  if (cached) return cached;
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend', 'data', '.hashkey');
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  chmodSync(file, 0o600);
  return (cached = Buffer.from(readFileSync(file, 'utf8').trim(), 'utf8'));
}
