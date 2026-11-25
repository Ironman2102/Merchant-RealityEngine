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
  encoder?: {
    label: string | null;
    score: number | null;
    modelVersion: string;
    verdict?: 'CONSISTENT' | 'SUSPICIOUS' | 'INSUFFICIENT';
    riskScore?: number;
    abstained?: boolean;
    scores?: Record<string, number>;
    latencyMs?: number;
    truncated?: boolean;
  };
  biEncoder?: {
    modelVersion: string;
    backend: 'neural' | 'lexical-fallback';
    meanSimilarity: number;
    minSimilarity: number;
    mismatchShare: number;
    riskScore: number;
    itemCount: number;
    mismatches: { text: string; kind: string; similarity: number }[];
  };
  autoencoder?: {
    modelVersion: string;
    anomalyScore: number;
    reconstructionError: number;
    thresholdP95: number;
    isAnomaly: boolean;
    latentNorm: number;
    topResiduals: { feature: string; residual: number }[];
  };
  temporal?: {
    modelVersion: string;
    riskScore: number;
    embeddingNorm: number;
    eventCount: number;
    signals?: Record<string, number>;
  };
  graph?: {
    modelVersion: string;
    riskScore: number;
    embeddingNorm: number;
    nodeCount: number;
    edgeCount: number;
    motifs: {
      sharedInfraEdges: number;
      websiteLinkEdges: number;
      behavioralSimEdges: number;
      peerCount: number;
      beneficiaryCount: number;
    };
  };
  assessment?: { statisticalP: number; combinedP: number; classification: 'HIGH_RISK' | 'LOW_RISK' | 'REVIEW'; review: boolean };
  explanation?: { method: string; baseLogit: number; stackedLogit: number; residual: number };
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
  // m1-v0 is LightGBM and stage2-v1 the stacked ensemble. Without either, the service answers with the neural network
  // and classical models, and its headline probability is their average, so it must not be shown under either name.
  const stacked = ml?.ensemble?.method === 'stacked';
  const gbm = ml?.modelVersion === 'm1-v0' || stacked;
  // In the stacked ensemble the neural network is one member on the training scale, so it sits with the other members
  // rather than in its own card beside the base-rate-shifted stacked score.
  const members = [...(ml?.classical ?? []), ...(stacked && ml?.nn ? [{ p: ml.nn.p, modelVersion: ml.nn.modelVersion }] : [])];
  const hasEncoders = Boolean(ml?.encoder || ml?.biEncoder || ml?.autoencoder || ml?.temporal || ml?.graph);
  return (
    <Panel title="Stage 2 AI/ML assessment" subtitle="Predictive models and multi-modal encoders add a confidence-gated assessment. The statistical independence gate still governs case opening.">
      {ml === undefined && <p className="text-sm text-mute">Asking the model…</p>}
      {ml === null && <div className="space-y-2"><p className="text-sm">AI model offline. The decision does not depend on it.</p><ModelSandbox onReady={() => setReload(n => n + 1)} /></div>}
      {ml && (
        <div className="space-y-3 text-sm">
          {!gbm && <p className="text-xs text-mute">Neither the stacked ensemble nor LightGBM (m1-v0) is loaded on this host, so the neural network and classical models answer instead.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {gbm && (
              <div className="rounded border border-line bg-panel2 p-3">
                <div className="text-xs text-mute">{stacked ? `Stacked ensemble (${ml.modelVersion}) · ${ml.explanation ? 'drivers from the stacked ensemble (log-odds SHAP)' : 'drivers from LightGBM SHAP'}` : `LightGBM tree model (${ml.modelVersion})`}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xl">{fmtProb(ml.p)}</span>
                  <Badge tone="info">Trained on synthetic data</Badge>
                </div>
                <ul className="mt-2 space-y-0.5 text-[12px] text-mute">
                  {ml.drivers.slice(0, 5).map(d => <li key={d.feature}>{words(d.feature)}: <span className="font-mono text-ink">{d.shap >= 0 ? '+' : ''}{d.shap.toFixed(2)}</span></li>)}
                </ul>
              </div>
            )}
            {ml.nn && !stacked && (
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
                    <li>False-alarm-controlled bar on the training-scale score {fmtProb(ml.ensemble.pTrainScale ?? ml.ensemble.p)} (at most {Math.round(ml.ensemble.neymanPearson.alpha * 100)}% of honest training merchants, {Math.round((1 - ml.ensemble.neymanPearson.delta) * 100)}% confidence): <b className="text-ink">{ml.ensemble.neymanPearson.flag ? 'above' : 'below'}</b>. The review bar below, on the engine's base rate, is the one that suggests a review.</li>
                  )}
                  {ml.ensemble.priorShift?.applied && (
                    <li>Moved from the training base rate ({fmtProb(ml.ensemble.priorShift.trainPrevalence)}) onto the engine prior ({fmtProb(ml.ensemble.priorShift.enginePrior ?? 0)}): {fmtProb(ml.ensemble.pTrainScale ?? ml.ensemble.p)} → {fmtProb(ml.ensemble.p)}</li>
                  )}
                  {ml.ensemble.threshold != null && (
                    <li>Review bar {fmtProb(ml.ensemble.threshold)} (a missed front counted as {ml.ensemble.costRatio}× a needless review): <b className="text-ink">{ml.ensemble.flag ? 'above, suggest review' : 'below'}</b></li>
                  )}
                </ul>
              )}
              {members.length ? (
                <>
                  {stacked && <p className="mt-2.5 text-[11px] text-mute">Stack members, each on the training scale (about one front in three) before the base-rate shift. The stacked score weighs them; no single member is the assessment.</p>}
                  <div className={`mt-2 grid gap-2 ${members.length > 4 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
                    {members.map(x => (
                      <div key={x.modelVersion} className="rounded border border-line bg-panel px-2.5 py-1.5 text-xs">
                        <div className="text-[11px] text-mute truncate">{x.modelVersion}</div>
                        <div className="font-mono font-semibold text-ink">{fmtProb(x.p)}</div>
                        {stacked && ml.ensemble?.weights?.[x.modelVersion] != null && <div className="text-[10px] text-mute">weight {ml.ensemble.weights[x.modelVersion].toFixed(2)}</div>}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          )}

          {hasEncoders && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-ink">Multi-Modal Encoders (supporting context only)</div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {ml.autoencoder && (
                  <div className="rounded border border-line bg-panel2 p-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-mute">Unusual vs training data · autoencoder ({ml.autoencoder.modelVersion})</span>
                      <Badge tone={ml.autoencoder.isAnomaly ? 'info' : 'mute'}>
                        {ml.autoencoder.isAnomaly ? 'Unusual' : 'Typical'} · {fmtProb(ml.autoencoder.anomalyScore)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-mute">
                      MSE <span className="font-mono text-ink">{ml.autoencoder.reconstructionError.toFixed(4)}</span> (p95 bar {ml.autoencoder.thresholdP95.toFixed(4)})
                    </div>
                    {ml.autoencoder.topResiduals.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-[11px] text-mute">
                        {ml.autoencoder.topResiduals.slice(0, 3).map(r => (
                          <li key={r.feature}>{words(r.feature)}: <span className="font-mono text-ink">{r.residual.toFixed(2)}</span></li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {ml.temporal && (
                  <div className="rounded border border-line bg-panel2 p-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-mute">Temporal 1D-CNN ({ml.temporal.modelVersion})</span>
                      <Badge tone={ml.temporal.riskScore >= 0.5 ? 'bad' : ml.temporal.riskScore >= 0.2 ? 'info' : 'ok'}>
                        Risk {fmtProb(ml.temporal.riskScore)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-mute">
                      Encoded <span className="font-mono text-ink">{ml.temporal.eventCount}</span> recent events
                      {ml.temporal.signals ? ` · out-of-state ${fmtProb(ml.temporal.signals.outOfStateShare ?? 0)} · peak ${ml.temporal.signals.weeklyPeakRatio ?? 1}×` : ''}
                    </div>
                  </div>
                )}

                {ml.graph && (
                  <div className="rounded border border-line bg-panel2 p-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-mute">Entity Graph R-GCN ({ml.graph.modelVersion})</span>
                      <Badge tone={ml.graph.riskScore >= 0.5 ? 'bad' : ml.graph.riskScore >= 0.2 ? 'info' : 'ok'}>
                        Risk {fmtProb(ml.graph.riskScore)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-mute">
                      {ml.graph.nodeCount} nodes · {ml.graph.edgeCount} edges · shared infra {ml.graph.motifs.sharedInfraEdges}, web links {ml.graph.motifs.websiteLinkEdges}, peers {ml.graph.motifs.peerCount}
                    </div>
                  </div>
                )}

                {ml.biEncoder && (
                  <div className="rounded border border-line bg-panel2 p-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-mute truncate">Semantic Bi-Encoder ({ml.biEncoder.backend})</span>
                      <Badge tone={ml.biEncoder.riskScore >= 0.5 ? 'bad' : ml.biEncoder.riskScore >= 0.25 ? 'info' : 'ok'}>
                        Mismatch {fmtProb(ml.biEncoder.mismatchShare)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-mute">
                      Mean sim <span className="font-mono text-ink">{ml.biEncoder.meanSimilarity.toFixed(2)}</span> across {ml.biEncoder.itemCount} observed items
                    </div>
                    {ml.biEncoder.mismatches.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-[11px] text-mute">
                        {ml.biEncoder.mismatches.slice(0, 3).map((m, idx) => (
                          <li key={`${m.kind}-${idx}`} className="truncate">
                            [{m.kind}] {m.text}: <span className="font-mono text-ink">{m.similarity.toFixed(2)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {ml.encoder && (
                <div className="rounded border border-line bg-panel2 p-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-mute">NLI Cross-Encoder ({ml.encoder.modelVersion})</span>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={ml.encoder.verdict === 'SUSPICIOUS' ? 'bad' : ml.encoder.verdict === 'CONSISTENT' ? 'ok' : 'mute'}>
                        {ml.encoder.verdict ?? (ml.encoder.abstained ? 'INSUFFICIENT' : 'SCORED')}
                      </Badge>
                      {ml.encoder.riskScore != null && <Badge tone="mute">Risk {fmtProb(ml.encoder.riskScore)}</Badge>}
                    </div>
                  </div>
                  <div className="mt-1 text-[11px] text-mute">
                    Top hypothesis: <b className="text-ink">{ml.encoder.label}</b> ({ml.encoder.score == null ? 'no score' : fmtProb(ml.encoder.score)})
                    {ml.encoder.latencyMs != null ? ` · ${ml.encoder.latencyMs} ms` : ''}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
