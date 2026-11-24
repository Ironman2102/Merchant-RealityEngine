/** Ask the local model service. Any failure, including a timeout, leaves the Bayesian decision unchanged. */
import { features } from '../../engine/features';
import type { InvestigationResult } from '../../frontend/src/types/investigation';
import { modelHostConfigured, startModelSandbox, stopModelSandbox } from './modelHost';

export interface MlDriver { feature: string; shap: number }
export interface MlOpinion {
  p: number;
  pRaw: number;
  drivers: MlDriver[];
  modelVersion: string;
  nn?: { p: number; drivers: MlDriver[]; modelVersion: string };
  classical?: { p: number; modelVersion: string }[];
  ensemble?: { p: number; models: string[]; disagreement: number; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; review: boolean; syntheticTrainingExamples?: number | null };
  encoder?: { label: string | null; score: number | null; modelVersion: string };
  assessment?: { statisticalP: number; combinedP: number; classification: 'HIGH_RISK' | 'LOW_RISK' | 'REVIEW'; review: boolean };
}

function encoderContext(result: InvestigationResult): string {
  const { scenario } = result;
  return [scenario.blurb, scenario.profile.category, scenario.profile.products.join(', '),
    ...scenario.web.catalogue.slice(0, 20).map(x => x.name),
    ...scenario.web.embeds.slice(0, 20).map(x => `${x.host}${x.path} ${x.category} ${x.pageType}`)]
    .filter(Boolean).join('\n').slice(0, 6000);
}

let logged = false;

export async function mlScore(result: InvestigationResult): Promise<MlOpinion | null> {
  const url = (process.env.MRE_ML_URL ?? 'http://127.0.0.1:8790').replace(/\/$/, '');
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(url);
  // First uncertain request may lazily load the configured text model; allow that one-time cost.
  const defaultTimeout = isLocal ? 10000 : 5000;
  const timeoutMs = Number(process.env.MRE_ML_TIMEOUT) > 0 ? Number(process.env.MRE_ML_TIMEOUT) : defaultTimeout;
  try {
    const res = await fetch(`${url}/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features: features(result), context: encoderContext(result) }),
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
      encoder?: MlOpinion['encoder'];
    };
    if (typeof body.p !== 'number' || !body.modelVersion) return null;
    const nn = body.nn && typeof body.nn.p === 'number' && body.nn.modelVersion
      ? { p: body.nn.p, drivers: body.nn.drivers ?? [], modelVersion: body.nn.modelVersion }
      : undefined;
    return { p: body.p, pRaw: body.p_raw ?? body.p, drivers: body.drivers ?? [], modelVersion: body.modelVersion,
      ...(nn ? { nn } : {}), ...(body.classical ? { classical: body.classical } : {}),
      ...(body.ensemble ? { ensemble: body.ensemble } : {}), ...(body.encoder ? { encoder: body.encoder } : {}) };
  } catch (err) {
    if (!logged) { console.error('AI model offline. The decision does not depend on it.', err instanceof Error ? err.message : err); logged = true; }
    return null;
  }
}

/** On the hosted site, a score wakes the Daytona sandbox if needed and asks the model (leaving it warm for follow-up scores). */
export async function scoreWithHost(result: InvestigationResult): Promise<MlOpinion | null> {
  const direct = await mlScore(result);
  if (direct || !modelHostConfigured()) return direct;
  await startModelSandbox();
  return await mlScore(result);
}
