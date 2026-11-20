/** Second opinion from the trained model. The Bayesian decision on this page does not use it. */
import { useEffect, useState } from 'react';
import { Badge, Panel } from '../ui/ui';
import { getPilotJson } from '../../services/pilotApi';
import { fmtProb } from '../../utils/format';

interface Opinion { p: number; modelVersion: string; synthetic?: boolean; drivers: { feature: string; shap: number }[] }

const words = (feature: string) => feature.replace(/^llr_/, 'Weight for ').replace(/^fired_/, 'Fired ').replace(/^eff_/, 'Effect ').replace(/^unk_/, 'Missing ').replaceAll('_', ' ');

export function MlPanel({ caseId, posterior }: { caseId: string | null; posterior: number }) {
  const [ml, setMl] = useState<Opinion | null | undefined>(undefined);
  useEffect(() => {
    if (!caseId) { setMl(null); return; }
    let live = true;
    getPilotJson(caseId, 'trace').then(body => { if (live) setMl((body.ml as Opinion | null) ?? null); }).catch(() => { if (live) setMl(null); });
    return () => { live = false; };
  }, [caseId]);
  const both = ml && ((ml.p >= 0.1 && posterior >= 0.1) || (ml.p < 0.1 && posterior < 0.1));
  return (
    <Panel title="AI model (second opinion)" subtitle="A trained model on the detector scores. It does not choose the action.">
      {ml === undefined && <p className="text-sm text-mute">Asking the model…</p>}
      {ml === null && <p className="text-sm">AI model offline. The decision does not depend on it.</p>}
      {ml && (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xl">{fmtProb(ml.p)}</span>
            <Badge tone="info">Trained on synthetic data</Badge>
            <span className="text-dim">{ml.modelVersion}</span>
          </div>
          <p>{both ? 'Both above the 10% bar, or both below it.' : 'They disagree: review both.'}</p>
          <ul className="text-[12px] text-mute">{ml.drivers.slice(0, 5).map(d => <li key={d.feature}>{words(d.feature)} {d.shap >= 0 ? '+' : ''}{d.shap.toFixed(2)}</li>)}</ul>
        </div>
      )}
    </Panel>
  );
}
