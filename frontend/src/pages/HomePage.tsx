import { DETECTORS } from '../engines/detectors';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Activity, Boxes, Fingerprint, GitBranch, Layers, Network, Radar, Scale, SearchCheck, ShieldCheck, Waypoints } from 'lucide-react';
import { PublicNav, Footer } from '../components/navigation/PublicNav';
import { ArchitectureExplorer } from '../components/common/ArchitectureExplorer';
import { FlowchartExperience } from '../components/common/FlowchartExperience';
import { Chapter, Loader, Reveal, SceneHero } from '../components/home/Landing';
import { FAMILIES } from '../data/evidence';
import { getScenario } from '../data/scenarios';
import { RULES } from '../../../rules/index';

/** Every number in the bakery illustration is measured on the synthetic bakery it describes. */
function bakeryFacts() {
  const sc = getScenario('bakery'), p = sc.profile;
  const sales = sc.events.filter(e => e.merchantId === p.id && e.type === 'SALE');
  const edges = [250, 450, 500, 750, 1000, 1500, 2000, Infinity], bins = edges.map(() => 0);
  sales.forEach(s => { bins[edges.findIndex(x => s.amount <= x)]++; });
  const area = new Set([p.localStates[0], ...RULES.neighbours(p.localStates[0])]);
  const states = new Set(sales.map(s => s.payerState).filter(s => !area.has(s))).size;
  const peak = sc.weekly[sc.weekly.length - 1].actual!, base = sc.weekly.slice(0, 8).reduce((a, w) => a + w.actual!, 0) / 8;
  const ticker = sales.filter((_, i) => i % Math.max(1, Math.floor(sales.length / 36)) === 0).slice(0, 36).map(s => ({
    id: s.id, amount: s.amount, state: s.payerState, far: !area.has(s.payerState),
    time: new Date(s.eventTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }),
  }));
  return { bins, states, growth: (peak / base).toFixed(1), ticker };
}

function Bars({ data, color, hi }: { data: number[]; color: string; hi?: number[] }) {
  const m = Math.max(...data);
  return <div className="flex h-28 items-end gap-1.5">{data.map((v, i) => <div key={i} className="flex-1 rounded-t-md transition-all duration-700" style={{ height: `${(v / m) * 100}%`, background: hi?.includes(i) ? '#ff5d73' : color, opacity: 0.9 }} />)}</div>;
}

const Fact = ({ v, l, bad }: { v: ReactNode; l: string; bad?: boolean }) => (
  <div className={bad ? 'rounded-xl border border-[#ff5d73]/30 bg-[#ff5d73]/[.06] px-3 py-3' : 'rounded-xl border border-line bg-panel2 px-3 py-3'}>
    <div className="font-display text-2xl font-bold tracking-tight">{v}</div><div className="mt-0.5 font-mono text-[10px] uppercase tracking-[.14em] text-mute">{l}</div>
  </div>
);

function Problem({ facts }: { facts: ReturnType<typeof bakeryFacts> }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="mre-card p-6 md:p-8">
          <div className="flex items-center justify-between"><span className="mre-label text-ok">Declared</span><span className="font-mono text-[11px] text-dim">MCC 5462</span></div>
          <div className="mt-3 font-display text-2xl font-bold tracking-tight">Sweet Crumbs Bakery</div>
          <p className="mt-1 text-sm text-mute">Registered as MCC 5462. In-store and local deliveries.</p>
          <div className="mt-7 font-mono text-[11px] tracking-[.08em] text-mute">Expected ticket shape, illustrative (₹150–1,200)</div>
          <div className="mt-3"><Bars data={[3, 8, 14, 18, 15, 10, 6, 3]} color="#4fd1a1" /></div>
          <div className="mt-6 grid grid-cols-3 gap-3"><Fact v="1" l="state" /><Fact v="7–22" l="hours" /><Fact v="2×" l="Diwali peak" /></div>
        </div>
        <div className="mre-card p-6 md:p-8">
          <div className="flex items-center justify-between"><span className="mre-label text-bad">Observed</span><span className="font-mono text-[11px] text-dim">synthetic</span></div>
          <div className="mt-3 font-display text-2xl font-bold tracking-tight">Payment behaviour</div>
          <p className="mt-1 text-sm text-mute">The same credentials, a different business.</p>
          <div className="mt-7 font-mono text-[11px] tracking-[.08em] text-mute">Actual ticket sizes: heaped at ₹500, ₹1,000, ₹2,000</div>
          <div className="mt-3"><Bars data={facts.bins} color="#6b5a48" hi={[2, 4, 6]} /></div>
          <div className="mt-6 grid grid-cols-3 gap-3"><Fact bad v={facts.states} l="far-away states" /><Fact bad v="Pre-match" l="funding peaks" /><Fact bad v={`${facts.growth}×`} l="collections" /></div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[['Disguised betting collections', 'Deposits from a betting app are routed through a retail merchant’s payment link.'], ['Transaction laundering', 'One merchant’s credentials process another business’s payments.'], ['Merchant identity misuse', 'A genuine registration is used for activity its owner never declared.'], ['Fabricated commercial activity', 'Sales that no order, shipment or purchaser can substantiate.'], ['Rotating collection accounts', 'When one account is flagged, a similar one takes over.']].map(([t, d], i) => (
          <div key={t} className="mre-card p-5"><div className="font-mono text-[11px] text-crust">{String.fromCharCode(65 + i)}</div><div className="mt-3 font-display text-[17px] font-semibold leading-snug tracking-tight">{t}</div><p className="mt-2 text-[13px] leading-relaxed text-mute">{d}</p></div>))}
      </div>
    </div>
  );
}

function Ticker({ items }: { items: ReturnType<typeof bakeryFacts>['ticker'] }) {
  const row = (sfx: string) => items.map(t => (
    <span key={t.id + sfx} className="mx-2 inline-flex shrink-0 items-center gap-3 rounded-full border border-line bg-panel px-4 py-2 font-mono text-[12px]">
      <span className={t.far ? 'h-1.5 w-1.5 rounded-full bg-bad' : 'h-1.5 w-1.5 rounded-full bg-ok'} />
      <span className="font-semibold text-ink">₹{t.amount.toLocaleString('en-IN')}</span><span className="text-dim">{t.time}</span><span className={t.far ? 'text-[#ff9aa9]' : 'text-mute'}>{t.state}</span>
    </span>
  ));
  return (
    <div className="relative overflow-hidden border-y border-line bg-[#100d0b] py-4" aria-label="A sample of the synthetic bakery's payments: red dots are payers from far-away states">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-[#100d0b] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-[#100d0b] to-transparent" />
      <div className="mre-marquee">{row('a')}<span aria-hidden="true" className="contents">{row('b')}</span></div>
    </div>
  );
}

const TECH = [
  [Fingerprint, 'Merchant behavioural profiling', 'Declared profile turned into numeric expectations: ticket band, hours, geography, seasonality.'],
  [Activity, 'Residual and change-point detection', 'R = (V − E) / max(E, ε) against anchored, seasonal and rolling baselines.'],
  [Radar, 'CUSUM drift tracking', 'Accumulates only sustained excess, so a single busy week does not raise an alarm.'],
  [Boxes, `${DETECTORS.length} live tests, stream by stream`, 'Each QR, payment link, or payment rail (UPI, card, netbanking, wallet, POS) with 30+ payments is also scored on its own, so a side business stands out from the shop’s average.'],
  [Network, 'Heterogeneous relationship graphs', 'A map of merchants, links, sites and beneficiaries for the analyst. It is not an input to the score.'],
  [GitBranch, 'Cohort continuity', 'Detects behaviour that carries on from a dormant account into a new one.'],
  [Layers, 'Evidence fusion', 'Collapses correlated signals, sets UNKNOWN aside and requires independent evidence.'],
  [SearchCheck, 'Explainable investigation', 'Every signal states what was seen, what was expected and why it matters.'],
  [Scale, 'Governed response', 'Six proportionate levels with a separate legal-authority check.'],
] as const;

function Usecase({ n, title, text, children }: { n: string; title: string; text: string; children: ReactNode }) {
  return (
    <div className="mre-card flex flex-col overflow-hidden">
      <div className="border-b border-line bg-[#0f0c0a] p-5">{children}</div>
      <div className="flex flex-1 flex-col p-6"><div className="font-mono text-[11px] text-crust">{n}</div><div className="mt-2 font-display text-xl font-bold tracking-tight">{title}</div><p className="mt-2 flex-1 text-sm leading-relaxed text-mute">{text}</p>
        <Link to="/demo" className="mre-explore mt-5">EXPLORE IN DEMO <ArrowUpRight size={13} /></Link></div>
    </div>
  );
}
const svgp = { viewBox: '0 0 300 110', className: 'h-28 w-full' };

const APPROACH = [['Financial behaviour', 'Volume, ticket shape, refunds and settlement against the profile.'], ['Customer composition', 'Who pays, from where, and whether they come back.'], ['Commercial authenticity', 'Orders, fulfilment and independent purchaser confirmation.'], ['Digital provenance', 'Where payment links and checkouts actually live on the web.'], ['Network relationships', 'Shared infrastructure, cohorts and beneficiaries across merchants.'], ['Operational consistency', 'Hours, timing, seasonality and lifecycle against the declared business.']];
const WHY = [['Flags individual anomalies', 'Finds joint patterns: round amount, far-away payer and match-time funding in the same payments'], ['Adds up scores, so correlated signals inflate risk', 'Collapses correlated signals; a change alone gets a question, and a case needs conduct evidence'], ['Checks identity and documents', 'Checks commercial reality where those feeds exist: orders, fulfilment, provenance and settlement'], ['Automatic holds from a score', 'A person approves every restriction, with competing explanations in view'], ['Scores the merchant on average', 'Also scores each QR with 30+ payments, so a side business there stands out'], ['Penalises a business that changed', 'Asks, then updates on a verified Context Passport'], ['Restricts the whole merchant', 'Narrowest effective action, such as one payment link']];

export function HomePage() {
  const loc = useLocation();
  const facts = useMemo(bakeryFacts, []);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = loc.hash.slice(1) || (loc.state as { scroll?: string } | null)?.scroll;
    if (id && ready) setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 1150);
  }, [loc, ready]);

  return (
    <div className="min-h-screen bg-bg text-ink">
      <Loader ready={ready} />
      <PublicNav landing />
      <SceneHero facts={facts} detectors={DETECTORS.length} onReady={() => setReady(true)} />

      <Ticker items={facts.ticker} />

      <section className="relative mx-auto max-w-[1440px] px-4 py-28 md:px-8 md:py-40">
        <div className="mre-label text-crust">From transaction monitoring to merchant reality</div>
        <Reveal as="h2" className="mt-6 max-w-6xl font-display text-[clamp(2rem,5.4vw,5.2rem)] font-extrabold leading-[1] tracking-[-.04em]" text="MRE does not ask whether one payment looks fraudulent. It asks whether the merchant behaves like the business it claims to be." />
      </section>

      <Chapter id="platform" n="01" kicker="The problem" title={<>A merchant can pass KYC and still be <span className="font-serif font-normal italic text-butter">someone else’s</span> front.</>} lead="Onboarding checks who a merchant is. They do not check whether the payments flowing through it look like the business it declared. Transaction monitoring sees single payments; the contradiction lives in the whole picture.">
        <Problem facts={facts} />
      </Chapter>

      <Chapter id="approach" n="02" kicker="The approach" title="From transaction monitoring to merchant reality." lead="MRE does not ask whether one payment looks fraudulent. It asks whether the merchant behaves like the business it claims to be.">
        <div className="grid gap-px overflow-hidden rounded-[18px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">{APPROACH.map(([t, d], i) => (
          <div key={t} className="group bg-panel p-7 transition-colors hover:bg-[#1a1511]"><div className="flex items-center justify-between"><span className="font-mono text-xs text-crust">0{i + 1}</span><ArrowUpRight size={16} className="text-dim transition group-hover:text-crust" /></div><div className="mt-8 font-display text-xl font-bold tracking-tight">{t}</div><p className="mt-2 text-sm leading-relaxed text-mute">{d}</p></div>))}</div>
      </Chapter>

      <Chapter id="how" n="03" kicker="How it works" title="Seven layers, from raw events to governed action." lead="Select a layer to see its inputs, processes, outputs and how it hands off to the next.">
        <div className="mre-card p-3 md:p-5"><ArchitectureExplorer /></div>
        <div id="workflow" className="mt-16 scroll-mt-20">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div><div className="mre-label text-crust">Interactive flowchart</div><h3 className="mt-3 font-display text-[clamp(1.5rem,3vw,2.5rem)] font-extrabold tracking-tight">Click a layer below to open its detailed flowchart</h3></div>
            <Link to="/demo" className="mre-pill mre-pill-solid">WATCH A SEVEN-LAYER DEMO <ArrowRight size={15} /></Link>
          </div>
          <FlowchartExperience mode="workflow" />
        </div>
      </Chapter>

      <Chapter id="technology" n="04" kicker="Technology" title={<>Transparent methods, <span className="font-serif font-normal italic text-butter">not</span> a black-box score.</>}>
        <div className="grid gap-px overflow-hidden rounded-[18px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">{TECH.map(([I, t, d]) => (
          <div key={t} className="bg-panel p-7"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#2a1a10]"><I size={19} className="text-crust" /></div><div className="mt-6 font-display text-[17px] font-bold tracking-tight">{t}</div><p className="mt-2 text-[13.5px] leading-relaxed text-mute">{d}</p></div>))}</div>
        <div className="mt-8 flex flex-wrap gap-2">{FAMILIES.map(f => <span key={f.id} className="rounded-full border border-line bg-panel px-3.5 py-1.5 text-xs text-mute"><span className="mr-2 font-mono text-crust">{f.id}</span>{f.name}</span>)}</div>
        <p className="mt-4 font-mono text-[11px] tracking-[.04em] text-dim">The engine runs {DETECTORS.length} live statistical detectors. All demo data is synthetic, and no real-world accuracy has been measured.</p>
      </Chapter>

      <Chapter id="use-cases" n="05" kicker="Use cases" title="Three investigations MRE is built for.">
        <div className="grid gap-4 lg:grid-cols-3">
          <Usecase n="05/A" title="Merchant account rotation" text="A collection account goes quiet and a new one starts with the same payers, ticket shape and settlement destination. Cohort continuity links them as a lead for review.">
            <svg {...svgp}><rect x="14" y="32" width="96" height="46" rx="5" fill="#120e0b" stroke="#5a4a3b" strokeDasharray="4 3" /><text x="62" y="60" textAnchor="middle" fontSize="11" fill="#a89a88">Account A · dormant</text><rect x="190" y="32" width="96" height="46" rx="5" fill="#120e0b" stroke="#ff8a4c" /><text x="238" y="60" textAnchor="middle" fontSize="11" fill="#f6efe4">Account B · new</text><path d="M112 55 L188 55" stroke="#f4c95d" strokeDasharray="5 4" className="anim-dash" /><text x="150" y="46" textAnchor="middle" fontSize="9.5" fill="#f4c95d">same payers</text><text x="150" y="96" textAnchor="middle" fontSize="9.5" fill="#a89a88">gap: 2 days</text></svg></Usecase>
          <Usecase n="05/B" title="Transaction laundering" text="A bakery’s payment link appears on a betting deposit page. Payments look retail on paper, but timing, geography, ticket sizes and refunds all point elsewhere.">
            <svg {...svgp}><rect x="10" y="34" width="84" height="42" rx="5" fill="#120e0b" stroke="#4fd1a1" /><text x="52" y="59" textAnchor="middle" fontSize="11" fill="#f6efe4">Bakery</text><rect x="110" y="34" width="84" height="42" rx="5" fill="#120e0b" stroke="#ff8a4c" /><text x="152" y="59" textAnchor="middle" fontSize="10.5" fill="#f6efe4">Payment link</text><rect x="212" y="34" width="80" height="42" rx="5" fill="#120e0b" stroke="#ff5d73" /><text x="252" y="59" textAnchor="middle" fontSize="10.5" fill="#f6efe4">Betting page</text><path d="M96 55 H108 M196 55 H210" stroke="#ff8a4c" className="anim-dash" /><text x="152" y="96" textAnchor="middle" fontSize="9.5" fill="#a89a88">undeclared offering behind retail credentials</text></svg></Usecase>
          <Usecase n="05/C" title="Fabricated commercial substance" text="A store looks real, but most payments have no order, shipments reuse tracking IDs and sampled purchasers do not recognise their payments.">
            <svg {...svgp}>{[['Payments', 100, '#ff8a4c'], ['Orders', 41, '#f4c95d'], ['Delivered', 22, '#ff5d73'], ['Confirmed', 25, '#ff5d73']].map(([l, v, c], i) => <g key={l as string}><text x="12" y={24 + i * 22} fontSize="10" fill="#a89a88">{l as string}</text><rect x="80" y={15 + i * 22} width={(v as number) * 2.1} height="11" rx="2" fill={c as string} opacity=".8" /><text x={86 + (v as number) * 2.1} y={24 + i * 22} fontSize="10" fill="#e0d4c2">{v as number}%</text></g>)}</svg></Usecase>
        </div>
      </Chapter>

      <Chapter id="why" n="06" kicker="Why it is different" title="Why it is different from conventional monitoring.">
        <div className="overflow-hidden rounded-[18px] border border-line">
          <div className="grid grid-cols-2 bg-panel2 font-mono text-[11px] uppercase tracking-[.14em]"><div className="px-5 py-4 text-mute">Conventional monitoring</div><div className="border-l border-line px-5 py-4 text-crust">Merchant Reality Engine</div></div>
          {WHY.map(([a, b]) => <div key={a} className="grid grid-cols-2 border-t border-line text-[14px] transition-colors hover:bg-[#15110e]"><div className="px-5 py-4 text-dim line-through decoration-[#5a4a3b]">{a}</div><div className="border-l border-line px-5 py-4 text-ink">{b}</div></div>)}
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-5 rounded-[18px] border border-[#4fd1a1]/25 bg-[#4fd1a1]/[.05] p-6 md:p-8"><ShieldCheck className="shrink-0 text-ok" size={28} /><p className="max-w-2xl flex-1 text-[15px] leading-relaxed text-[#d9cdbb]">Two demo merchants are honest. A Diwali surge gets no case and no question. A bakery that started midnight delivery gets a question, and a verified Context Passport clears it.</p><Link to="/demo" className="mre-pill mre-pill-solid">TRY ALL SIX SCENARIOS <Waypoints size={15} /></Link></div>
      </Chapter>

      <section id="case-studies" className="scroll-mt-16 pb-24 pt-8 md:pb-32">
        <div className="mx-auto max-w-[1440px] px-4 md:px-8">
          <div className="flex items-baseline gap-3 font-mono text-[12px] tracking-[.2em]"><span className="text-crust">07/</span><span className="uppercase text-mute">Case studies</span></div>
          <div className="mre-rule mt-4 w-full max-w-xs" />
          <div className="mt-6"><FlowchartExperience mode="studies" /></div>
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-line bg-[radial-gradient(90%_120%_at_50%_120%,#ff6a2b33,transparent_60%)]">
        <div className="mx-auto flex max-w-[1440px] flex-col items-center px-4 py-28 text-center md:px-8 md:py-36">
          <div className="mre-label text-butter">Open the engine</div>
          <h2 className="mt-6 max-w-4xl font-display text-[clamp(2.2rem,6vw,5.5rem)] font-extrabold leading-[.95] tracking-[-.045em]">Does your merchant behave like the business it <span className="font-serif font-normal italic text-butter">claims</span> to be?</h2>
          <div className="mt-10 flex flex-wrap justify-center gap-3"><Link to="/demo" className="mre-pill mre-pill-solid">TRY DEMO <ArrowUpRight size={16} /></Link><Link to="/ai-engine" className="mre-pill mre-pill-ghost">ANALYZE YOUR DATA</Link><Link to="/architecture" className="mre-pill mre-pill-ghost">ARCHITECTURE</Link></div>
        </div>
      </section>
      <Footer />
    </div>
  );
}
