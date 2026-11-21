import { Link } from 'react-router-dom';
import { PublicNav, Footer } from '../components/navigation/PublicNav';
import { ArchitectureExplorer } from '../components/common/ArchitectureExplorer';
import { Btn } from '../components/ui/ui';
import { LAYERS } from '../data/evidence';

const IMPL: [string, string, string][] = [
  ['L1 Ingest & Lineage', 'Event normalisation, refund linkage, HMAC-SHA256 pseudonymisation, coverage map, PA CSV adapter', 'Kafka or streaming connectors, schema registry, HSM-managed keys'],
  ['L2 Merchant Profile', 'Log-normal weekly volume model with festival calendar offsets, ARL-calibrated CUSUM (h = 2.35), Bayesian online changepoint', 'Live portfolio peer cohort calibration across all active merchants'],
  ['L3 Detection', '25 live statistical detectors across 10 families (A–I, K), cohort continuity, plus 10 solution/betting patterns (S1–S7, N1–N3)', 'Remaining catalogue patterns, cross-PA consortium signals'],
  ['L4 Evidence Fusion', 'Bayesian log-odds fusion with within-family shrinkage (ρ = 0.3), Monte-Carlo 90% interval, 2-source / 3-family governance gate, 4 mechanisms', 'Isotonic/conformal recalibration on 1,000+ real shadow-pilot labels'],
  ['L5 Analyst Review', 'Competing explanations, reasoning trace waterfall, counterfactual minimal flip sets, Value of Information (₹), LightGBM + MLP second opinion', 'Enterprise case assignment, SLA queues, merchant document portal'],
  ['L6 Governed Response', 'Expected-loss decision theory (L0–L5), maker/checker role separation, surgical L3 link disablement', 'Direct payment-rail webhooks, escrow ledger integration'],
  ['L7 Audit & Learning', 'SHA-256 hash-chained SQLite audit, RBI/FIU-IND evidence pack, Bayesian label learning (T14), red-team + backtested rule evolution (T15–T16)', 'External daily signed audit digest anchoring, FINnet portal XML export'],
];
export function ArchitecturePage() {
  return (
    <div className="min-h-screen bg-bg"><PublicNav />
      <div className="mx-auto max-w-7xl px-5 py-16">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight">Architecture</h1>
        <p className="mt-3 max-w-2xl text-mute">Seven layers, each with a single job and an explicit handoff. Evidence moves forward; labels and outcomes move back.</p>
        <div className="mt-10"><ArchitectureExplorer /></div>
        <h2 className="mt-20 text-2xl font-semibold tracking-tight">Design principles</h2>
        <div className="mt-6 grid gap-3 md:grid-cols-3">{[['Missing is UNKNOWN', 'Absent data is neither clean nor suspicious. It is set aside and shown as a coverage gap.'], ['Independence over volume', 'A case needs at least two independent evidence families. Correlated signals count once.'], ['Humans decide, proportionately', 'Analysts compare competing explanations. Response starts at observation and escalates only as evidence and authority allow.']].map(([t, d]) => <div key={t} className="rounded-md border border-line bg-panel p-5"><div className="font-medium">{t}</div><p className="mt-1.5 text-sm text-mute">{d}</p></div>)}</div>
        <h2 className="mt-20 text-2xl font-semibold tracking-tight">Prototype scope</h2>
        <p className="mt-2 max-w-2xl text-sm text-mute">What the demo implements today, and what a production system would add. See docs/FUTURE_BACKEND.md in the source.</p>
        <div className="mt-6 overflow-x-auto rounded-md border border-line"><table className="w-full text-left text-sm"><thead className="bg-panel2 text-xs text-mute"><tr><th className="px-4 py-3 font-medium">Layer</th><th className="px-4 py-3 font-medium">In this prototype</th><th className="px-4 py-3 font-medium">For production</th></tr></thead>
          <tbody>{IMPL.map(([a, b, c], i) => <tr key={a} className="border-t border-line align-top"><td className="px-4 py-3 font-medium">{LAYERS[i].code} <span className="text-mute">{a.slice(3)}</span></td><td className="px-4 py-3 text-mute">{b}</td><td className="px-4 py-3 text-mute">{c}</td></tr>)}</tbody></table></div>
        <div className="mt-10"><Link to="/demo"><Btn variant="primary" size="lg">Try a guided investigation</Btn></Link></div>
      </div><Footer /></div>
  );
}
