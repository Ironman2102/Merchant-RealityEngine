/**
 * Server views built from a stored case: the reasoning trace and the evidence pack.
 * The evidence pack maps the case to the RBI Payment Aggregator Master Direction duty to monitor merchant
 * transactions against the business profile, and pre-fills the facts an FIU-IND STR needs. It is a DRAFT for
 * the Principal Officer: filing happens on FIU-IND's own portal, in its format.
 */
import { buildTrace } from '../../frontend/src/engines/traceEngine';
import { buildPack } from '../../engine/pack';
import { appendAudit, getCase, isCaseId, readAudit, verifyAudit } from './store';
import type { ApiReply } from './workflow';
import type { Actor } from './auth';

const fail = (status: number, error: string): ApiReply => ({ status, body: { error } });

export function caseTrace(id: string): ApiReply {
  if (!isCaseId(id)) return fail(400, 'Invalid case id.');
  const rec = getCase(id);
  return rec ? { status: 200, body: buildTrace(rec.result) as unknown as Record<string, unknown> } : fail(404, 'No case with that id.');
}

export function evidencePack(id: string, actor: Actor): ApiReply {
  if (!isCaseId(id)) return fail(400, 'Invalid case id.');
  const rec = getCase(id);
  if (!rec) return fail(404, 'No case with that id.');
  appendAudit(id, [{ action: 'Evidence pack exported', detail: `By ${actor.username} (${actor.role})` }], actor);
  const audit = readAudit(id);
  const body = buildPack(rec.result, {
    caseId: rec.id,
    createdAt: rec.createdAt,
    datasetSha256: rec.datasetSha256,
    generatedBy: { username: actor.username, role: actor.role },
    reportingEntity: process.env.MRE_ENTITY_NAME,
    engineVersion: rec.engineVersion ?? null,
    oversightEvidence: audit.filter(a => /proposed|approved|Approved by|Label/.test(a.action + a.detail)).map(a => `#${a.seq}`),
    actionTaken: rec.user.executed && rec.response ? rec.response.actions : [],
    label: rec.user.label,
    analystNotes: rec.user.notes,
  });
  return {
    status: 200,
    body: {
      ...body,
      audit: audit.map(({ seq, at, actor: who, action, detail, prevHash, hash }) => ({ seq, at, actor: who, action, detail, prevHash, hash })),
      auditVerification: verifyAudit(id),
    },
  };
}
