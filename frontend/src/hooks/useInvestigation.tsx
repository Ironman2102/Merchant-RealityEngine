import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { InvestigationResult, LayerId, LayerStatus, ResponseLevel, UserState, ActionRecord } from '../types/investigation';
import type { Label, Scenario, ScenarioId } from '../types/merchant';
import { getScenario } from '../data/scenarios';
import { runInvestigation } from '../engines/investigationEngine';
import { actionLog, planResponse } from '../engines/responseEngine';
import { fmtDateTime } from '../utils/format';
import { extent } from '../utils/num';
import { LAYERS } from '../data/evidence';
import { approvePilotCase, updatePilotCase, type ServerInvestigation, type ServerUser } from '../services/pilotApi';

const IDS: LayerId[] = [1, 2, 3, 4, 5, 6, 7];
const idle = (): Record<LayerId, LayerStatus> => ({ 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending', 6: 'pending', 7: 'pending' });
const freshUser = (): UserState => ({ notes: '', clarification: '', chosenLevel: null, legalVerified: false, escrowConfirmed: false, executed: false, label: null, audit: [] });

export type ActiveId = ScenarioId | 'custom';
interface Ctx {
  scenarioId: ActiveId; scenario: Scenario; custom: Scenario | null; loadCustom: (sc: Scenario, runNow?: boolean, instant?: boolean) => void; clearCustom: () => void; result: InvestigationResult;
  status: Record<LayerId, LayerStatus>; started: boolean; running: boolean; allDone: boolean; fast: boolean; setFast: (b: boolean) => void; detailsOpen: boolean; setDetailsOpen: (open: boolean) => void;
  selectedLayer: LayerId; selectLayer: (n: LayerId) => void;
  setScenario: (id: ActiveId) => void; run: (id?: ActiveId) => void; reset: () => void;
  done: (n: LayerId) => boolean;
  user: UserState; patch: (p: Partial<UserState>) => void; note: (action: string, detail?: string, actor?: string) => void;
  setLevel: (l: ResponseLevel | null) => void; execute: () => void; setLabel: (l: Label | null) => void; rejectLabel: () => void;
  audit: ActionRecord[];
  /** Saved-case mode: analyst actions are written to the server and the server's reply replaces local state. */
  verifyPassport: (id: string, ok: boolean) => void; endorsePassport: (id: string) => void; revokePassport: (id: string, reason: string) => void; submitPassport: (body: Record<string, unknown>) => void;
  caseId: string | null; loadCase: (id: string, sc: Scenario, server: ServerUser, animate?: boolean) => void; syncError: string;
  /** Server-side governance state for a saved case: proposals waiting for a second person, and audit-chain status. */
  pending: ServerUser['pending']; inForce: ServerUser['inForce']; restrictions: NonNullable<ServerUser['restrictions']>; auditIntact: boolean | null; approve: (approve: boolean, extra?: { escrowConfirmed?: boolean; reason?: string; proposedAt?: string; level?: string }) => void;
}
const C = createContext<Ctx | null>(null);
export const useInvestigation = () => { const c = useContext(C); if (!c) throw new Error('InvestigationProvider missing'); return c; };

export function InvestigationProvider({ children }: { children: ReactNode }) {
  const [scenarioId, setScenarioId] = useState<ActiveId>('bakery');
  const [custom, setCustom] = useState<Scenario | null>(null);
  const [status, setStatus] = useState(idle());
  const [started, setStarted] = useState(false);
  const [fast, setFast] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedLayer, selectLayer] = useState<LayerId>(1);
  const [user, setUser] = useState<UserState>(freshUser());
  const [caseId, setCaseId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState('');
  const [pending, setPending] = useState<ServerUser['pending']>({});
  const [inForce, setInForce] = useState<ServerUser['inForce']>(null);
  const [restrictions, setRestrictions] = useState<NonNullable<ServerUser['restrictions']>>([]);
  const [auditIntact, setAuditIntact] = useState<boolean | null>(null);
  const userRef = useRef(user);
  userRef.current = user;
  const token = useRef(0);
  const pick = useCallback((id: ActiveId) => (id === 'custom' && custom ? custom : getScenario(id === 'custom' ? 'bakery' : id)), [custom]);
  // Saved cases show what the server decided (promoted rules, verified passports), never a local re-run.
  const [saved, setSaved] = useState<{ scenario: Scenario; investigation: ServerInvestigation } | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const picked = useMemo(() => pick(scenarioId), [scenarioId, pick]);
  const scenario = useMemo<Scenario>(() => caseId && saved ? saved.scenario
    : !caseId && checked.length ? { ...picked, passports: picked.passports?.map(p => (checked.includes(p.id) ? { ...p, status: 'VERIFIED' as const, reviewedBy: 'demo reviewer' } : p)) }
      : picked, [picked, caseId, saved, checked]);
  const result = useMemo<InvestigationResult>(() => caseId && saved
    ? { ...saved.investigation, scenario, events: scenario.events.filter(e => e.merchantId === scenario.primaryMerchantId) }
    : runInvestigation(scenario), [scenario, caseId, saved]);
  const running = IDS.some(n => status[n] === 'running');
  const allDone = IDS.every(n => status[n] === 'done');

  const reset = useCallback(() => { token.current++; setStatus(idle()); setStarted(false); setDetailsOpen(false); setUser(freshUser()); setChecked([]); selectLayer(1); }, []);
  const setScenario = useCallback((id: ActiveId) => { token.current++; setCaseId(null); setSaved(null); setChecked([]); setScenarioId(id); setStatus(idle()); setStarted(false); setDetailsOpen(false); setUser(freshUser()); selectLayer(1); }, []);
  const start = useCallback((res: InvestigationResult) => {
    const my = ++token.current;
    setUser(freshUser()); setStatus(idle()); setStarted(true); setDetailsOpen(false); selectLayer(1);
    (async () => {
      for (const n of IDS) {
        if (token.current !== my) return;
        setStatus(s => ({ ...s, [n]: 'running' })); selectLayer(n);
        const ms = res.timelines[n].reduce((s, t) => s + t.ms, 0) * (fast ? 0.12 : 1);
        await new Promise(r => setTimeout(r, ms));
        if (token.current !== my) return;
        setStatus(s => ({ ...s, [n]: 'done' }));
      }
      // Show the evidence as soon as the run finishes; "Hide evidence" still collapses it.
      if (token.current === my) setDetailsOpen(true);
    })();
  }, [fast]);
  const run = useCallback((id?: ActiveId) => { if (id) { setCaseId(null); setSaved(null); setChecked([]); setScenarioId(id); } start(id ? runInvestigation(pick(id)) : result); }, [result, pick, start]);
  const loadCustom = useCallback((sc: Scenario, runNow = true, instant = false) => {
    token.current++; setCaseId(null); setSaved(null); setChecked([]); setCustom(sc); setScenarioId('custom'); setUser(freshUser()); selectLayer(1);
    if (instant) {
      setStatus({ 1: 'done', 2: 'done', 3: 'done', 4: 'done', 5: 'done', 6: 'done', 7: 'done' });
      setStarted(true);
      setDetailsOpen(true);
      return;
    }
    setStatus(idle()); setStarted(false); setDetailsOpen(false);
    if (runNow) start(runInvestigation(sc));
  }, [start]);
  const clearCustom = useCallback(() => {
    token.current++; setCaseId(null); setSaved(null); setChecked([]); setCustom(null); setScenarioId('bakery'); setStatus(idle()); setStarted(false); setDetailsOpen(false); setUser(freshUser()); selectLayer(1);
  }, []);
  useEffect(() => () => { token.current++; }, []);

  const adopt = useCallback((s: ServerUser) => {
    if (s.investigation && s.scenario) setSaved({ scenario: s.scenario, investigation: s.investigation });
    setPending(s.pending ?? {}); setInForce(s.inForce ?? null); setRestrictions(s.restrictions ?? []); setAuditIntact(s.auditIntact ?? null);
    setUser(u => ({
      ...u, notes: s.user.notes, clarification: s.user.clarification, chosenLevel: (s.user.chosenLevel as ResponseLevel | null), legalVerified: s.user.legalVerified,
      escrowConfirmed: s.user.escrowConfirmed, executed: s.user.executed, label: (s.user.label as Label | null),
      audit: s.audit.map((a, i) => ({ seq: a.seq ?? i + 1, at: fmtDateTime(Date.parse(a.at)), actor: a.actor, action: a.action, detail: a.detail, hash: a.hash })),
    }));
  }, []);
  const loadCase = useCallback((id: string, sc: Scenario, server: ServerUser, animate = false) => {
    token.current++; setCustom(sc); setScenarioId('custom'); setCaseId(id); setSyncError(''); selectLayer(1);
    setUser(freshUser()); adopt(server);
    if (animate) { setDetailsOpen(false); const my = token.current; void (async () => { setStarted(true); for (const n of IDS) { if (token.current !== my) return; setStatus(st => ({ ...st, [n]: 'running' })); selectLayer(n); await new Promise(r => setTimeout(r, 350)); if (token.current !== my) return; setStatus(st => ({ ...st, [n]: 'done' })); } setDetailsOpen(true); })(); }
    else { setStatus({ 1: 'done', 2: 'done', 3: 'done', 4: 'done', 5: 'done', 6: 'done', 7: 'done' }); setStarted(true); setDetailsOpen(true); }
  }, [adopt]);
  const sync = useCallback(async (action: 'review' | 'response' | 'label' | 'passport' | 'passport-review' | 'passport-revoke', payload: Record<string, unknown>) => {
    if (!caseId) return;
    setSyncError('');
    try { adopt(await updatePilotCase(caseId, action, payload) as ServerUser); }
    catch (e) { setSyncError(e instanceof Error ? e.message : 'Could not save to the case record.'); }
  }, [caseId, adopt]);
  const approve = useCallback((ok: boolean, extra: { escrowConfirmed?: boolean; reason?: string; proposedAt?: string; level?: string } = {}) => {
    if (!caseId) return;
    setSyncError('');
    approvePilotCase(caseId, ok, extra).then(r => adopt(r as ServerUser)).catch(e => setSyncError(e instanceof Error ? e.message : 'Could not save the approval.'));
  }, [caseId, adopt]);

  const submitPassport = useCallback((body: Record<string, unknown>) => void sync('passport', body), [sync]);
  const endorsePassport = useCallback((id: string) => void sync('passport', { endorse: id }), [sync]);
  const revokePassport = useCallback((id: string, reason: string) => void sync('passport-revoke', { passportId: id, reason }), [sync]);
  const verifyPassport = useCallback((id: string, ok: boolean) => {
    if (caseId) { void sync('passport-review', { passportId: id, verify: ok }); return; }
    if (ok) setChecked(c => [...c, id]);
  }, [caseId, sync]);

  const patch = useCallback((p: Partial<UserState>) => setUser(u => ({ ...u, ...p })), []);
  const t0 = useMemo(() => (extent(scenario.events, e => e.eventTime)?.[1] ?? 0) + 3600000, [scenario]);
  const note = useCallback((action: string, detail = '', actor = 'Analyst (demo user)') => caseId ? void sync('review', { notes: userRef.current.notes, clarification: userRef.current.clarification }) : setUser(u => ({ ...u, audit: [...u.audit, { seq: u.audit.length + 1, at: fmtDateTime(t0 + (30 + u.audit.length * 4) * 60000), actor, action, detail }] })), [t0, caseId, sync]);
  const setLevel = useCallback((l: ResponseLevel | null) => setUser(u => ({ ...u, chosenLevel: l, executed: false })), []);
  const setLabel = useCallback((l: Label | null) => { if (caseId) { if (l) void sync('label', { label: l }); return; } setUser(u => ({ ...u, label: l })); }, [caseId, sync]);
  const rejectLabel = useCallback(() => void sync('label', { reject: true }), [sync]);
  const execute = useCallback(() => caseId ? void sync('response', { chosenLevel: userRef.current.chosenLevel ?? result.review.recommended, legalVerified: userRef.current.legalVerified, escrowConfirmed: userRef.current.escrowConfirmed }) : setUser(u => {
    const plan = planResponse(result, u);
    if (plan.blocked.length) return u;
    return { ...u, executed: true, audit: [...u.audit, ...actionLog(result, plan, u.audit.length).map(a => ({ ...a, seq: a.seq }))] };
  }), [result, caseId, sync]);

  const audit = useMemo<ActionRecord[]>(() => {
    const sys: ActionRecord[] = LAYERS.filter(l => status[l.n] === 'done').map((l, i) => ({ seq: 0, at: fmtDateTime(t0 + i * 60000), actor: 'MRE pipeline', action: `${l.code} ${l.name} complete`, detail: l.outputs.join('; ') }));
    return [...sys, ...user.audit].map((a, i) => ({ ...a, seq: i + 1 }));
  }, [status, user.audit, t0]);

  const v: Ctx = { scenarioId, scenario, custom, loadCustom, clearCustom, result, status, started, running, allDone, fast, setFast, detailsOpen, setDetailsOpen, selectedLayer, selectLayer, setScenario, run, reset, done: n => status[n] === 'done', user, patch, note, setLevel, execute, setLabel, rejectLabel, audit, caseId, loadCase, syncError, pending, inForce, restrictions, auditIntact, approve, verifyPassport, submitPassport, endorsePassport, revokePassport };
  return <C.Provider value={v}>{children}</C.Provider>;
}
