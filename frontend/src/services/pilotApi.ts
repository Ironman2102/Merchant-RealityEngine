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
  audit: { seq?: number; at: string; actor: string; action: string; detail: string; prevHash?: string; hash?: string }[];
  auditIntact?: boolean;
  pending?: { response?: { level: string; by: { id: number; username: string }; at: string }; label?: { label: string; by: { id: number; username: string }; at: string } };
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

export async function updatePilotCase(id: string, action: 'review' | 'response' | 'label' | 'approve', payload: Record<string, unknown>): Promise<Record<string, any>> {
  const response = await fetch(`/api/investigations/${encodeURIComponent(id)}/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Could not save case update (${response.status}).`);
  return body;
}

/* ---------- auth ---------- */
export interface SessionUser { id: number; username: string; role: 'analyst' | 'reviewer' | 'legal' | 'admin' }
export async function me(): Promise<SessionUser | null> {
  const r = await fetch('/api/auth/me');
  return r.ok ? ((await r.json()) as { user: SessionUser }).user : null;
}
export async function signIn(username: string, password: string): Promise<SessionUser> {
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || 'Sign-in failed.');
  return body.user as SessionUser;
}
export const signOut = () => fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

export async function approvePilotCase(id: string, approve: boolean, extra: { escrowConfirmed?: boolean; reason?: string } = {}) {
  return updatePilotCase(id, 'approve', { approve, ...extra });
}
export async function getPilotJson(id: string, what: 'trace' | 'pack' | 'audit'): Promise<Record<string, any>> {
  const r = await fetch(`/api/investigations/${encodeURIComponent(id)}/${what}`);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Could not load ${what} (${r.status}).`);
  return body;
}
