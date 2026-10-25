import { stepAgentOnce, type StepAgentInput, type StepDeps } from './step-agent.js';

export const MAX_RUN_STEPS = 40;

export type RunStopReason = 'stage_changed' | 'waiting' | 'no_work' | 'limit';

export interface RunToNextStageResult {
  seq: number;
  steps: number;
  stopReason: RunStopReason;
}

/**
 * Operator "Run to next stage" (API-AC-46): repeated Next steps, each its own transaction (committed and
 * published separately). The first step is validated like Next step (`cannot_step`); stops on a stage
 * change, when the agent waits for the Operator, has nothing left, or after 40 steps.
 */
export async function runToNextStage(
  deps: StepDeps,
  input: StepAgentInput,
  maxSteps: number = MAX_RUN_STEPS,
): Promise<RunToNextStageResult> {
  let steps = 0;
  let seq = 0;
  while (steps < maxSteps) {
    const out = await stepAgentOnce(deps, input, 'to_next_stage');
    steps += 1;
    seq = out.seq;
    if (out.stageAfter !== out.stageBefore) return { seq, steps, stopReason: 'stage_changed' };
    if (out.stop) return { seq, steps, stopReason: out.stop };
  }
  return { seq, steps, stopReason: 'limit' };
}
