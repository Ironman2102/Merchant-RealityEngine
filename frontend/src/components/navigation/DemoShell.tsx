import { NavLink, Link, Outlet } from 'react-router-dom';
import { Activity, BarChart3, Briefcase, Boxes, FileSearch, GitFork, ListChecks, ScrollText, ShieldAlert, Store } from 'lucide-react';
import { PublicNav } from './PublicNav';
import { useInvestigation } from '../../hooks/useInvestigation';
import { cx } from '../../utils/format';

const NAV = [
  { to: '/demo', label: 'Six merchant scenarios', icon: Briefcase, end: true },
  { to: '/demo/investigations', label: 'Seven-layer run', icon: FileSearch },
  { to: '/demo/trace', label: 'Reasoning trace', icon: ScrollText },
  { to: '/demo/merchant', label: 'Merchant profile', icon: Store },
  { to: '/demo/graph', label: 'Evidence graph', icon: GitFork },
  { to: '/demo/detection', label: 'Detection engine', icon: Activity },
  { to: '/demo/patterns', label: 'Pattern board', icon: ListChecks },
  { to: '/demo/analyst', label: 'Analyst review', icon: Boxes },
  { to: '/demo/response', label: 'Response simulation', icon: ShieldAlert },
  { to: '/demo/audit', label: 'Audit and learning', icon: BarChart3 },
  { to: '/demo/portfolio', label: 'Six merchant results', icon: Briefcase },
];

export function DemoShell() {
  const { detailsOpen } = useInvestigation();
  const visibleNav = detailsOpen ? NAV : NAV.slice(0, 1);
  return (
    <div className="mre-light min-h-screen bg-bg text-ink">
      <PublicNav />
      <div className="flex min-h-[calc(100vh-3.5rem)] bg-bg">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col border-r border-line bg-panel lg:flex">
          <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="Guided demo">{visibleNav.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors', isActive ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-mute hover:bg-panel2 hover:text-ink')}><n.icon size={16} />{n.label}</NavLink>)}</nav>
          <Link to="/ai-engine" className="border-t border-line p-4 text-xs font-medium text-indigo-700 transition hover:bg-indigo-50/50">Have your own data? Open AI Engine →</Link>
        </aside>
        <div className="min-w-0 flex-1">
          <main className="mx-auto max-w-[1280px] space-y-6 px-5 py-6">
            <nav className="flex w-full gap-1 overflow-x-auto pb-1 lg:hidden" aria-label="Guided demo mobile">{visibleNav.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium', isActive ? 'bg-indigo-50 text-indigo-700' : 'text-mute')}>{n.label}</NavLink>)}</nav>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
