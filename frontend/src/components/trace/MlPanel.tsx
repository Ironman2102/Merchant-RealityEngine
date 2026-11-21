/** Second opinion from the trained model. The Bayesian decision on this page does not use it. */
import { useEffect, useState } from 'react';
import { Badge, Panel } from '../ui/ui';
import { getPilotJson } from '../../services/pilotApi';
import { fmtProb } from '../../utils/format';
import { ModelSandbox } from './ModelSandbox';
import { RULES } from '../../../../rules/index';

interface Driver { feature: string; shap: number }
interface Opinion {
  p: number;
  modelVersion: string;
  synthetic?: boolean;
  drivers: Driver[];
  nn?: { p: number; modelVersion: string; drivers: Driver[] };
}

function words(feature: string): string {
  const m = /^(llr|fired|eff|unk)_([A-Z]\d+)$/.exec(feature);
  if (m) {
    const [, kind, id] = m;
    let detName = id;
    try { detName = `${id} (${RULES.detector(id).name})`; } catch { /* fallback */ }
    if (kind === 'llr') return `${detName} weight`;
    if (kind === 'fired') return `${detName} fired`;
    if (kind === 'eff') return `${detName} effect size`;
    return `${detName} missing indicator`;
  }
  return feature.replaceAll('_', ' ');
}

export function MlPanel({ caseId, posterior }: { caseId: string | null; posterior: number }) {
  const [ml, setMl] = useState<Opinion | null | undefined>(undefined);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!caseId) { setMl(null); return; }
    let live = true;
    getPilotJson(caseId, 'trace').then(body => { if (live) setMl((body.ml as Opinion | null) ?? null); }).catch(() => { if (live) setMl(null); });
    return () => { live = false; };
  }, [caseId, reload]);
  const both = ml && ((ml.p >= 0.1 && posterior >= 0.1) || (ml.p < 0.1 && posterior < 0.1));
  return (
    <Panel title="AI model (second opinion)" subtitle="Trained models on the 112 detector features (LightGBM M1 + Neural Network challenger). They never override the Bayesian decision.">
      {ml === undefined && <p className="text-sm text-mute">Asking the model…</p>}
      {ml === null && <div className="space-y-2"><p className="text-sm">AI model offline. The decision does not depend on it.</p><ModelSandbox onReady={() => setReload(n => n + 1)} /></div>}
      {ml && (
        <div className="space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded border border-line bg-panel2 p-3">
              <div className="text-xs text-mute">LightGBM tree model ({ml.modelVersion})</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="font-mono text-xl">{fmtProb(ml.p)}</span>
                <Badge tone="info">Trained on synthetic data</Badge>
              </div>
              <ul className="mt-2 space-y-0.5 text-[12px] text-mute">
                {ml.drivers.slice(0, 5).map(d => <li key={d.feature}>{words(d.feature)}: <span className="font-mono text-ink">{d.shap >= 0 ? '+' : ''}{d.shap.toFixed(2)}</span></li>)}
              </ul>
            </div>
            {ml.nn && (
              <div className="rounded border border-line bg-panel2 p-3">
                <div className="text-xs text-mute">Neural network challenger ({ml.nn.modelVersion})</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xl">{fmtProb(ml.nn.p)}</span>
                  <Badge tone="info">MLP 32×16 calibrated</Badge>
                </div>
                <ul className="mt-2 space-y-0.5 text-[12px] text-mute">
                  {ml.nn.drivers.slice(0, 5).map(d => <li key={d.feature}>{words(d.feature)}: <span className="font-mono text-ink">{d.shap >= 0 ? '+' : ''}{d.shap.toFixed(2)}</span></li>)}
                </ul>
              </div>
            )}
          </div>
          <p className="text-xs text-mute">{both ? 'Both the Bayesian engine and the trained model agree on the 10% opening bar.' : 'They disagree on the 10% bar: review both the statistical waterfall and the SHAP drivers.'}</p>
        </div>
      )}
    </Panel>
  );
}
