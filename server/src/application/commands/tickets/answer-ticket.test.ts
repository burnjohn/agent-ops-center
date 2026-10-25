import type { AgentScript } from '@agent-ops/shared';
import { describe, expect, it } from 'vitest';
import { ticket as ticketRules, type AgentState } from '../../../domain/index.js';
import type { SimScripts } from '../../services/ticket-work.js';
import { createTestPorts } from '../../testing/index.js';
import { answerTicket } from './answer-ticket.js';

const fakeScripts: SimScripts = {
  queuePlanning: (s: AgentScript) => ({ ...s, queue: [...s.queue, { kind: 'planning' } as never] }),
  queueReadComment: (s: AgentScript) => ({
    ...s,
    queue: [...s.queue, { kind: 'comment' } as never],
  }),
  queueReadAnswer: (s: AgentScript) => ({ ...s, queue: [...s.queue, { kind: 'answer' } as never] }),
};

const T0 = '2026-10-24T14:00:00.000Z';

function fixture(blocked: string | null = 'Which db?') {
  const p = createTestPorts();
  p.store.seedTicket({
    ...ticketRules.createTicket({ number: 8, title: 'Eight', now: T0 }),
    status: 'in_progress',
    assigneeId: 'sim-1',
    blockedQuestion: blocked,
  });
  p.store.seedAgent({
    id: 'sim-1',
    name: 'sim-1',
    kind: 'simulated',
    model: 'claude-sonnet',
    stage: 'implementing',
    lastSeenAt: T0,
    currentTicketId: 'T-8',
    currentSessionId: 'S-0410',
    lastSessionId: 'S-0410',
    currentTool: null,
    lastTool: null,
    pausedAfterRelease: false,
  } as AgentState);
  p.store.data.simState.set('sim-1', {
    agentId: 'sim-1',
    scenario: 's',
    script: { version: 1, queue: [], askedTicketIds: [], prngState: 1 },
    silent: false,
    pendingRefusalTicketId: null,
    cooldownSteps: 0,
  });
  return p;
}

describe('answerTicket', () => {
  it('clears the question, stores the answer, queues read-answer (AC-21)', async () => {
    const p = fixture();
    const out = await answerTicket({ uow: p.uow, scripts: fakeScripts }, 'T-8', {
      answer: ' Postgres ',
    });
    expect(out.ticket).toMatchObject({ blockedQuestion: null, answer: 'Postgres' });
    expect(p.store.data.simState.get('sim-1')?.script.queue).toHaveLength(1);
    expect(p.publisher.events).toHaveLength(1);
    expect(p.publisher.events[0]).toMatchObject({
      type: 'ticket.unblocked',
      source: 'operator',
      payload: { summary: 'Answered sim-1 · “Postgres”' },
    });
  });

  it('refuses a ticket that is not blocked', async () => {
    const p = fixture(null);
    await expect(
      answerTicket({ uow: p.uow, scripts: fakeScripts }, 'T-8', { answer: 'x' }),
    ).rejects.toMatchObject({ code: 'not_blocked' });
  });

  it('refuses an empty answer', async () => {
    const p = fixture();
    await expect(
      answerTicket({ uow: p.uow, scripts: fakeScripts }, 'T-8', { answer: ' ' }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      path: 'answer',
      message: 'Write an answer before unblocking.',
    });
  });
});
