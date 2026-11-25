import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import type { BakeryScene } from './bakeryScene';
import { cx } from '../../utils/format';

const smoother = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * t * (t * (t * 6 - 15) + 10); };
const band = (p: number, a: number, b: number, f = 0.035) => Math.min(smoother((p - a + f) / f), 1 - smoother((p - b) / f));

/* ── Loader: a loaf that proofs while the oven (GPU) warms up ── */
export function Loader({ ready }: { ready: boolean }) {
  const [pct, setPct] = useState(0), [gone, setGone] = useState(false), [exiting, setExiting] = useState(false);
  const minDone = useRef(false), [, force] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => { minDone.current = true; force(x => x + 1); }, reduce ? 300 : 2400);
    const safety = setTimeout(() => { minDone.current = true; setExiting(true); }, 12000);
    return () => { clearTimeout(t); clearTimeout(safety); };
  }, []);
  const goal = ready && minDone.current ? 100 : 78;
  useEffect(() => {
    let raf = 0;
    const tick = () => { setPct(p => { const n = p + (goal - p) * (goal === 100 ? 0.14 : 0.03); return Math.abs(goal - n) < 0.4 ? goal : n; }); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [goal]);
  useEffect(() => { if (pct >= 100 && !exiting) { const t = setTimeout(() => setExiting(true), 280); return () => clearTimeout(t); } }, [pct, exiting]);
  useEffect(() => {
    if (!exiting) { document.documentElement.style.overflow = 'hidden'; return; }
    window.scrollTo(0, window.location.hash ? window.scrollY : 0);
    document.documentElement.style.overflow = '';
    const t = setTimeout(() => setGone(true), 1100); return () => clearTimeout(t);
  }, [exiting]);
  useEffect(() => () => { document.documentElement.style.overflow = ''; }, []);
  if (gone) return null;
  const rise = 0.55 + (pct / 100) * 0.45;
  return (
    <div className={cx('mre-loader grain', exiting && 'is-exiting')} role="status" aria-label={`Loading ${Math.round(pct)} percent`}>
      <div className="flex w-[min(360px,80vw)] flex-col items-center">
        <svg viewBox="0 0 220 140" className="w-44" aria-hidden="true">
          <defs><linearGradient id="crustG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff8a4c" /><stop offset="1" stopColor="#b9501f" /></linearGradient></defs>
          <g className="loaf-rise" style={{ transform: `scaleY(${rise})` }}>
            <path d="M28 120c0-46 36-82 82-82s82 36 82 82c0 6-5 11-11 11H39c-6 0-11-5-11-11Z" fill="url(#crustG)" />
            {[0, 1, 2].map(i => <path key={i} d={`M${72 + i * 30} ${70 + (i === 1 ? -8 : 0)}l14 22`} stroke="#140b05" strokeWidth="6" strokeLinecap="round" opacity=".8" />)}
          </g>
          <path d="M14 132h192" stroke="#3e352c" strokeWidth="3" strokeLinecap="round" />
          {[0, 1, 2].map(i => <path key={i} d={`M${80 + i * 30} 30c-6-8 6-12 0-22`} stroke="#f6efe4" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity={Math.max(0, (pct - 30 - i * 15) / 60)} />)}
        </svg>
        <div className="mt-8 flex w-full items-baseline justify-between font-mono text-[11px] tracking-[.2em] text-mute"><span>PROOFING THE ENGINE</span><span className="tabular-nums text-ink">{String(Math.round(pct)).padStart(3, '0')}%</span></div>
        <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-crust" style={{ width: `${pct}%` }} /></div>
        <div className="mt-4 font-serif text-lg italic text-dim">Sweet Crumbs is opening up…</div>
      </div>
    </div>
  );
}

/* ── Word reveal (words brighten as the paragraph enters) ── */
export function Reveal({ text, className, as: Tag = 'p' }: { text: string; className?: string; as?: 'p' | 'h2' | 'div' }) {
  const ref = useRef<HTMLElement>(null), [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { rootMargin: '-18% 0px -10% 0px' });
    io.observe(el); return () => io.disconnect();
  }, []);
  const words = text.split(/\s+/);
  return (
    <Tag ref={ref as never} className={cx(className, on && 'is-revealed')}>
      {words.map((w, i) => <span key={i} className="inline-block"><span className="word-inner inline-block" style={{ transitionDelay: on ? `${Math.min(i * 28, 900)}ms` : '0ms' }}>{w}</span>{i < words.length - 1 ? ' ' : ''}</span>)}
    </Tag>
  );
}

/* ── Numbered section shell ── */
export function Chapter({ id, n, kicker, title, lead, children, className }: { id: string; n: string; kicker: string; title: ReactNode; lead?: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null), [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.2 });
    io.observe(el); return () => io.disconnect();
  }, []);
  return (
    <section id={id} className={cx('relative scroll-mt-16 py-24 md:py-32', className)}>
      <div className="mx-auto max-w-[1440px] px-4 md:px-8">
        <div ref={ref} className="grid gap-6 md:grid-cols-12">
          <div className="md:col-span-3">
            <div className="flex items-baseline gap-3 font-mono text-[12px] tracking-[.2em]"><span className="text-crust">{n}/</span><span className="text-mute uppercase">{kicker}</span></div>
            <div className="mre-rule mt-4 w-full transition-transform duration-[1200ms] ease-out" style={{ transform: `scaleX(${seen ? 1 : 0})` }} />
          </div>
          <div className="md:col-span-9">
            <h2 className={cx('max-w-4xl text-[clamp(2rem,4.6vw,4rem)] font-extrabold leading-[.98] tracking-[-.035em] transition-all duration-700', seen ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0')}>{title}</h2>
            {lead && <Reveal text={lead} className="mt-6 max-w-3xl text-[clamp(1.02rem,1.5vw,1.25rem)] leading-relaxed text-[#d9cdbb]" />}
          </div>
        </div>
        <div className="mt-14">{children}</div>
      </div>
    </section>
  );
}

/* ── The scroll story over the 3D bakery ── */
interface Story { n: string; title: ReactNode; body: string; at: [number, number] }

export function SceneHero({ facts, detectors, onReady }: { facts: { states: number; growth: string }; detectors: number; onReady: () => void }) {
  const track = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const chapters = useRef<(HTMLDivElement | null)[]>([]), ticks = useRef<(HTMLElement | null)[]>([]);
  const hero = useRef<HTMLDivElement>(null), intro = useRef<HTMLDivElement>(null), nudge = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  const STORY: Story[] = [
    { n: '01', title: <>One <em>₹500</em> payment.</>, body: 'A customer scans the QR at the counter. Transaction monitoring stops here: one payment, one rule, one yes or no.', at: [0, 0.13] },
    { n: '02', title: <>One <em>counter.</em></>, body: 'Hundreds of payments start to form a shape: ticket sizes, hours, refunds. A bakery sells ₹90 doughnuts and ₹1,150 cakes, not stacks of ₹500, ₹1,000 and ₹2,000.', at: [0.17, 0.3] },
    { n: '03', title: <>One <em>declared</em> business.</>, body: 'Sweet Crumbs Bakery · MCC 5462 · 7am to 10pm · in-store and local delivery. KYC checked who it is. Nobody checked whether it still behaves like this.', at: [0.4, 0.54] },
    { n: '04', title: <>Everyone who <em>pays</em> it.</>, body: `Regulars from the neighbourhood, in green. And in red, payers from ${facts.states} far-away states at midnight, as collections grow ${facts.growth}×. Same credentials, a different business.`, at: [0.62, 0.8] },
  ];

  useEffect(() => {
    let scene: BakeryScene | null = null, alive = true, raf = 0;
    const el = canvas.current!;
    import('./bakeryScene')
      .then(m => m.createBakeryScene(el, { local: 26, far: Math.max(8, Math.min(22, facts.states)) }))
      .then(s => { if (!alive) { s.dispose(); return; } scene = s; onReady(); update(); })
      .catch(() => { setFailed(true); onReady(); });

    const update = () => {
      raf = 0;
      const t = track.current; if (!t) return;
      const span = t.offsetHeight - window.innerHeight;
      const p = Math.min(1, Math.max(0, -t.getBoundingClientRect().top / Math.max(1, span)));
      scene?.setProgress(p);
      STORY.forEach((s, i) => {
        const c = chapters.current[i]; if (!c) return;
        const o = i === 0 ? Math.min(1, 1 - smoother((p - s.at[1]) / 0.035)) : band(p, s.at[0], s.at[1]);
        c.style.opacity = String(o); c.style.transform = `translateY(${(1 - o) * 24}px)`;
        const tk = ticks.current[i]; if (tk) tk.style.transform = `scaleY(${Math.min(1, Math.max(0, (p - s.at[0]) / (s.at[1] - s.at[0])))})`;
      });
      const h = smoother((p - 0.86) / 0.07);
      if (hero.current) { hero.current.style.opacity = String(h); hero.current.style.transform = `translateY(${(1 - h) * 30}px)`; hero.current.style.pointerEvents = h > 0.5 ? 'auto' : 'none'; }
      if (intro.current) intro.current.style.opacity = String(1 - smoother(p / 0.06));
      if (nudge.current) nudge.current.style.opacity = String(1 - smoother((p - 0.8) / 0.05));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    const onResize = () => { scene?.resize(); update(); };
    const onMove = (e: PointerEvent) => scene?.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) window.addEventListener('pointermove', onMove, { passive: true });
    update();
    return () => {
      alive = false; cancelAnimationFrame(raf); scene?.dispose();
      window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize); window.removeEventListener('pointermove', onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={track} className="mre-scene-track" id="top">
      <div className="mre-scene-stage grain">
        <canvas ref={canvas} aria-label="Animated night-time bakery: the camera pulls back from a single QR payment to the shop, the street and a map of everyone who pays it" role="img" />
        {failed && <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_40%,#3a1d0e,#0d0b09_70%)]" />}
        <div className="mre-vignette" />

        <div ref={intro} className="pointer-events-none absolute inset-x-0 top-20 flex flex-col items-center px-4 text-center md:top-24">
          <div className="mre-label text-butter">Merchant Reality Engine</div>
          <div className="mt-2 font-mono text-[11px] tracking-[.2em] text-mute">A STORY IN FOUR PULLS · SYNTHETIC DATA</div>
        </div>

        {STORY.map((s, i) => (
          <div key={s.n} ref={el => { chapters.current[i] = el; }} className="mre-chapter" style={i === 0 ? { opacity: 1, transform: 'none' } : undefined}>
            <div className="num">{s.n} / 04</div>
            <h2>{s.title}</h2>
            <p>{s.body}</p>
          </div>
        ))}

        <div className="mre-progress" aria-hidden="true">{STORY.map((s, i) => <i key={s.n}><b ref={el => { ticks.current[i] = el; }} /></i>)}</div>

        <div ref={hero} className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center" style={{ opacity: 0 }}>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_50%,rgba(13,11,9,.82),rgba(13,11,9,.35)_70%,transparent)]" />
          <div className="relative mre-label mb-6 text-butter">Merchant Reality Engine</div>
          <h1 className="relative mre-hero-title">See the business<br />behind <em>every</em> payment.</h1>
          <p className="relative mt-6 max-w-xl text-[15px] leading-relaxed text-[#d9cdbb] md:text-lg">Not whether one payment looks fraudulent, but whether the merchant behaves like the business it claims to be.</p>
          <div className="relative mt-9 flex flex-wrap justify-center gap-3">
            <Link to="/demo" className="mre-pill mre-pill-solid">TRY DEMO <ArrowUpRight size={16} strokeWidth={2.6} /></Link>
            <Link to="/ai-engine" className="mre-pill mre-pill-ghost">OPEN AI ENGINE</Link>
          </div>
          <div className="absolute bottom-8 left-4 hidden border-l border-line2 pl-3 text-left font-mono text-[11px] tracking-[.14em] text-mute md:left-8 md:block"><div className="text-ink">{detectors} LIVE DETECTORS</div><div>7 LAYERS · 1 GOVERNED DECISION</div></div>
          <div className="absolute bottom-8 right-4 hidden border-r border-line2 pr-3 text-right font-mono text-[11px] tracking-[.14em] text-mute md:right-8 md:block"><div className="text-ink">HUMANS APPROVE</div><div>EVERY RESTRICTION</div></div>
        </div>

        <div ref={nudge} className="pointer-events-none absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 font-mono text-[10.5px] tracking-[.22em] text-mute">
          <span>SCROLL TO STEP BACK</span><ArrowDown size={16} className="anim-nudge text-crust" />
        </div>
      </div>
    </div>
  );
}
