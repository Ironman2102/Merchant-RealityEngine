/** Default and alternate workflow configs. Scores do not change. A funds action cannot drop its approver. */
import { readFileSync } from 'node:fs';
import { loadWorkflow, validateWorkflow, type WorkflowConfig } from '../../engine/workflowConfig';
import { resetDb } from '../../backend/src/db';
import { createUser } from '../../backend/src/auth';
import { approveInvestigation, openInvestigation, respondInvestigation } from '../../backend/src/workflow';
import { analyze } from '../../engine/index';
import { pseudonymize } from '../../backend/src/adapters/canonicalDataset';

export default function (): number {
  let bad = 0;
  const check = (name: string, ok: boolean, detail = '') => { if (!ok) { bad++; console.log(`  ✗ ${name} ${detail}`); } else console.log(`  ✓ ${name}`); };
  const def = loadWorkflow('workflow');
  const alt = loadWorkflow('examples/alt-pa/workflow');
  check('default validates', validateWorkflow(def).length === 0);
  check('alt validates', validateWorkflow(alt).length === 0);
  const broken: WorkflowConfig = structuredClone(def);
  broken.approvals.levels.L3.approvers = 0;
  check('zero approvers rejected', validateWorkflow(broken).some(e => e.includes('L3')));

  const raw = JSON.parse(readFileSync('frontend/public/samples/01-sweet-crumbs-betting-front.json', 'utf8'));
  const prevDir = process.env.MRE_WORKFLOW_DIR;
  delete process.env.MRE_WORKFLOW_DIR;
  const a = analyze(pseudonymize(raw));
  process.env.MRE_WORKFLOW_DIR = 'examples/alt-pa/workflow';
  const b = analyze(pseudonymize(raw));
  check('posterior unchanged across configs', a.ok && b.ok && Math.abs(a.result.fusion.posterior - b.result.fusion.posterior) < 1e-12);

  const prevStore = process.env.MRE_CASE_STORE;
  process.env.MRE_CASE_STORE = 'memory';
  process.env.MRE_WORKFLOW_DIR = 'examples/alt-pa/workflow';
  resetDb();
  const ana = createUser('alt-ana', 'workflow-test-password', 'analyst');
  const rev = createUser('alt-rev', 'workflow-test-password', 'reviewer');
  const rev2 = createUser('alt-rev2', 'workflow-test-password', 'reviewer');
  const opened = openInvestigation(raw, ana);
  check('alt open', opened.status === 200, String(opened.status));
  const id = opened.body.id as string;
  const proposed = respondInvestigation(id, { chosenLevel: 'RESTRICT_FLOW' }, ana);
  check('alt propose', proposed.status === 200 && (proposed.body.status === 'ALT_WAITING'), String(proposed.body.status));
  const one = approveInvestigation(id, { approve: true }, rev);
  check('one approver is not enough', one.status === 200 && (one.body.user as { executed: boolean }).executed === false);
  const two = approveInvestigation(id, { approve: true }, rev2);
  check('second approver completes restrict', two.status === 200 && (two.body.user as { executed: boolean }).executed === true && two.body.status === 'ALT_DONE');

  resetDb();
  if (prevStore === undefined) delete process.env.MRE_CASE_STORE; else process.env.MRE_CASE_STORE = prevStore;
  if (prevDir === undefined) delete process.env.MRE_WORKFLOW_DIR; else process.env.MRE_WORKFLOW_DIR = prevDir;
  return bad;
}
