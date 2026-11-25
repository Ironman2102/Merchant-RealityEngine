/** Ask the local model service. Any failure, including a timeout, leaves the Bayesian decision unchanged. */
import { modelFeatures } from '../../engine/features';
import type { InvestigationResult } from '../../frontend/src/types/investigation';
import { modelHostConfigured, modelOnline, startModelSandbox, stopModelSandbox } from './modelHost';

export interface MlDriver { feature: string; shap: number }
/** Stage 2 v1: exact-sum attribution of the stacked logit (ml/explain.py); `drivers` are its top five. */
export interface MlExplanation {
  method: string; baseLogit: number; stackedLogit: number; sumOfAttributions: number; residual: number; preCalibration: boolean;
  perModel: Record<string, { weight: number; method: string; baseLogit: number; logit: number; completenessError: number; top: { feature: string; value: number }[] }>;
}

export interface NliEncoderOpinion {
  label: string | null;
  score: number | null;
  modelVersion: string;
  verdict?: 'CONSISTENT' | 'SUSPICIOUS' | 'INSUFFICIENT';
  riskScore?: number;
  abstained?: boolean;
  scores?: Record<string, number>;
  latencyMs?: number;
  truncated?: boolean;
}
export interface BiEncoderOpinion {
  modelVersion: string;
  backend: 'neural' | 'lexical-fallback';
  meanSimilarity: number;
  minSimilarity: number;
  mismatchShare: number;
  riskScore: number;
  itemCount: number;
  mismatches: { text: string; kind: string; similarity: number }[];
  latencyMs?: number;
}
export interface AutoencoderOpinion {
  modelVersion: string;
  anomalyScore: number;
  reconstructionError: number;
  thresholdP95: number;
  isAnomaly: boolean;
  latentNorm: number;
  topResiduals: { feature: string; residual: number }[];
}
export interface TemporalEncoderOpinion {
  modelVersion: string;
  riskScore: number;
  embeddingNorm: number;
  eventCount: number;
  signals?: Record<string, number>;
}
export interface GraphEncoderOpinion {
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
}

export interface MlOpinion {
  p: number;
  pRaw: number;
  drivers: MlDriver[];
  modelVersion: string;
  nn?: { p: number; drivers: MlDriver[]; modelVersion: string };
  classical?: { p: number; modelVersion: string }[];
  ensemble?: {
    p: number; models: string[]; disagreement: number; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; review: boolean; syntheticTrainingExamples?: number | null;
    // Stage 2 v1 only: stacked ensemble, prior shift, cost threshold, conformal set and novelty check.
    method?: 'stacked'; pTrainScale?: number; weights?: Record<string, number>;
    priorShift?: { applied: boolean; enginePrior: number | null; trainPrevalence: number };
    threshold?: number; flag?: boolean; costRatio?: number;
    conformalSet?: ('front' | 'honest')[]; conformalAlpha?: number; conformalPValues?: { front: number; honest: number };
    novelty?: { distance: number; threshold: number; flagged: boolean; pValue?: number; unfamiliar: string[] };
    calibration?: string;
    uncertainty?: { totalBits: number; aleatoricBits: number; epistemicBits: number };
    neymanPearson?: { threshold: number; flag: boolean; alpha: number; delta: number } | null;
  };
  encoder?: NliEncoderOpinion;
  biEncoder?: BiEncoderOpinion;
  autoencoder?: AutoencoderOpinion;
  temporal?: TemporalEncoderOpinion;
  graph?: GraphEncoderOpinion;
  assessment?: { statisticalP: number; combinedP: number; classification: 'HIGH_RISK' | 'LOW_RISK' | 'REVIEW'; review: boolean };
  explanation?: MlExplanation;
}

/** Structured, non-leaky premise for the NLI cross-encoder (omits scenario.blurb narration). */
function encoderContext(result: InvestigationResult): string {
  const { scenario } = result;
  const p = scenario.profile;
  const lines: string[] = [];

  lines.push(
    `Declared business: ${p.category} (MCC ${p.mcc}, ${p.city}).` +
    (p.products.length ? ` Products: ${p.products.slice(0, 10).join(', ')}.` : '') +
    (p.declaredChannels.length ? ` Channels: ${p.declaredChannels.join(', ')}.` : '') +
    (p.declaredActivity.length ? ` Activity: ${p.declaredActivity.join(', ')}.` : '') +
    (p.declaredDomains.length ? ` Domains: ${p.declaredDomains.join(', ')}.` : ''),
  );

  const offDomain = scenario.web.embeds.filter(e => e.category !== 'own');
  const ownEmbeds = scenario.web.embeds.filter(e => e.category === 'own');
  if (offDomain.length) {
    lines.push(`Off-domain embeds: ${offDomain.slice(0, 8).map(x => `${x.host}${x.path} [${x.category}, ${x.pageType}]`).join('; ')}.`);
  } else if (ownEmbeds.length) {
    lines.push(`Observed embeds: ${ownEmbeds.slice(0, 5).map(x => `${x.host}${x.path} [${x.pageType}]`).join('; ')}.`);
  }

  if (scenario.sightings?.length) {
    lines.push(`Outside-in sightings: ${scenario.sightings.slice(0, 6).map(s => `${s.source} at ${s.place}${s.note ? ` (${s.note})` : ''}`).join('; ')}.`);
  }

  if (scenario.passports?.length) {
    lines.push(`Context passports: ${scenario.passports.slice(0, 4).map(cp => `${cp.status}: ${cp.reason} (${cp.document})`).join('; ')}.`);
  }

  if (scenario.web.catalogue.length) {
    const flagged = scenario.web.catalogue.filter(c => !c.inCategory || c.dupImage);
    const sample = (flagged.length ? flagged : scenario.web.catalogue).slice(0, 10);
    lines.push(`Catalogue (${scenario.web.catalogue.length} items): ${sample.map(c => `${c.name} (INR ${c.price})`).join(', ')}.`);
  }

  return lines.join('\n').slice(0, 1600);
}

/** Declared vs. observed text pairs for the Semantic Bi-Encoder. */
function alignmentPayload(result: InvestigationResult) {
  const { scenario } = result;
  const p = scenario.profile;
  const declared = [p.category, ...p.products, ...p.declaredActivity].filter(Boolean).join(', ');
  const observed: { text: string; kind: string }[] = [];

  for (const item of scenario.web.catalogue.slice(0, 16)) {
    observed.push({ text: item.name, kind: 'catalogue' });
  }
  for (const emb of scenario.web.embeds.slice(0, 10)) {
    observed.push({ text: `${emb.host} ${emb.path} ${emb.category} ${emb.pageType}`.trim(), kind: 'embed' });
  }
  for (const s of (scenario.sightings ?? []).slice(0, 6)) {
    observed.push({ text: `${s.source} ${s.place} ${s.note ?? ''}`.trim(), kind: 'sighting' });
  }

  return declared && observed.length ? { declared, observed } : undefined;
}

/** Compact 10-channel event sequence + 8-dim weekly trajectory for the Temporal 1D-CNN Encoder. */
function sequencePayload(result: InvestigationResult) {
  const localStates = new Set(result.scenario.profile.localStates ?? []);
  const baseline = Math.max(1, result.scenario.profile.baselineWeekly || 40000);
  const sorted = [...result.events].sort((a, b) => a.eventTime - b.eventTime);
  const recent = sorted.slice(-64);

  const IST_MS = 19_800_000;
  const events: number[][] = [];
  let prevT: number | null = null;
  let night = 0, outStateCount = 0, upiLinkCount = 0, salesCount = 0;

  for (const ev of recent) {
    const tSec = ev.eventTime / 1000;
    const dt = prevT !== null && tSec > prevT ? Math.max(1, tSec - prevT) : 3600;
    prevT = tSec;
    const amt = Math.max(1, ev.amount || 0);
    const hour = (((ev.eventTime + IST_MS) % 86_400_000) + 86_400_000) % 86_400_000 / 3_600_000;
    const ang = (2 * Math.PI * hour) / 24;
    const isSale = ev.type === 'SALE' ? 1 : 0;
    const isUpi = ev.channel === 'UPI_LINK' || ev.channel === 'UPI_COLLECT' ? 1 : 0;
    const isOut = localStates.size > 0 && ev.payerState && !localStates.has(ev.payerState) ? 1 : 0;

    if (isSale) {
      salesCount++;
      if (hour >= 23 || hour < 6) night++;
      if (isOut) outStateCount++;
      if (isUpi) upiLinkCount++;
    }

    events.push([
      Math.min(Math.log1p(dt) / 12, 1.5),
      Math.min(Math.log1p(amt) / 12, 1.5),
      Math.sin(ang),
      Math.cos(ang),
      isSale,
      ev.type === 'REFUND' ? 1 : 0,
      ev.type === 'TRANSFER' ? 1 : 0,
      ev.type === 'SETTLEMENT' ? 1 : 0,
      isUpi,
      isOut,
    ]);
  }

  const weeklyPts = result.scenario.weekly ?? [];
  const ratios: number[] = [];
  let missing = 0;
  for (const w of weeklyPts) {
    if (w.actual == null) { missing++; continue; }
    const mult = Math.max(0.2, w.seasonalMult || 1);
    ratios.push(w.actual / (baseline * mult));
  }
  let weekly: number[];
  let peakRatio = 1;
  if (ratios.length) {
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    peakRatio = Math.max(...ratios);
    const last = ratios[ratios.length - 1];
    const variance = ratios.reduce((s, x) => s + (x - mean) ** 2, 0) / ratios.length;
    const slope = ratios.length > 1 ? (last - ratios[0]) / (ratios.length - 1) : 0;
    const spikeShare = ratios.filter(r => r >= 1.8).length / ratios.length;
    weekly = [
      Math.min(5, Math.max(0, mean)),
      Math.min(8, Math.max(0, peakRatio)),
      Math.min(8, Math.max(0, last)),
      Math.min(4, Math.sqrt(variance)),
      Math.min(2, Math.max(-2, slope)),
      Math.min(1.5, ratios.length / 16),
      spikeShare,
      missing / Math.max(1, weeklyPts.length),
    ];
  } else {
    weekly = [1, 1, 1, 0, 0, 0, 0, 1];
  }

  if (!events.length && !ratios.length) return undefined;
  return {
    events,
    weekly,
    signals: {
      nightShare: salesCount ? Number((night / salesCount).toFixed(3)) : 0,
      outOfStateShare: salesCount ? Number((outStateCount / salesCount).toFixed(3)) : 0,
      upiLinkShare: salesCount ? Number((upiLinkCount / salesCount).toFixed(3)) : 0,
      weeklyPeakRatio: Number(peakRatio.toFixed(2)),
    },
  };
}

/** Compact entity graph payload for the 2-layer R-GCN Encoder. */
function graphPayload(result: InvestigationResult) {
  const g = result.scenario.graph;
  if (!g?.nodes?.length) return undefined;
  return {
    nodes: g.nodes.slice(0, 128).map(n => ({ id: n.id, type: n.type })),
    edges: g.edges.slice(0, 512).map(e => ({ source: e.source, target: e.target, type: e.type, ...(e.weight != null ? { weight: e.weight } : {}) })),
  };
}

let logged = false;

export async function mlScore(result: InvestigationResult): Promise<MlOpinion | null> {
  const url = (process.env.MRE_ML_URL ?? 'http://127.0.0.1:8790').replace(/\/$/, '');
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(url);
  // First uncertain request may lazily load the configured text model; allow that one-time cost.
  const defaultTimeout = isLocal ? 10000 : 5000;
  const rawTimeout = Number(process.env.MRE_ML_TIMEOUT) > 0 ? Number(process.env.MRE_ML_TIMEOUT) : defaultTimeout;
  const timeoutMs = isLocal ? rawTimeout : Math.min(24000, rawTimeout);
  try {
    const res = await fetch(`${url}/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Send exactly the training row. Leaving out the behavioural columns scored them as zero (a zero sweep lag
      // reads as "swept instantly"), which cut v0 neural-net recall on held-out fronts from 100% to 40%.
      body: JSON.stringify({
        features: modelFeatures(result),
        context: encoderContext(result),
        alignment: alignmentPayload(result),
        sequence: sequencePayload(result),
        graph: graphPayload(result),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`ML ${res.status}`);
    const body = await res.json() as {
      p?: number;
      p_raw?: number;
      drivers?: MlDriver[];
      modelVersion?: string;
      nn?: { p?: number; drivers?: MlDriver[]; modelVersion?: string };
      classical?: MlOpinion['classical'];
      ensemble?: MlOpinion['ensemble'];
      encoder?: NliEncoderOpinion;
      biEncoder?: BiEncoderOpinion;
      autoencoder?: AutoencoderOpinion;
      temporal?: TemporalEncoderOpinion;
      graph?: GraphEncoderOpinion;
      explanation?: MlExplanation;
    };
    if (typeof body.p !== 'number' || !body.modelVersion) return null;
    const nn = body.nn && typeof body.nn.p === 'number' && body.nn.modelVersion
      ? { p: body.nn.p, drivers: body.nn.drivers ?? [], modelVersion: body.nn.modelVersion }
      : undefined;
    return {
      p: body.p, pRaw: body.p_raw ?? body.p, drivers: body.drivers ?? [], modelVersion: body.modelVersion,
      ...(nn ? { nn } : {}),
      ...(body.classical ? { classical: body.classical } : {}),
      ...(body.ensemble ? { ensemble: body.ensemble } : {}),
      ...(body.encoder ? { encoder: body.encoder } : {}),
      ...(body.biEncoder ? { biEncoder: body.biEncoder } : {}),
      ...(body.autoencoder ? { autoencoder: body.autoencoder } : {}),
      ...(body.temporal ? { temporal: body.temporal } : {}),
      ...(body.graph ? { graph: body.graph } : {}),
      ...(body.explanation ? { explanation: body.explanation } : {}),
    };
  } catch (err) {
    if (!logged) { console.error('AI model offline. The decision does not depend on it.', err instanceof Error ? err.message : err); logged = true; }
    return null;
  }
}

/** On the hosted site, a score wakes the Daytona sandbox if needed and asks the model (leaving it warm for follow-up scores). */
export async function scoreWithHost(result: InvestigationResult): Promise<MlOpinion | null> {
  const direct = await mlScore(result);
  if (direct || !modelHostConfigured()) return direct;
  if (await modelOnline()) return null;
  await startModelSandbox();
  return await mlScore(result);
}
