/** Ask the local model service. Any failure, including a timeout, leaves the Bayesian decision unchanged. */
import { features } from '../../engine/features';
import type { InvestigationResult } from '../../frontend/src/types/investigation';

export interface MlOpinion { p: number; pRaw: number; drivers: { feature: string; shap: number }[]; modelVersion: string }

let logged = false;

export async function mlScore(result: InvestigationResult): Promise<MlOpinion | null> {
  const url = process.env.MRE_ML_URL ?? 'http://127.0.0.1:8790';
  try {
    const res = await fetch(`${url}/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features: features(result) }),
      signal: AbortSignal.timeout(500),
    });
    if (!res.ok) throw new Error(`ML ${res.status}`);
    const body = await res.json() as { p?: number; p_raw?: number; drivers?: { feature: string; shap: number }[]; modelVersion?: string };
    if (typeof body.p !== 'number' || !body.modelVersion) return null;
    return { p: body.p, pRaw: body.p_raw ?? body.p, drivers: body.drivers ?? [], modelVersion: body.modelVersion };
  } catch (err) {
    if (!logged) { console.error('AI model offline. The decision does not depend on it.', err instanceof Error ? err.message : err); logged = true; }
    return null;
  }
}
