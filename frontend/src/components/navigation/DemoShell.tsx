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
    <div className="mre-app min-h-screen bg-bg text-ink">
      <PublicNav />
      <div className="flex min-h-[calc(100vh-3.5rem)] bg-bg">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 flex-col border-r border-line bg-[#100d0b] lg:flex">
          <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="Guided demo"><div className="mre-label px-3 pb-3 pt-2 text-[10px] text-dim">Guided demo</div>{visibleNav.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13.5px] transition-colors', isActive ? 'bg-[#2a1a10] text-ink font-semibold shadow-[inset_2px_0_0_#ff6a2b] [&>svg]:text-crust' : 'text-mute hover:bg-panel2 hover:text-ink')}><n.icon size={16} />{n.label}</NavLink>)}</nav>
          <Link to="/ai-engine" className="border-t border-line p-4 text-xs font-medium text-crust transition hover:bg-panel2">Have your own data? Open AI Engine →</Link>
        </aside>
        <div className="min-w-0 flex-1">
          <main className="mx-auto max-w-[1280px] space-y-6 px-5 py-6">
            <nav className="flex w-full gap-1 overflow-x-auto pb-1 lg:hidden" aria-label="Guided demo mobile">{visibleNav.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium', isActive ? 'border-crust bg-crust text-[#140b05]' : 'border-line2 text-mute')}>{n.label}</NavLink>)}</nav>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
