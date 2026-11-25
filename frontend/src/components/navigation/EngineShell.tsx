import { NavLink, Outlet } from 'react-router-dom';
import { Activity, BarChart3, Boxes, BrainCircuit, FileSearch, FileUp, GitFork, ListChecks, ScrollText, ShieldAlert, Store } from 'lucide-react';
import { PublicNav } from './PublicNav';
import { SignInGate, SignedInAs } from './SignIn';
import { useInvestigation } from '../../hooks/useInvestigation';
import { pillLink, shellAside, shellBody, shellMain, shellMobileNav, shellRoot, sideLink } from './appNav';

const BASE_NAV = [
  { to: '/ai-engine', label: 'Workspace', icon: BrainCircuit, end: true },
  { to: '/ai-engine/analyze', label: 'Analyze & Bulk Scan', icon: FileUp, end: true },
  { to: '/ai-engine/portfolio', label: 'Portfolio Report', icon: Store, end: false },
  { to: '/ai-engine/improvements', label: 'Improvements', icon: BarChart3, end: true },
];
const RESULT_NAV = [
  { to: '/ai-engine/investigations', label: '7-Layer Findings', icon: FileSearch, end: false },
  { to: '/ai-engine/trace', label: 'Reasoning Trace', icon: ScrollText, end: false },
  { to: '/ai-engine/graph', label: 'Evidence Graph', icon: GitFork, end: false },
  { to: '/ai-engine/detection', label: 'Detectors', icon: Activity, end: false },
  { to: '/ai-engine/patterns', label: 'Patterns', icon: ListChecks, end: false },
  { to: '/ai-engine/analyst', label: 'Review', icon: Boxes, end: false },
  { to: '/ai-engine/response', label: 'Response', icon: ShieldAlert, end: false },
  { to: '/ai-engine/audit', label: 'Audit', icon: BarChart3, end: false },
];

export function EngineShell() {
  const { custom, started, detailsOpen, caseId } = useInvestigation();
  const hasRun = !!custom && started && detailsOpen;
  // A saved case keeps its views under /ai-engine/cases/:id/... so every page survives a reload.
  const caseNav = caseId ? RESULT_NAV.map(n => ({ ...n, to: n.to.replace('/ai-engine/', `/ai-engine/cases/${caseId}/`), end: true })) : RESULT_NAV;
  return (
    <div className={shellRoot}>
      <SignInGate>{(me, logout) => (
      <>
        {import.meta.env.VITE_CONSOLE === '1' ? null : <PublicNav />}
        <div className={shellBody}>
          <aside className={shellAside}>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="AI Engine"><div className="mre-eyebrow px-3 pb-3 pt-2">MRE / AI Engine</div>{BASE_NAV.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={sideLink}><n.icon size={16} />{n.label}</NavLink>)}</nav>
            <SignedInAs user={me} logout={logout} />
            <div className="border-t border-line p-4 text-[11px] text-dim">Uploads are analyzed by the local backend. No partner data connectors are configured.</div>
          </aside>
          <div className="min-w-0 flex-1">
            <main className={shellMain}>
              <nav className={shellMobileNav} aria-label="AI Engine mobile">{BASE_NAV.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={pillLink}>{n.label}</NavLink>)}</nav>
              <div className="rounded-md border border-line bg-panel lg:hidden"><SignedInAs user={me} logout={logout} /></div>
              {hasRun && (
                <nav className="flex w-full items-center gap-1.5 overflow-x-auto rounded-md border border-line bg-panel p-1.5" aria-label="Active case views">
                  <span className="shrink-0 px-2.5 font-mono text-[11px] uppercase tracking-label text-ink">{custom.profile.name}</span>
                  <span className="text-line2 shrink-0">|</span>
                  {caseNav.map(n => (
                    <NavLink key={n.to} to={n.to} end={n.end} className={pillLink}>
                      <n.icon size={13} />{n.label}
                    </NavLink>
                  ))}
                </nav>
              )}
              <Outlet />
            </main>
          </div>
        </div>
      </>
      )}</SignInGate>
    </div>
  );
}
