import { describe, expect, it } from 'vitest';
import { runToNextStage } from './run-to-next-stage.js';
import { setup } from './step-agent.test.js';

describe('runToNextStage (API-AC-46)', () => {
  it('runs planning until the stage changes, one commit per step', async () => {
    const p = setup();
    const out = await runToNextStage(p.deps, { agentId: 'sim-1', ticketId: 'T-8' });
    expect(out.stopReason).toBe('stage_changed');
    expect(p.store.data.agents.get('sim-1')?.stage).toBe('implementing');
    const stepped = p.publisher.events.filter((e) => e.type === 'simulation.stepped');
    expect(stepped).toHaveLength(out.steps);
    expect(stepped.every((e) => (e.payload as { mode: string }).mode === 'to_next_stage')).toBe(
      true,
    );
    expect(p.publisher.events.at(-1)?.type).toBe('simulation.stepped');
  });

  it('never takes more than 40 steps', async () => {
    const p = setup();
    const out = await runToNextStage(p.deps, { agentId: 'sim-1', ticketId: 'T-8' }, 2);
    expect(out).toMatchObject({ steps: 2, stopReason: 'limit' });
    const hundred = setup();
    const sim = hundred.store.data.simState.get('sim-1')!;
    // A queue far longer than 40 actions of one stage: the loop is capped at 40 steps.
    hundred.store.data.simState.set('sim-1', {
      ...sim,
      script: {
        ...sim.script,
        queue: Array.from({ length: 100 }, () => ({ kind: 'message' as const, text: 'x' })),
      },
    });
    const big = await runToNextStage(hundred.deps, { agentId: 'sim-1', ticketId: 'T-8' });
    expect(big).toMatchObject({ steps: 40, stopReason: 'limit' });
  });

  it('stops with no_work when the script runs out', async () => {
    const p = setup();
    const sim = p.store.data.simState.get('sim-1')!;
    p.store.data.simState.set('sim-1', {
      ...sim,
      script: { ...sim.script, queue: [{ kind: 'message', text: 'only one' }] },
    });
    const out = await runToNextStage(p.deps, { agentId: 'sim-1', ticketId: 'T-8' });
    expect(out).toMatchObject({ steps: 1, stopReason: 'no_work' });
  });

  it('refuses the first step like Next step', async () => {
    const p = setup({ blockedQuestion: 'q' });
    await expect(
      runToNextStage(p.deps, { agentId: 'sim-1', ticketId: 'T-8' }),
    ).rejects.toMatchObject({ code: 'cannot_step' });
  });
});
