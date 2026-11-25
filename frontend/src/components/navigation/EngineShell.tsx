import { NavLink, Outlet } from 'react-router-dom';
import { Activity, BarChart3, Boxes, BrainCircuit, FileSearch, FileUp, GitFork, ListChecks, ScrollText, ShieldAlert, Store } from 'lucide-react';
import { PublicNav } from './PublicNav';
import { SignInGate, SignedInAs } from './SignIn';
import { useInvestigation } from '../../hooks/useInvestigation';
import { cx } from '../../utils/format';

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
    <div className="mre-app min-h-screen bg-bg text-ink">
      <SignInGate>{(me, logout) => (
      <>
        {import.meta.env.VITE_CONSOLE === '1' ? null : <PublicNav />}
        <div className="flex min-h-[calc(100vh-3.5rem)] bg-bg">
          <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col border-r border-line bg-panel lg:flex">
            <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="AI Engine">{BASE_NAV.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors', isActive ? 'bg-white text-black font-semibold' : 'text-mute hover:bg-panel2 hover:text-ink')}><n.icon size={16} />{n.label}</NavLink>)}</nav>
            <SignedInAs user={me} logout={logout} />
            <div className="border-t border-line p-4 text-[11px] text-dim">Uploads are analyzed by the local backend. No partner data connectors are configured.</div>
          </aside>
          <div className="min-w-0 flex-1">
            <main className="mx-auto max-w-[1280px] space-y-6 px-5 py-6">
              <nav className="flex w-full gap-1 overflow-x-auto pb-1 lg:hidden" aria-label="AI Engine mobile">{BASE_NAV.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium', isActive ? 'bg-white text-black' : 'text-mute')}>{n.label}</NavLink>)}</nav>
              <div className="rounded-lg border border-line bg-panel lg:hidden"><SignedInAs user={me} logout={logout} /></div>
              {hasRun && (
                <nav className="flex w-full items-center gap-1 overflow-x-auto rounded-xl border border-line bg-panel p-1.5" aria-label="Active case views">
                  <span className="px-2.5 text-xs font-semibold text-ink shrink-0">{custom.profile.name}</span>
                  <span className="text-line2 shrink-0">|</span>
                  {caseNav.map(n => (
                    <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors', isActive ? 'bg-white text-black font-semibold' : 'text-mute hover:bg-panel2 hover:text-ink')}>
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
