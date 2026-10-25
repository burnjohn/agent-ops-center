import type { AgentScript } from '@agent-ops/shared';
import { describe, expect, it } from 'vitest';
import {
  session as sessionRules,
  ticket as ticketRules,
  type AgentState,
  type TicketState,
} from '../../../domain/index.js';
import type { SimScripts } from '../../services/ticket-work.js';
import { createTestPorts } from '../../testing/index.js';
import { assignTicket } from './assign-ticket.js';

const T0 = '2026-10-24T14:00:00.000Z';

const fakeScripts: SimScripts = {
  queuePlanning: (s: AgentScript) => ({ ...s, queue: [...s.queue, { kind: 'planning' } as never] }),
  queueReadComment: (s: AgentScript) => ({
    ...s,
    queue: [...s.queue, { kind: 'comment' } as never],
  }),
  queueReadAnswer: (s: AgentScript) => ({ ...s, queue: [...s.queue, { kind: 'answer' } as never] }),
};

function ticket(n: number, patch: Partial<TicketState> = {}): TicketState {
  return { ...ticketRules.createTicket({ number: n, title: `Ticket ${n}`, now: T0 }), ...patch };
}

function agent(id: string, patch: Partial<AgentState> = {}): AgentState {
  return {
    id,
    name: id,
    kind: 'simulated',
    model: 'claude-sonnet',
    stage: 'idle',
    lastSeenAt: T0,
    currentTicketId: null,
    currentSessionId: null,
    lastSessionId: null,
    currentTool: null,
    lastTool: null,
    pausedAfterRelease: false,
    ...patch,
  } as AgentState;
}

function fixture() {
  const p = createTestPorts();
  p.store.seedTicket(
    ticket(10, { status: 'ready', blockedQuestion: 'q', reviewComment: 'old comment' }),
  );
  p.store.seedTicket(ticket(12, { status: 'in_progress', assigneeId: 'alpha' }));
  p.store.seedAgent(agent('alpha', { stage: 'implementing', currentTicketId: 'T-12' }));
  p.store.seedAgent(agent('charlie', { currentSessionId: 'S-0415', lastSessionId: 'S-0415' }));
  p.store.seedSession(
    sessionRules.startSession({
      number: 415,
      agentId: 'charlie',
      ticketId: null,
      model: 'claude-sonnet',
      now: T0,
    }),
  );
  for (const id of ['alpha', 'charlie']) {
    p.store.data.simState.set(id, {
      agentId: id,
      scenario: 's',
      script: { version: 1, queue: [], askedTicketIds: [], prngState: 1 },
      silent: false,
      pendingRefusalTicketId: null,
      cooldownSteps: 0,
    });
  }
  return p;
}

describe('assignTicket', () => {
  it('assigns T-10 to charlie as an Operator event (AC-19)', async () => {
    const p = fixture();
    const out = await assignTicket({ uow: p.uow, scripts: fakeScripts }, 'T-10', {
      agentId: 'charlie',
      expectedStatus: 'ready',
    });
    expect(out.ticket).toMatchObject({
      status: 'in_progress',
      assigneeId: 'charlie',
      blockedQuestion: null,
      reviewComment: null,
    });
    expect(p.store.data.sessions.get('S-0415')?.status).toBe('completed');
    expect(out.session).toMatchObject({ status: 'running', ticketId: 'T-10' });
    expect(out.agent).toMatchObject({ stage: 'planning', currentTicketId: 'T-10' });
    expect(p.store.data.simState.get('charlie')?.script.queue).toHaveLength(1);

    const types = p.publisher.events.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'session.ended',
        'ticket.assigned',
        'agent.stage_changed',
        'session.started',
      ]),
    );
    const assigned = p.publisher.events.filter((e) => e.type === 'ticket.assigned');
    expect(assigned).toHaveLength(1);
    expect(assigned[0]).toMatchObject({ source: 'operator', payload: { claim: false } });
    expect(
      p.publisher.events.some((e) => e.source === 'agent_report' && e.type.startsWith('ticket.')),
    ).toBe(false);
  });

  it('refuses a busy agent (AC-20)', async () => {
    const p = fixture();
    await expect(
      assignTicket({ uow: p.uow, scripts: fakeScripts }, 'T-10', {
        agentId: 'alpha',
        expectedStatus: 'ready',
      }),
    ).rejects.toMatchObject({
      code: 'agent_busy',
      message: 'alpha is busy with T-12 — one ticket per agent.',
    });
    expect(p.publisher.events).toHaveLength(0);
  });

  it('refuses stale status and unknown ids', async () => {
    const p = fixture();
    const deps = { uow: p.uow, scripts: fakeScripts };
    await expect(
      assignTicket(deps, 'T-10', { agentId: 'charlie', expectedStatus: 'backlog' }),
    ).rejects.toMatchObject({ code: 'stale_state' });
    await expect(
      assignTicket(deps, 'T-99', { agentId: 'charlie', expectedStatus: 'ready' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      assignTicket(deps, 'T-10', { agentId: 'nobody', expectedStatus: 'ready' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses a ticket that cannot be assigned from its status', async () => {
    const p = fixture();
    await expect(
      assignTicket({ uow: p.uow, scripts: fakeScripts }, 'T-12', {
        agentId: 'charlie',
        expectedStatus: 'in_progress',
      }),
    ).rejects.toMatchObject({ code: 'transition_refused' });
  });
});
