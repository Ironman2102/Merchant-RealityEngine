import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { LoafMark } from '../common/Logo';
import { cx } from '../../utils/format';

export function useScrollTo() {
  const nav = useNavigate(), loc = useLocation();
  return (id: string) => {
    if (loc.pathname === '/' && (loc.hash === `#${id}` || document.getElementById(id))) {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    nav({ pathname: '/', hash: `#${id}` }, { state: { scroll: id }, preventScrollReset: true });
  };
}

const ITEMS = [['Platform', 'platform'], ['How it works', 'how'], ['Technology', 'technology'], ['Use cases', 'use-cases'], ['Flowchart', 'workflow']] as const;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

export function PublicNav({ landing = false }: { landing?: boolean }) {
  const go = useScrollTo(), [open, setOpen] = useState(false), loc = useLocation();
  const [solid, setSolid] = useState(!landing);
  useEffect(() => {
    if (!landing) return;
    const on = () => setSolid(window.scrollY > window.innerHeight * 4.6);
    on(); window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [landing]);
  useEffect(() => { document.body.style.overflow = open ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [open]);
  const pick = (id: string) => { setOpen(false); go(id); };
  const active = (p: string) => loc.pathname.startsWith(p);

  return (
    <header className={cx('top-0 z-50 w-full transition-[background,border-color] duration-500', landing ? 'fixed' : 'sticky', solid ? 'border-b border-line bg-bg/85 backdrop-blur-xl' : 'border-b border-transparent bg-transparent')}>
      <nav className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 md:px-8" aria-label="Primary">
        <Link to="/" aria-label="Merchant Reality Engine home" className="flex shrink-0 items-center gap-2">
          <LoafMark size={24} />
          <span className="font-display text-[22px] font-extrabold leading-none tracking-[-.06em]">MRE.</span>
        </Link>
        <div className="hidden items-center gap-6 xl:flex">
          {ITEMS.map(([l, id], i) => (
            <button key={id} onClick={() => go(id)} className="group flex items-baseline gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[.16em] text-mute transition hover:text-ink">
              <span className="text-crust">0{i + 1}.</span>{l}
            </button>
          ))}
          <Link to="/architecture" className={cx('flex items-baseline gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[.16em] transition hover:text-ink', active('/architecture') ? 'text-ink' : 'text-mute')}><span className="text-crust">06.</span>Architecture</Link>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/demo" className={cx('hidden rounded-full border px-4 py-2 font-mono text-[11px] font-bold tracking-[.16em] transition sm:inline-flex', active('/demo') ? 'border-ink text-ink' : 'border-line2 text-ink hover:border-ink')}>DEMO</Link>
          <Link to="/ai-engine" className="hidden items-center gap-1.5 rounded-full bg-crust px-4 py-2 font-mono text-[11px] font-bold tracking-[.16em] text-[#140b05] transition hover:bg-[#ff8a4c] sm:inline-flex">AI ENGINE <ArrowUpRight size={14} strokeWidth={2.6} /></Link>
          <button className="rounded-full border border-line2 p-2 text-ink xl:hidden" onClick={() => setOpen(v => !v)} aria-label="Toggle navigation" aria-expanded={open}>{open ? <X size={18} /> : <Menu size={18} />}</button>
        </div>
      </nav>
      {open && (
        <div className="fixed inset-x-0 bottom-0 top-14 z-50 overflow-y-auto bg-bg px-6 pb-10 pt-6 xl:hidden">
          <div className="grid gap-1">
            {ITEMS.map(([l, id], i) => (
              <button key={id} onClick={() => pick(id)} className="flex items-baseline gap-4 border-b border-line py-4 text-left">
                <span className="w-8 font-mono text-xs text-crust">{ROMAN[i]}</span><span className="font-display text-3xl font-semibold tracking-tight">{l}</span>
              </button>
            ))}
            <Link onClick={() => setOpen(false)} to="/architecture" className="flex items-baseline gap-4 border-b border-line py-4"><span className="w-8 font-mono text-xs text-crust">{ROMAN[5]}</span><span className="font-display text-3xl font-semibold tracking-tight">Architecture</span></Link>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link onClick={() => setOpen(false)} to="/demo" className="mre-pill mre-pill-ghost">GUIDED DEMO</Link>
            <Link onClick={() => setOpen(false)} to="/ai-engine" className="mre-pill mre-pill-solid">AI ENGINE <ArrowUpRight size={15} /></Link>
          </div>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  const go = useScrollTo();
  return (
    <footer className="relative overflow-hidden border-t border-line bg-bg">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-14 md:grid-cols-12 md:px-8">
        <div className="md:col-span-6">
          <div className="flex items-center gap-2"><LoafMark size={28} /><span className="font-display text-2xl font-extrabold tracking-[-.05em]">MRE.</span></div>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-mute">Does a merchant’s declared business match its financial, operational and digital behaviour?</p>
        </div>
        <div className="md:col-span-3">
          <div className="mre-label text-dim">Product</div>
          <div className="mt-4 space-y-2.5 text-sm text-mute">
            <button onClick={() => go('platform')} className="block hover:text-ink">Platform</button>
            <Link to="/architecture" className="block hover:text-ink">Architecture</Link>
            <Link to="/ai-engine" className="block hover:text-ink">AI Engine</Link>
            <Link to="/demo" className="block hover:text-ink">Demo</Link>
          </div>
        </div>
        <div className="md:col-span-3">
          <div className="mre-label text-dim">Contact</div>
          <a href="mailto:321dhruv.b@gmail.com" className="mt-4 block break-all text-sm text-mute hover:text-ink">321dhruv.b@gmail.com</a>
        </div>
      </div>
      <div aria-hidden="true" className="pointer-events-none select-none px-4 font-display text-[22vw] font-extrabold leading-[.72] tracking-[-.07em] text-[#1a1511] md:px-8">MRE.</div>
      <div id="disclaimer" className="border-t border-line px-4 py-6 md:px-8"><p className="mx-auto max-w-[1440px] text-xs leading-relaxed text-dim">Disclaimer. Merchant Reality Engine is a prototype. All merchants, transactions, websites and figures are synthetic and illustrate the architecture; none is verified real-world evidence. References to other companies describe design inspiration only and imply no partnership, endorsement or use of proprietary technology. The response design is a product proposal, not a statement of legal or regulatory requirements, and the system never freezes funds automatically. There are no customers, testimonials or performance claims on this site.</p></div>
    </footer>
  );
}
