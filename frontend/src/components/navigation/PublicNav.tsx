import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { Logo } from '../common/Logo';

export function useScrollTo() {
  const nav = useNavigate(), loc = useLocation();
  return (id: string) => {
    if (loc.pathname === '/' && loc.hash === `#${id}`) {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    nav({ pathname: '/', hash: `#${id}` }, { state: { scroll: id }, preventScrollReset: true });
  };
}
const ITEMS = [['Platform', 'platform'], ['How It Works', 'how'], ['Technology', 'technology'], ['Use Cases', 'use-cases']] as const;

export function PublicNav({ landing = false }: { landing?: boolean }) {
  const go = useScrollTo(), [open, setOpen] = useState(false);
  if (landing) return (
    <header className="sticky top-0 z-40 bg-black px-5 pt-3 md:px-8">
      <nav className="mx-auto grid h-12 max-w-[1440px] grid-cols-[1fr_auto_1fr] items-center md:grid-cols-5" aria-label="Primary">
        <Link to="/demo" className="hidden justify-self-start text-[11px] font-semibold tracking-[.18em] text-accent transition hover:text-accent-hi md:col-start-1 md:block">DEMO</Link>
        <Link to="/ai-engine" className="hidden justify-self-center text-[11px] font-semibold tracking-[.18em] text-accent transition hover:text-accent-hi md:col-start-2 md:block">AI ENGINE</Link>
        <Link to="/" aria-label="Merchant Reality Engine home" className="col-start-2 justify-self-center text-[27px] font-black leading-none tracking-[-.07em] md:col-start-3">MRE.</Link>
        <button onClick={() => go('how')} className="hidden justify-self-center text-[11px] font-semibold tracking-[.18em] text-accent transition hover:text-accent-hi md:col-start-4 md:block">HOW IT WORKS</button>
        <button onClick={() => go('workflow')} className="hidden justify-self-end text-[11px] font-semibold tracking-[.18em] text-accent transition hover:text-accent-hi md:col-start-5 md:block">FLOWCHART</button>
        <button className="col-start-3 row-start-1 justify-self-end rounded p-2 text-accent md:hidden" onClick={() => setOpen(v => !v)} aria-label="Toggle navigation" aria-expanded={open}>{open ? <X size={20} /> : <Menu size={20} />}</button>
      </nav>
      {open && <div className="absolute inset-x-0 top-full z-50 grid gap-4 border-y border-white/15 bg-black px-6 py-5 text-xs font-semibold tracking-[.18em] text-accent md:hidden"><Link onClick={() => setOpen(false)} to="/demo">DEMO</Link><Link onClick={() => setOpen(false)} to="/ai-engine">AI ENGINE</Link><button className="text-left" onClick={() => { setOpen(false); go('how'); }}>HOW IT WORKS</button><button className="text-left" onClick={() => { setOpen(false); go('workflow'); }}>FLOWCHART</button></div>}
    </header>
  );
  const link = 'rounded px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-label transition';
  const route = ({ isActive }: { isActive: boolean }) => `${link} ${isActive ? 'text-ink' : 'text-accent hover:text-accent-hi'}`;
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-5">
        <Link to="/" aria-label="Merchant Reality Engine home" className="flex items-baseline gap-3"><span className="text-[24px] font-black leading-none tracking-[-.07em]">MRE.</span><span className="mre-eyebrow hidden !text-[10px] sm:inline">Merchant Reality Engine</span></Link>
        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Primary">
          {ITEMS.map(([l, id]) => <button key={id} onClick={() => go(id)} className={`${link} text-accent hover:text-accent-hi`}>{l}</button>)}
          <NavLink to="/architecture" className={route}>Architecture</NavLink>
          <NavLink to="/ai-engine" className={route}>AI Engine</NavLink>
          <NavLink to="/demo" className={route}>Guided demo</NavLink>
        </nav>
        <div className="flex items-center gap-2"><Link to="/ai-engine" className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-ink px-4 py-1.5 text-[11px] font-bold uppercase tracking-label transition hover:bg-ink hover:text-bg">Open AI Engine <ArrowUpRight size={14} strokeWidth={2.5} /></Link>
          <button className="rounded p-1.5 text-accent lg:hidden" onClick={() => setOpen(o => !o)} aria-label="Menu" aria-expanded={open}>{open ? <X size={20} /> : <Menu size={20} />}</button></div>
      </div>
      {open && <div className="grid gap-1 border-t border-line bg-bg px-5 py-4 text-[11px] font-semibold uppercase tracking-label lg:hidden">{ITEMS.map(([l, id]) => <button key={id} onClick={() => { setOpen(false); go(id); }} className="block w-full py-2 text-left text-accent">{l}</button>)}
        <Link to="/architecture" className="block py-2 text-accent" onClick={() => setOpen(false)}>Architecture</Link><Link to="/ai-engine" className="block py-2 text-accent" onClick={() => setOpen(false)}>AI Engine</Link><Link to="/demo" className="block py-2 text-accent" onClick={() => setOpen(false)}>Guided demo</Link></div>}
    </header>
  );
}

export function Footer() {
  const go = useScrollTo();
  return (
    <footer className="border-t border-line bg-black">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 md:grid-cols-4">
        <div className="md:col-span-2"><Logo small /><p className="mt-3 max-w-sm text-sm text-mute">Does a merchant’s declared business match its financial, operational and digital behaviour?</p></div>
        <div className="text-sm"><div className="mb-2 font-medium">Product</div><div className="space-y-1.5 text-mute"><button onClick={() => go('platform')} className="block hover:text-ink">Platform</button><Link to="/architecture" className="block hover:text-ink">Architecture</Link><Link to="/ai-engine" className="block hover:text-ink">AI Engine</Link><Link to="/demo" className="block hover:text-ink">Demo</Link></div></div>
        <div className="text-sm"><div className="mb-2 font-medium">Contact</div><a href="mailto:321dhruv.b@gmail.com" className="text-mute hover:text-ink">321dhruv.b@gmail.com</a></div>
      </div>
      <div id="disclaimer" className="border-t border-line px-5 py-5"><p className="mx-auto max-w-7xl text-xs leading-relaxed text-dim">Disclaimer. Merchant Reality Engine is a prototype. All merchants, transactions, websites and figures are synthetic and illustrate the architecture; none is verified real-world evidence. References to other companies describe design inspiration only and imply no partnership, endorsement or use of proprietary technology. The response design is a product proposal, not a statement of legal or regulatory requirements, and the system never freezes funds automatically. There are no customers, testimonials or performance claims on this site.</p></div>
    </footer>
  );
}
