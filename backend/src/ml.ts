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
}

let logged = false;

export async function mlScore(result: InvestigationResult): Promise<MlOpinion | null> {
  const url = (process.env.MRE_ML_URL ?? 'http://127.0.0.1:8790').replace(/\/$/, '');
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(url);
  const defaultTimeout = isLocal ? 500 : 5000;
  const timeoutMs = Number(process.env.MRE_ML_TIMEOUT) > 0 ? Number(process.env.MRE_ML_TIMEOUT) : defaultTimeout;
  try {
    const res = await fetch(`${url}/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features: features(result) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`ML ${res.status}`);
    const body = await res.json() as {
      p?: number;
      p_raw?: number;
      drivers?: MlDriver[];
      modelVersion?: string;
      nn?: { p?: number; drivers?: MlDriver[]; modelVersion?: string };
    };
    if (typeof body.p !== 'number' || !body.modelVersion) return null;
    const nn = body.nn && typeof body.nn.p === 'number' && body.nn.modelVersion
      ? { p: body.nn.p, drivers: body.nn.drivers ?? [], modelVersion: body.nn.modelVersion }
      : undefined;
    return { p: body.p, pRaw: body.p_raw ?? body.p, drivers: body.drivers ?? [], modelVersion: body.modelVersion, ...(nn ? { nn } : {}) };
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
