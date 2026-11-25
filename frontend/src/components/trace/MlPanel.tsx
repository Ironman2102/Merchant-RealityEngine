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
  classical?: { p: number; modelVersion: string }[];
  ensemble?: {
    p: number; models: string[]; disagreement: number; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; review: boolean;
    method?: 'stacked'; pTrainScale?: number; weights?: Record<string, number>;
    priorShift?: { applied: boolean; enginePrior: number | null; trainPrevalence: number };
    threshold?: number; flag?: boolean; costRatio?: number; conformalSet?: ('front' | 'honest')[]; conformalAlpha?: number;
    novelty?: { distance: number; threshold: number; flagged: boolean; pValue?: number; unfamiliar: string[] };
    conformalPValues?: { front: number; honest: number }; calibration?: string;
    uncertainty?: { totalBits: number; aleatoricBits: number; epistemicBits: number };
    neymanPearson?: { threshold: number; flag: boolean; alpha: number; delta: number } | null;
  };
  encoder?: { label: string | null; score: number | null; modelVersion: string };
  assessment?: { statisticalP: number; combinedP: number; classification: 'HIGH_RISK' | 'LOW_RISK' | 'REVIEW'; review: boolean };
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
    <Panel title="Stage 2 AI/ML assessment" subtitle="Predictive models and optional text understanding add a confidence-gated assessment. The statistical independence gate still governs case opening.">
      {ml === undefined && <p className="text-sm text-mute">Asking the model…</p>}
      {ml === null && <div className="space-y-2"><p className="text-sm">AI model offline. The decision does not depend on it.</p><ModelSandbox onReady={() => setReload(n => n + 1)} /></div>}
      {ml && (
        <div className="space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded border border-line bg-panel2 p-3">
              <div className="text-xs text-mute">{ml.ensemble?.method === 'stacked' ? `Stacked ensemble (${ml.modelVersion}) · drivers from LightGBM SHAP` : `LightGBM tree model (${ml.modelVersion})`}</div>
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
          {ml.ensemble && (
            <div className="rounded border border-line bg-panel2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-ink">Stage 2 Multi-Model Ensemble: <span className="font-mono text-sm">{fmtProb(ml.ensemble.p)}</span></div>
                <div className="flex items-center gap-1.5">
                  <Badge tone={ml.ensemble.confidence === 'HIGH' ? 'ok' : ml.ensemble.confidence === 'MEDIUM' ? 'info' : 'bad'}>
                    {ml.ensemble.confidence} confidence
                  </Badge>
                  <Badge tone="mute">Spread {ml.ensemble.disagreement.toFixed(3)}</Badge>
                </div>
              </div>
              {ml.assessment && (
                <div className="mt-1.5 text-xs text-mute">
                  Combined assessment: <b className="text-ink">{ml.assessment.classification.replace('_', ' ')}</b> · {fmtProb(ml.assessment.combinedP)} (Stage 1 {fmtProb(ml.assessment.statisticalP)}){ml.assessment.review ? ' · Human review recommended' : ''}
                </div>
              )}
              {ml.ensemble.method === 'stacked' && (
                <ul className="mt-2 space-y-0.5 text-xs text-mute">
                  {ml.ensemble.novelty?.flagged && (
                    <li className="text-rose-700"><b>Unfamiliar pattern:</b> this merchant is unlike anything in training (distance {ml.ensemble.novelty.distance.toFixed(1)} vs {ml.ensemble.novelty.threshold.toFixed(1)}). The scores below are not reliable for it{ml.ensemble.novelty.unfamiliar.length ? `; unusual: ${ml.ensemble.novelty.unfamiliar.map(words).join(', ')}` : ''}.</li>
                  )}
                  {ml.ensemble.conformalSet && (
                    <li>{Math.round((1 - (ml.ensemble.conformalAlpha ?? 0.1)) * 100)}% conformal prediction set: <b className="text-ink">{ml.ensemble.conformalSet.length === 1 ? ml.ensemble.conformalSet[0] : ml.ensemble.conformalSet.length === 0 ? 'none (atypical)' : 'front or honest (uncertain)'}</b></li>
                  )}
                  {ml.ensemble.conformalPValues && (
                    <li>Conformal p-values: front <span className="font-mono text-ink">{ml.ensemble.conformalPValues.front.toFixed(3)}</span>, honest <span className="font-mono text-ink">{ml.ensemble.conformalPValues.honest.toFixed(3)}</span>{ml.ensemble.novelty?.pValue != null ? <> · novelty p <span className="font-mono text-ink">{ml.ensemble.novelty.pValue.toFixed(3)}</span></> : null}</li>
                  )}
                  {ml.ensemble.uncertainty && (
                    <li>Uncertainty: {ml.ensemble.uncertainty.totalBits.toFixed(3)} bits = noise {ml.ensemble.uncertainty.aleatoricBits.toFixed(3)} + model disagreement {ml.ensemble.uncertainty.epistemicBits.toFixed(3)}</li>
                  )}
                  {ml.ensemble.neymanPearson && (
                    <li>False-alarm-controlled bar (at most {Math.round(ml.ensemble.neymanPearson.alpha * 100)}% of honest merchants, {Math.round((1 - ml.ensemble.neymanPearson.delta) * 100)}% confidence): <b className="text-ink">{ml.ensemble.neymanPearson.flag ? 'above' : 'below'}</b></li>
                  )}
                  {ml.ensemble.priorShift?.applied && (
                    <li>Moved from the training base rate ({fmtProb(ml.ensemble.priorShift.trainPrevalence)}) onto the engine prior ({fmtProb(ml.ensemble.priorShift.enginePrior ?? 0)}): {fmtProb(ml.ensemble.pTrainScale ?? ml.ensemble.p)} → {fmtProb(ml.ensemble.p)}</li>
                  )}
                  {ml.ensemble.threshold != null && (
                    <li>Review bar {fmtProb(ml.ensemble.threshold)} (a missed front counted as {ml.ensemble.costRatio}× a needless review): <b className="text-ink">{ml.ensemble.flag ? 'above, suggest review' : 'below'}</b></li>
                  )}
                </ul>
              )}
              {ml.classical?.length ? (
                <div className="mt-2.5 grid gap-2 sm:grid-cols-4">
                  {ml.classical.map(x => (
                    <div key={x.modelVersion} className="rounded border border-line bg-panel px-2.5 py-1.5 text-xs">
                      <div className="text-[11px] text-mute truncate">{x.modelVersion}</div>
                      <div className="font-mono font-semibold text-ink">{fmtProb(x.p)}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
          {ml.encoder && <p className="text-xs text-mute">Context encoder ({ml.encoder.modelVersion}): <b className="text-ink">{ml.encoder.label}</b> ({ml.encoder.score == null ? 'no score' : fmtProb(ml.encoder.score)}). Supporting context only.</p>}
        </div>
      )}
    </Panel>
  );
}
