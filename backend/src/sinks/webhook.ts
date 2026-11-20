/** Signed webhook delivery. Retries: 1s, 2s, 4s, 8s, 16s. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDb } from '../db';

export interface WebhookEvent { event: string; caseId: string; at: string; data: Record<string, unknown> }
export interface WebhookSink { type: 'webhook'; url: string; secretEnv: string; events: string[] }

export function signBody(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

export function signatureMatches(body: string, header: string, secret: string): boolean {
  const got = Buffer.from(header);
  const want = Buffer.from(signBody(body, secret));
  return got.length === want.length && timingSafeEqual(got, want);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function postWebhook(sink: WebhookSink, ev: WebhookEvent): Promise<void> {
  if (sink.events.length && !sink.events.includes(ev.event)) return;
  const secret = process.env[sink.secretEnv] ?? '';
  const body = JSON.stringify(ev);
  const delays = [0, 1000, 2000, 4000, 8000, 16000];
  let ok = 0;
  let attempts = 0;
  for (const wait of delays) {
    if (wait) await sleep(wait);
    attempts++;
    try {
      const res = await fetch(sink.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mre-signature': signBody(body, secret) }, body });
      if (res.ok) { ok = 1; break; }
    } catch { /* retry */ }
  }
  getDb().prepare('INSERT INTO deliveries (event, case_id, url, ok, attempts, at) VALUES (?, ?, ?, ?, ?, ?)').run(ev.event, ev.caseId, sink.url, ok, attempts, new Date().toISOString());
}
