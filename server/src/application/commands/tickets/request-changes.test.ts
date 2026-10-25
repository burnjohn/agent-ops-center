import type { AgentScript } from '@agent-ops/shared';
import { describe, expect, it } from 'vitest';
import {
  session as sessionRules,
  ticket as ticketRules,
  type AgentState,
} from '../../../domain/index.js';
import type { SimScripts } from '../../services/ticket-work.js';
import { createTestPorts } from '../../testing/index.js';
import { requestChanges } from './request-changes.js';

const fakeScripts: SimScripts = {
  queuePlanning: (s: AgentScript) => ({ ...s, queue: [...s.queue, { kind: 'planning' } as never] }),
  queueReadComment: (s: AgentScript) => ({
    ...s,
    queue: [...s.queue, { kind: 'comment' } as never],
  }),
  queueReadAnswer: (s: AgentScript) => ({ ...s, queue: [...s.queue, { kind: 'answer' } as never] }),
};

const T0 = '2026-10-24T14:00:00.000Z';

function fixture(status: 'review' | 'in_progress' = 'review') {
  const p = createTestPorts();
  p.store.seedTicket({
    ...ticketRules.createTicket({ number: 6, title: 'Six', now: T0 }),
    status,
    assigneeId: 'sim-3',
  });
  p.store.seedAgent({
    id: 'sim-3',
    name: 'sim-3',
    kind: 'simulated',
    model: 'claude-sonnet',
    stage: 'idle',
    lastSeenAt: T0,
    currentTicketId: 'T-6',
    currentSessionId: null,
    lastSessionId: 'S-0414',
    currentTool: null,
    lastTool: null,
    pausedAfterRelease: false,
  } as AgentState);
  p.store.data.simState.set('sim-3', {
    agentId: 'sim-3',
    scenario: 's',
    script: { version: 1, queue: [], askedTicketIds: [], prngState: 1 },
    silent: false,
    pendingRefusalTicketId: null,
    cooldownSteps: 0,
  });
  return p;
}

describe('requestChanges', () => {
  it('moves to In Progress with a new session and queued read-comment (AC-17)', async () => {
    const p = fixture();
    const out = await requestChanges({ uow: p.uow, scripts: fakeScripts }, 'T-6', {
      comment: '  Add tests  ',
    });
    expect(out.ticket).toMatchObject({
      status: 'in_progress',
      reviewComment: 'Add tests',
      assigneeId: 'sim-3',
    });
    expect(out.session).toMatchObject({ status: 'running', agentId: 'sim-3', ticketId: 'T-6' });
    expect(out.agent).toMatchObject({ currentSessionId: out.session?.id });
    expect(p.store.data.simState.get('sim-3')?.script.queue).toHaveLength(1);
    expect(p.publisher.events.map((e) => e.type)).toEqual([
      'ticket.changes_requested',
      'session.started',
      'log.appended',
    ]);
    expect(p.publisher.events[0]?.payload.summary).toBe('Requested changes · “Add tests”');
  });

  it('ends a still-open session first', async () => {
    const p = fixture();
    p.store.seedSession(
      sessionRules.startSession({
        number: 414,
        agentId: 'sim-3',
        ticketId: 'T-6',
        model: 'claude-sonnet',
        now: T0,
      }),
    );
    await requestChanges({ uow: p.uow, scripts: fakeScripts }, 'T-6', { comment: 'x' });
    expect(p.store.data.sessions.get('S-0414')?.status).toBe('completed');
  });

  it('refuses an empty comment (AC-18) and a non-Review ticket', async () => {
    const p = fixture();
    await expect(
      requestChanges({ uow: p.uow, scripts: fakeScripts }, 'T-6', { comment: '  ' }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      path: 'comment',
      message: 'A comment is required — tell the agent what to change.',
    });
    expect(p.publisher.events).toHaveLength(0);
    const q = fixture('in_progress');
    await expect(
      requestChanges({ uow: q.uow, scripts: fakeScripts }, 'T-6', { comment: 'x' }),
    ).rejects.toMatchObject({ code: 'transition_refused' });
  });
});
