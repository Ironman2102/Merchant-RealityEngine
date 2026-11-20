/** Fan a case event out to every configured sink. The HTTP handler awaits the returned promise. */
import { existsSync, readFileSync } from 'node:fs';
import { postWebhook, type WebhookEvent, type WebhookSink } from './sinks/webhook';

export interface SinkConfig { type: string; url?: string; secretEnv?: string; events?: string[]; dir?: string }

let extra: WebhookSink[] = [];
let chain: Promise<void> = Promise.resolve();

export function setSinks(sinks: WebhookSink[]): void { extra = sinks; }

export function configuredSinks(): WebhookSink[] {
  const fromFile: WebhookSink[] = [];
  if (existsSync('workflow/outputs.json')) {
    const cfg = JSON.parse(readFileSync('workflow/outputs.json', 'utf8')) as { sinks?: SinkConfig[] };
    for (const s of cfg.sinks ?? []) {
      if (s.type === 'webhook' && s.url && s.secretEnv) fromFile.push({ type: 'webhook', url: s.url, secretEnv: s.secretEnv, events: s.events ?? [] });
    }
  }
  return [...fromFile, ...extra];
}

export function emit(event: string, caseId: string, data: Record<string, unknown>): Promise<void> {
  const ev: WebhookEvent = { event, caseId, at: new Date().toISOString(), data };
  const job = Promise.all(configuredSinks().map(s => postWebhook(s, ev))).then(() => undefined);
  chain = chain.then(() => job, () => job);
  return job;
}

/** Resolves when every emit started so far has finished. */
export function whenIdle(): Promise<void> { return chain; }
