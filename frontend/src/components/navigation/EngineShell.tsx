import { NavLink, Outlet } from 'react-router-dom';
import { Activity, BarChart3, Boxes, BrainCircuit, FileSearch, FileUp, GitFork, ListChecks, ScrollText, ShieldAlert, Store } from 'lucide-react';
import { PublicNav } from './PublicNav';
import { SignInGate, SignedInAs } from './SignIn';
import { useInvestigation } from '../../hooks/useInvestigation';
import { cx } from '../../utils/format';

const BASE_NAV = [
  { to: '/ai-engine', label: 'My workspace', icon: BrainCircuit, end: true },
  { to: '/ai-engine/analyze', label: 'Analyze your data', icon: FileUp, end: true },
  { to: '/ai-engine/portfolio', label: 'My results', icon: Store, end: false },
];
const RESULT_NAV = [
  { to: '/ai-engine/investigations', label: 'Seven-layer findings', icon: FileSearch, end: false },
  { to: '/ai-engine/trace', label: 'Reasoning trace', icon: ScrollText, end: false },
  { to: '/ai-engine/graph', label: 'Evidence connections', icon: GitFork, end: false },
  { to: '/ai-engine/patterns', label: 'Pattern details', icon: ListChecks, end: false },
  { to: '/ai-engine/detection', label: 'Detection details', icon: Activity, end: false },
  { to: '/ai-engine/analyst', label: 'Review findings', icon: Boxes, end: false },
  { to: '/ai-engine/response', label: 'Response plan', icon: ShieldAlert, end: false },
  { to: '/ai-engine/audit', label: 'Analysis record', icon: BarChart3, end: false },
];

export function EngineShell() {
  const { custom, started, detailsOpen, caseId } = useInvestigation();
  const hasRun = !!custom && started;
  // A saved case keeps its views under /ai-engine/cases/:id/... so every page survives a reload.
  const caseNav = caseId ? RESULT_NAV.map(n => ({ ...n, to: n.to.replace('/ai-engine/', `/ai-engine/cases/${caseId}/`), end: true })) : RESULT_NAV;
  const nav = hasRun && detailsOpen ? [...BASE_NAV, ...caseNav] : BASE_NAV;
  return (
    <SignInGate>{(me, logout) => (
    <>
      <PublicNav landing />
      <div className="flex min-h-screen bg-bg">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-panel/60 lg:flex">
          <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="AI Engine">{nav.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex items-center gap-2.5 rounded px-3 py-2 text-sm transition-colors', isActive ? 'bg-zinc-400/10 text-zinc-200' : 'text-mute hover:bg-panel2 hover:text-ink')}><n.icon size={16} />{n.label}</NavLink>)}</nav>
          <SignedInAs user={me} logout={logout} />
          <div className="border-t border-line p-4 text-xs text-dim">Uploads are analyzed by the local backend. No partner data connectors are configured.</div>
        </aside>
        <div className="min-w-0 flex-1">
          <main className="mx-auto max-w-[1280px] space-y-6 px-5 py-6">
            <nav className="flex w-full gap-1 overflow-x-auto pb-1 lg:hidden" aria-label="AI Engine mobile">{nav.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('whitespace-nowrap rounded px-2.5 py-1 text-xs', isActive ? 'bg-zinc-400/10 text-zinc-200' : 'text-mute')}>{n.label}</NavLink>)}</nav>
            <div className="rounded border border-line lg:hidden"><SignedInAs user={me} logout={logout} /></div>
            <Outlet />
          </main>
        </div>
      </div>
    </>
    )}</SignInGate>
  );
}
