import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InvestigationResult, ResponseLevel, UserState } from '../../frontend/src/types/investigation';
import type { Label } from '../../frontend/src/types/merchant';
import type { ResponsePlan } from '../../frontend/src/engines/responseEngine';
import type { ReliabilityUpdate } from '../../frontend/src/engines/learningEngine';

export interface CaseRecord {
  id: string;
  createdAt: string;
  engineVersion?: string;
  dataset: unknown;
  result: InvestigationResult;
  user: UserState;
  response: ResponsePlan | null;
  learning: { updates: ReliabilityUpdate[]; profile: string[] } | null;
}

// Local development store. Replace with a shared database adapter before a multi-user pilot.
const mem = new Map<string, CaseRecord>();

function dir(): string | null {
  if (process.env.MRE_CASE_STORE === 'memory') return null;
  if (process.env.VERCEL) return '/tmp/mre-cases';
  return join(dirname(fileURLToPath(import.meta.url)), 'data');
}

function fileFor(id: string): string | null {
  const root = dir();
  return root ? join(root, `${id}.json`) : null;
}

export function putCase(rec: CaseRecord): void {
  mem.set(rec.id, rec);
  const file = fileFor(rec.id);
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(rec), { mode: 0o600 });
  renameSync(temporary, file);
}

export function listCases(): CaseRecord[] {
  const root = dir();
  if (!root) return [...mem.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  mkdirSync(root, { recursive: true });
  const records = new Map<string, CaseRecord>([...mem.values()].map(rec => [rec.id, rec]));
  for (const name of readdirSync(root)) {
    if (!name.endsWith('.json')) continue;
    try {
      const rec = JSON.parse(readFileSync(join(root, name), 'utf8')) as CaseRecord;
      if (rec && typeof rec.id === 'string' && rec.result) records.set(rec.id, rec);
    } catch {
      // Ignore a damaged case file in the list; individual case retrieval reports it as unavailable.
    }
  }
  return [...records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getCase(id: string): CaseRecord | undefined {
  const hit = mem.get(id);
  if (hit) return hit;
  const file = fileFor(id);
  if (!file) return;
  try {
    const rec = JSON.parse(readFileSync(file, 'utf8')) as CaseRecord;
    mem.set(rec.id, rec);
    return rec;
  } catch {
    return;
  }
}

export const emptyUser = (): UserState => ({
  notes: '', clarification: '', chosenLevel: null, legalVerified: false, escrowConfirmed: false, executed: false, label: null, audit: [],
});

export function readUser(input: unknown, base: UserState): UserState {
  if (!input || typeof input !== 'object') return base;
  const u = input as Partial<UserState>;
  const level = u.chosenLevel;
  const levels: ResponseLevel[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];
  const labels: Label[] = ['CONFIRMED_ILLICIT', 'ADJUDICATED_BENIGN', 'UNRESOLVED'];
  return {
    ...base,
    notes: typeof u.notes === 'string' ? u.notes.slice(0, 2000) : base.notes,
    clarification: typeof u.clarification === 'string' ? u.clarification.slice(0, 2000) : base.clarification,
    chosenLevel: level && levels.includes(level) ? level : base.chosenLevel,
    legalVerified: typeof u.legalVerified === 'boolean' ? u.legalVerified : base.legalVerified,
    escrowConfirmed: typeof u.escrowConfirmed === 'boolean' ? u.escrowConfirmed : base.escrowConfirmed,
    executed: base.executed,
    label: u.label && labels.includes(u.label) ? u.label : base.label,
    audit: base.audit,
  };
}
