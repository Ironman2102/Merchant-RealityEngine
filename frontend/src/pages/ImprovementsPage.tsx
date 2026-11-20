/** Held-out comparison of the neural network with the previous second opinion. */
import { useEffect, useState } from 'react';

type Row = { name: string; version: string; kind: string; averagePrecision: number; ece: number; recall: string; genuineFp: string };
type Report = { synthetic: boolean; heldOut: number; models: Row[]; rsi: { definition: string; versusLightGBM: number | null; versusBayesian: number | null } };

const pct = (v: number | null) => v === null ? 'not defined' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

export function ImprovementsPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}improvements.json`).then(r => r.json()).then(setReport).catch(() => setError('The improvement report is not on this site.'));
  }, []);
  if (error) return <p className="text-sm" role="alert">{error}</p>;
  if (!report) return <p className="text-sm text-mute">Loading the comparison…</p>;
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Improvements</h1>
        <p className="mt-3 text-sm leading-relaxed">The case decision is still the Bayesian engine. This page compares a neural-network second opinion with the previous tree model, on {report.heldOut} held-out synthetic merchants.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-panel p-4">
          <div className="text-xs text-mute">RSI versus the tree model</div>
          <div className="mt-2 font-mono text-2xl">{pct(report.rsi.versusLightGBM)}</div>
          <p className="mt-2 text-sm text-mute">Average precision was already 1.000 for both, so the network does not rank these synthetic fronts any higher than LightGBM.</p>
        </div>
        <div className="rounded-lg border border-line bg-panel p-4">
          <div className="text-xs text-mute">RSI versus the Bayesian engine</div>
          <div className="mt-2 font-mono text-2xl">{pct(report.rsi.versusBayesian)}</div>
          <p className="mt-2 text-sm text-mute">The network ranks the held-out fronts higher than the probability that decides the case. It still does not decide.</p>
        </div>
      </div>
      <p className="text-sm text-mute">{report.rsi.definition}</p>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-mute"><tr><th className="px-4 py-2">Model</th><th className="px-4 py-2">Average precision</th><th className="px-4 py-2">Recall at 0.10</th><th className="px-4 py-2">Genuine false alarms</th></tr></thead>
          <tbody>
            {report.models.map(m => <tr key={m.version} className="border-t border-line"><td className="px-4 py-3"><div className="font-medium">{m.name}</div><div className="text-xs text-dim">{m.kind}</div></td><td className="px-4 py-3 font-mono">{m.averagePrecision.toFixed(3)}</td><td className="px-4 py-3 font-mono">{m.recall}</td><td className="px-4 py-3 font-mono">{m.genuineFp}</td></tr>)}
          </tbody>
        </table>
      </div>
      {report.synthetic && <p className="text-xs text-dim">Synthetic data only. An average precision of 1.000 here is an easy-clone result, not a real-world accuracy claim.</p>}
    </div>
  );
}
