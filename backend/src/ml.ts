/** The second opinion runs in this process: no sandbox to start, nothing downloaded from a branch, nothing to time out. */
import type { InvestigationResult } from '../../frontend/src/types/investigation';
import { secondOpinion, type SecondOpinion } from '../../engine/model';

export type MlOpinion = SecondOpinion;
export const mlScore = (result: InvestigationResult): MlOpinion => secondOpinion(result);
