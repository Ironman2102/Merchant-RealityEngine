export interface PilotCaseSummary {
  id: string;
  createdAt: string;
  merchant: { id: string; name: string; category: string; city: string };
  result: { decision: string; priority: string; recommended: string; legitStatus: string };
  user: { executed: boolean; label: string | null };
  workflow: { layer: number; code: string; name: string; state: 'done' | 'waiting' | 'blocked'; summary: string }[];
}

import type { Scenario } from '../types/merchant';

/** The server's view of the human side of a case. Local state is replaced by this after every write. */
export interface ServerUser {
  user: { notes: string; clarification: string; chosenLevel: string | null; legalVerified: boolean; escrowConfirmed: boolean; executed: boolean; label: string | null };
  audit: { at: string; actor: string; action: string; detail: string }[];
}
export type PilotCase = ServerUser & { id: string; createdAt: string; scenario: Scenario; [k: string]: unknown };

export async function listPilotCases(): Promise<PilotCaseSummary[]> {
  const response = await fetch('/api/investigations');
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Could not load cases (${response.status}).`);
  return Array.isArray(body.cases) ? body.cases as PilotCaseSummary[] : [];
}

export async function getPilotCase(id: string): Promise<PilotCase> {
  const response = await fetch(`/api/investigations/${encodeURIComponent(id)}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Could not load case (${response.status}).`);
  return body;
}

export async function updatePilotCase(id: string, action: 'review' | 'response' | 'label', payload: Record<string, unknown>): Promise<Record<string, any>> {
  const response = await fetch(`/api/investigations/${encodeURIComponent(id)}/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Could not save case update (${response.status}).`);
  return body;
}
