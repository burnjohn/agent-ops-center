import { describe, expect, it } from 'vitest';
import { ticket as ticketRules, type AgentState, type TicketState } from '../../domain/index.js';
import { createTestPorts } from '../testing/index.js';
import { createSimScripts, scriptFor } from './scripts.js';
import { stepAgent } from './step-agent.js';

export const T0 = '2026-10-24T14:00:00.000Z';
export const scripts = createSimScripts();

export function mkAgent(id: string, patch: Partial<AgentState> = {}): AgentState {
  return {
    id,
    name: id,
    kind: 'simulated',
    model: 'sonnet-5-5',
    stage: 'idle',
    lastSeenAt: T0,
    currentTicketId: null,
    currentSessionId: null,
    lastSessionId: null,
    currentTool: null,
    lastTool: null,
    pausedAfterRelease: false,
    ...patch,
  };
}

/** Ports with `sim-1` working on T-8 (planning script queued) and an idle `sim-2`. */
export function setup(ticketPatch: Partial<TicketState> = {}) {
  const p = createTestPorts();
  p.store.data.simulation.clockAt = T0;
  const ticket: TicketState = {
    ...ticketRules.createTicket({ number: 8, title: 'Eight', now: T0 }),
    status: 'in_progress',
    assigneeId: 'sim-1',
    ...ticketPatch,
  };
  p.store.seedTicket(ticket);
  p.store.seedAgent(
    mkAgent('sim-1', { stage: 'planning', currentTicketId: 'T-8', currentSessionId: null }),
  );
  p.store.seedAgent(mkAgent('sim-2'));
  const base = { scenario: 'none', silent: false, pendingRefusalTicketId: null, cooldownSteps: 0 };
  p.store.data.simState.set('sim-1', {
    agentId: 'sim-1',
    ...base,
    script: {
      version: 1,
      queue: scriptFor('planning', ticket, false),
      askedTicketIds: [],
      prngState: 20261024,
    },
  });
  p.store.data.simState.set('sim-2', {
    agentId: 'sim-2',
    ...base,
    script: { version: 1, queue: [], askedTicketIds: [], prngState: 20261025 },
  });
  return { ...p, deps: { uow: p.uow, scripts } };
}

describe('stepAgent (API-AC-44, AC-45)', () => {
  it('advances the clock by 6 s, acts once and ends with simulation.stepped', async () => {
    const p = setup();
    const out = await stepAgent(p.deps, { agentId: 'sim-1', ticketId: 'T-8' });
    expect(p.store.data.simulation.clockAt).toBe('2026-10-24T14:00:06.000Z');
    expect(out.act).toEqual({ agentId: 'sim-1', kind: 'tool_started' });
    const types = p.publisher.events.map((e) => e.type);
    expect(types.at(-1)).toBe('simulation.stepped');
    expect(types.filter((t) => t === 'simulation.stepped')).toHaveLength(1);
    expect(p.publisher.events.at(-1)?.payload).toMatchObject({
      mode: 'step',
      actedAgentIds: ['sim-1'],
    });
    expect(out.seq).toBe(p.publisher.events.at(-1)?.seq);
  });

  it('refuses a blocked ticket with cannot_step and changes nothing', async () => {
    const p = setup({ blockedQuestion: 'Which db?' });
    await expect(stepAgent(p.deps, { agentId: 'sim-1', ticketId: 'T-8' })).rejects.toMatchObject({
      code: 'cannot_step',
      reason: 'Blocked — answer above to continue',
    });
    expect(p.store.data.simulation.clockAt).toBe(T0);
    expect(p.publisher.events).toHaveLength(0);
  });

  it('refuses when the agent is no longer on the ticket', async () => {
    const p = setup();
    await expect(stepAgent(p.deps, { agentId: 'sim-2', ticketId: 'T-8' })).rejects.toMatchObject({
      code: 'cannot_step',
      reason: 'sim-2 is no longer on T-8.',
    });
  });
});
