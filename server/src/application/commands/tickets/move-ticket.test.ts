import { TRANSITIONS, type TicketStatus } from '@agent-ops/shared';
import { describe, expect, it } from 'vitest';
import {
  DomainRefusal,
  session as sessionRules,
  ticket as ticketRules,
  type AgentState,
  type TicketState,
} from '../../../domain/index.js';
import { createTestPorts } from '../../testing/index.js';
import { moveTicket } from './move-ticket.js';

const STATUSES: TicketStatus[] = ['backlog', 'ready', 'in_progress', 'review', 'done'];
const T0 = '2026-10-24T14:00:00.000Z';

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

/** T-12 in progress for alpha with running session S-0412. */
function fixture() {
  const p = createTestPorts();
  p.store.seedTicket(
    ticket(12, { status: 'in_progress', assigneeId: 'alpha', blockedQuestion: 'Which db?' }),
  );
  p.store.seedAgent(
    agent('alpha', {
      stage: 'implementing',
      currentTicketId: 'T-12',
      currentSessionId: 'S-0412',
      lastSessionId: 'S-0412',
    }),
  );
  p.store.seedSession(
    sessionRules.startSession({
      number: 412,
      agentId: 'alpha',
      ticketId: 'T-12',
      model: 'claude-sonnet',
      now: T0,
    }),
  );
  p.store.data.simState.set('alpha', {
    agentId: 'alpha',
    scenario: 's',
    script: { version: 1, queue: [], askedTicketIds: [], prngState: 1 },
    silent: false,
    pendingRefusalTicketId: null,
    cooldownSteps: 0,
  });
  return p;
}

const types = (p: ReturnType<typeof fixture>) => p.publisher.events.map((e) => e.type);

describe('moveTicket transition table (API-AC-10)', () => {
  const pairs = STATUSES.flatMap((from) =>
    STATUSES.filter((to) => to !== from).map((to) => [from, to] as const),
  );
  it('covers the 20 off-diagonal pairs', () => expect(pairs).toHaveLength(20));

  it.each(pairs)('%s -> %s follows the table', async (from, to) => {
    const p = createTestPorts();
    p.store.seedTicket(ticket(1, { status: from, assigneeId: null }));
    const cell = TRANSITIONS[from][to];
    const run = () =>
      moveTicket({ uow: p.uow }, 'T-1', { to, expectedStatus: from, confirmed: true });
    if (cell.kind === 'refused') {
      await expect(run()).rejects.toMatchObject({
        code: 'transition_refused',
        reason: cell.reason,
      });
    } else if (cell.kind === 'assign') {
      await expect(run()).rejects.toMatchObject({
        code: 'needs_input',
        reason: 'Pick an agent — use assign.',
      });
    } else if (cell.kind === 'request_changes') {
      await expect(run()).rejects.toMatchObject({
        code: 'needs_input',
        reason: 'A comment is required — use request changes.',
      });
    } else {
      const out = await run();
      expect(out.ticket?.status).toBe(to);
    }
    if (cell.kind === 'refused' || cell.kind === 'assign' || cell.kind === 'request_changes') {
      expect(p.publisher.events).toHaveLength(0);
      expect(p.store.data.tickets.get('T-1')?.status).toBe(from);
    }
  });
});

describe('moveTicket', () => {
  it('moves Backlog -> Ready and emits ticket.moved (AC-9, AC-22)', async () => {
    const p = createTestPorts();
    p.store.seedTicket(ticket(14));
    const out = await moveTicket({ uow: p.uow }, 'T-14', {
      to: 'ready',
      expectedStatus: 'backlog',
    });
    expect(out.ticket).toMatchObject({ status: 'ready', updatedAt: p.clock.now() });
    expect(p.publisher.events[0]?.payload.summary).toBe('Moved Backlog → Ready');
  });

  it('refuses with stale_state when the status moved on (AC-6)', async () => {
    const p = createTestPorts();
    p.store.seedTicket(ticket(14, { status: 'ready' }));
    await expect(
      moveTicket({ uow: p.uow }, 'T-14', { to: 'backlog', expectedStatus: 'backlog' }),
    ).rejects.toMatchObject({ code: 'stale_state', message: 'T-14 is now in Ready.' });
  });

  it('refuses an unknown ticket with not_found', async () => {
    const p = createTestPorts();
    await expect(
      moveTicket({ uow: p.uow }, 'T-99', { to: 'ready', expectedStatus: 'backlog' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('requires confirmation for release, reopen and in-progress mark done (AC-12)', async () => {
    const p = fixture();
    const err = await moveTicket({ uow: p.uow }, 'T-12', {
      to: 'ready',
      expectedStatus: 'in_progress',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainRefusal);
    expect(err).toMatchObject({ code: 'confirmation_required' });
    await expect(
      moveTicket({ uow: p.uow }, 'T-12', {
        to: 'done',
        expectedStatus: 'in_progress',
        confirmed: false,
      }),
    ).rejects.toMatchObject({ code: 'confirmation_required' });
    expect(p.publisher.events).toHaveLength(0);
    expect(p.store.data.tickets.get('T-12')?.status).toBe('in_progress');
  });

  it('release of T-12 ends the session, idles alpha and sets a refusal + cooldown (AC-13)', async () => {
    const p = fixture();
    const out = await moveTicket({ uow: p.uow }, 'T-12', {
      to: 'ready',
      expectedStatus: 'in_progress',
      confirmed: true,
    });
    expect(out.ticket).toMatchObject({ status: 'ready', assigneeId: null, blockedQuestion: null });
    expect(p.store.data.sessions.get('S-0412')).toMatchObject({
      status: 'completed',
      endedAt: p.clock.now(),
    });
    const entries = await p.store.data.entries.get('S-0412');
    expect(entries?.at(-1)).toMatchObject({ type: 'system', text: 'Ticket released by Operator' });
    expect(p.store.data.agents.get('alpha')).toMatchObject({
      stage: 'idle',
      currentTicketId: null,
      currentSessionId: null,
      currentTool: null,
      pausedAfterRelease: true,
    });
    expect(p.store.data.simState.get('alpha')).toMatchObject({
      pendingRefusalTicketId: 'T-12',
      cooldownSteps: 4,
    });
    expect(types(p)).toEqual(['ticket.released', 'log.appended', 'session.ended']);
    expect(p.publisher.events[0]?.payload.summary).toBe(
      'Moved In Progress → Ready · released alpha',
    );
  });

  it('reopens Done into Ready and clears the assignee (AC-14)', async () => {
    const p = createTestPorts();
    p.store.seedTicket(ticket(1, { status: 'done', assigneeId: 'alpha' }));
    const out = await moveTicket({ uow: p.uow }, 'T-1', {
      to: 'ready',
      expectedStatus: 'done',
      confirmed: true,
    });
    expect(out.ticket).toMatchObject({ status: 'ready', assigneeId: null });
    expect(types({ publisher: p.publisher } as never)).toEqual(['ticket.reopened']);
    expect(p.publisher.events[0]?.payload.summary).toBe('Moved Done → Ready');
  });

  it('mark done of a Blocked ticket clears the block and idles the holder (AC-15)', async () => {
    const p = fixture();
    const out = await moveTicket({ uow: p.uow }, 'T-12', {
      to: 'done',
      expectedStatus: 'in_progress',
      confirmed: true,
    });
    expect(out.ticket).toMatchObject({
      status: 'done',
      blockedQuestion: null,
      assigneeId: 'alpha',
    });
    expect(p.store.data.sessions.get('S-0412')?.status).toBe('completed');
    expect(p.store.data.agents.get('alpha')).toMatchObject({
      stage: 'idle',
      currentTicketId: null,
    });
    expect(p.store.data.simState.get('alpha')?.pendingRefusalTicketId).toBeNull();
    expect(types(p)).toEqual(['ticket.moved', 'session.ended', 'agent.stage_changed']);
  });

  it('mark done from Ready needs no confirmation and no agent (AC-15)', async () => {
    const p = createTestPorts();
    p.store.seedTicket(ticket(2, { status: 'ready' }));
    const out = await moveTicket({ uow: p.uow }, 'T-2', { to: 'done', expectedStatus: 'ready' });
    expect(out.ticket?.status).toBe('done');
    expect(p.publisher.events.map((e) => e.type)).toEqual(['ticket.moved']);
  });

  it('approve completes the holder session and idles the agent (AC-16)', async () => {
    const p = fixture();
    p.store.seedTicket(ticket(12, { status: 'review', assigneeId: 'alpha' }));
    const out = await moveTicket({ uow: p.uow }, 'T-12', { to: 'done', expectedStatus: 'review' });
    expect(out.ticket?.status).toBe('done');
    expect(p.store.data.sessions.get('S-0412')?.status).toBe('completed');
    expect(p.store.data.agents.get('alpha')).toMatchObject({
      stage: 'idle',
      currentTicketId: null,
    });
    expect(types(p)).toEqual(['ticket.approved', 'session.ended', 'agent.stage_changed']);
    expect(p.publisher.events[0]?.payload.summary).toBe('Approved T-12');
  });

  it('does not advance the clock', async () => {
    const p = fixture();
    const before = p.clock.now();
    await moveTicket({ uow: p.uow }, 'T-12', {
      to: 'ready',
      expectedStatus: 'in_progress',
      confirmed: true,
    });
    expect(p.clock.now()).toBe(before);
  });
});
