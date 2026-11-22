/** Workflow fit. Guard-rails cannot be switched off by a config file. Self-approval is enforced in code. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ResponseDef {
  id: string;
  label: string;
  auto: boolean;
  restrictsFunds: boolean;
  needsLegal: boolean;
  engineLevel?: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
}
export interface LevelRule { approvers: number; approverRoles: string[] }
export interface WorkflowConfig {
  responses: ResponseDef[];
  approvals: {
    actions: Record<string, string[]>;
    levels: Record<string, LevelRule>;
    confirmedIllicit: { people: number; confirmRoles: string[] };
  };
  statuses: Record<string, string>;
  labels: Record<string, string>;
  roles: { roles: string[]; oidcGroups: Record<string, string> };
  outputs: { sinks: { type: string; dir?: string; url?: string; secretEnv?: string; events?: string[] }[] };
}

const ENGINE_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];
/** These restrict a merchant whatever a config file calls them. */
export const RESTRICTING = ENGINE_LEVELS.slice(3);

const read = (dir: string, name: string) => JSON.parse(readFileSync(join(dir, name), 'utf8'));

export function validateWorkflow(cfg: WorkflowConfig): string[] {
  const errors: string[] = [];
  const roles = new Set(cfg.roles?.roles ?? []);
  const used = new Set<string>();
  for (const list of Object.values(cfg.approvals?.actions ?? {})) for (const r of list) used.add(r);
  for (const level of Object.values(cfg.approvals?.levels ?? {})) for (const r of level.approverRoles ?? []) used.add(r);
  for (const r of cfg.approvals?.confirmedIllicit?.confirmRoles ?? []) used.add(r);
  for (const r of cfg.roles?.oidcGroups ? Object.values(cfg.roles.oidcGroups) : []) used.add(r);
  for (const r of used) if (!roles.has(r)) errors.push(`Role "${r}" is not in roles.json.`);
  for (const resp of cfg.responses ?? []) {
    const level = resp.engineLevel ?? resp.id;
    if (!ENGINE_LEVELS.includes(level)) errors.push(`${resp.id} must map to an engineLevel from L0 to L5.`);
    if (RESTRICTING.includes(level) && !resp.restrictsFunds) errors.push(`${resp.id} is a ${level} restriction, so restrictsFunds must be true.`);
    if ((level === 'L4' || level === 'L5') && !resp.needsLegal) errors.push(`${resp.id} is ${level}, so needsLegal must be true.`);
    if (resp.restrictsFunds || !resp.auto) {
      const rule = cfg.approvals?.levels?.[resp.id];
      if (!rule || !(rule.approvers >= 1) || !rule.approverRoles?.length) errors.push(`${resp.id} ${resp.restrictsFunds ? 'restricts funds' : 'is not automatic'} but does not require an approver.`);
    }
    if (resp.needsLegal) {
      const rolesFor = cfg.approvals?.levels?.[resp.id]?.approverRoles ?? [];
      if (rolesFor.length === 0 || rolesFor.some(r => r !== 'legal')) errors.push(`${resp.id} needs legal approval, so its approver roles must be only legal.`);
    }
  }
  if (cfg.approvals?.confirmedIllicit?.people !== 2) errors.push('confirmedIllicit.people must be 2: a proposer and a different confirmer. Other counts are not supported.');
  return errors;
}

export function loadWorkflow(dir = process.env.MRE_WORKFLOW_DIR || 'workflow'): WorkflowConfig {
  if (!existsSync(dir)) throw new Error(`Workflow directory ${dir} does not exist.`);
  const cfg: WorkflowConfig = {
    responses: read(dir, 'responses.json'),
    approvals: read(dir, 'approvals.json'),
    statuses: read(dir, 'statuses.json'),
    labels: read(dir, 'labels.json'),
    roles: read(dir, 'roles.json'),
    outputs: read(dir, 'outputs.json'),
  };
  const errors = validateWorkflow(cfg);
  if (errors.length) throw new Error(errors.join(' '));
  return cfg;
}

export function engineLevelOf(cfg: WorkflowConfig, id: string): 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' {
  const row = cfg.responses.find(r => r.id === id);
  return row?.engineLevel ?? (id as 'L0');
}
