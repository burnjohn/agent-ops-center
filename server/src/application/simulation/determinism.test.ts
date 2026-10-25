import { describe, expect, it } from 'vitest';
import { runToNextStage } from './run-to-next-stage.js';
import { stepAll } from './step-all.js';
import { stepAgent } from './step-agent.js';
import { setup } from './step-agent.test.js';

async function run() {
  const p = setup();
  const deps = { ...p.deps, isPlaying: () => false };
  await stepAgent(p.deps, { agentId: 'sim-1', ticketId: 'T-8' });
  await stepAll(deps);
  await runToNextStage(p.deps, { agentId: 'sim-1', ticketId: 'T-8' });
  await stepAll(deps, 'play');
  return p.publisher.events.map(({ type, payload, at, agentId, ticketId, sessionId }) => ({
    type,
    payload,
    at,
    agentId,
    ticketId,
    sessionId,
  }));
}

describe('determinism (API-AC-57, ADR-0008)', () => {
  it('same seed and same command sequence give identical events', async () => {
    const a = await run();
    const b = await run();
    expect(a.length).toBeGreaterThan(5);
    expect(b).toEqual(a);
  });
});
