/** Promoted rules live in the database, so a restart or a second process scores with what the audit says is live. */
import { setLiveDetectorPatch, type RulePatch } from '../../rules/index';
import { getDb } from './db';
import { assertRows, sealedWrite } from './integrity';

export function syncLiveRules(): void {
  assertRows('rules_state');
  const row = getDb().prepare('SELECT version, patch_json FROM rules_state WHERE id = 1').get() as { version: string; patch_json: string } | undefined;
  if (row) setLiveDetectorPatch(JSON.parse(row.patch_json) as RulePatch, row.version);
  else setLiveDetectorPatch(null, null);
}

export function saveLiveRules(patch: RulePatch | null, version: string | null): void {
  sealedWrite('rules_state', 1, () => {
    if (patch && version) getDb().prepare('INSERT INTO rules_state (id, version, patch_json) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, patch_json = excluded.patch_json').run(version, JSON.stringify(patch));
    else getDb().prepare('DELETE FROM rules_state WHERE id = 1').run();
  });
  syncLiveRules();
}
