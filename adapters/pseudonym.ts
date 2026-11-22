/** Keyed pseudonyms for payer and beneficiary identifiers. Same output the server already stores. */
import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function pseudonym(raw: string, key: Buffer): string {
  return 'p_' + createHmac('sha256', key).update(raw).digest('hex').slice(0, 24);
}

let cached: Buffer | null = null;

/** Production requires MRE_HASH_KEY. Development keeps backend/data/.hashkey (mode 0600). */
export function loadHashKey(): Buffer {
  if (cached && !process.env.MRE_HASH_KEY) return cached;
  if (process.env.MRE_HASH_KEY) {
    if (process.env.NODE_ENV === 'production' && (process.env.MRE_HASH_KEY.length < 16 || /change-?me/i.test(process.env.MRE_HASH_KEY))) throw new Error('MRE_HASH_KEY must be a random secret of at least 16 characters.');
    return Buffer.from(process.env.MRE_HASH_KEY, 'utf8');
  }
  if (process.env.NODE_ENV === 'production') throw new Error('MRE_HASH_KEY is required in production.');
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend', 'data', '.hashkey');
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  chmodSync(file, 0o600);
  return (cached = Buffer.from(readFileSync(file, 'utf8').trim(), 'utf8'));
}
