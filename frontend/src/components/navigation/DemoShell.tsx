import { NavLink, Link, Outlet } from 'react-router-dom';
import { Activity, BarChart3, Briefcase, Boxes, FileSearch, GitFork, ListChecks, ScrollText, ShieldAlert, Store } from 'lucide-react';
import { PublicNav } from './PublicNav';
import { useInvestigation } from '../../hooks/useInvestigation';
import { pillLink, shellAside, shellBody, shellMain, shellMobileNav, shellRoot, sideLink } from './appNav';

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
    <div className={shellRoot}>
      <PublicNav />
      <div className={shellBody}>
        <aside className={shellAside}>
          <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="Guided demo"><div className="mre-eyebrow px-3 pb-3 pt-2">MRE / Guided demo</div>{visibleNav.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={sideLink}><n.icon size={16} />{n.label}</NavLink>)}</nav>
          <Link to="/ai-engine" className="border-t border-line p-4 text-[11px] font-semibold uppercase leading-relaxed tracking-label text-accent transition hover:text-accent-hi">Have your own data? Open AI Engine →</Link>
        </aside>
        <div className="min-w-0 flex-1">
          <main className={shellMain}>
            <nav className={shellMobileNav} aria-label="Guided demo mobile">{visibleNav.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={pillLink}>{n.label}</NavLink>)}</nav>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
