import { ErrorResponse, CommandResult } from '@agent-ops/shared';
import { asc, eq, gt, max, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { agents, events, sessions, tickets } from '../../../infrastructure/db/schema.js';
import { buildTestApp } from '../../../../test/int/app.js';
import { freshFixture, openTestDb } from '../../../../test/int/db.js';

const handle = openTestDb();
const { db } = handle;

let app: Awaited<ReturnType<typeof buildTestApp>>['app'];

beforeEach(async () => {
  await freshFixture(db);
  ({ app } = await buildTestApp());
});

type Res = { status: number; body: Partial<CommandResult> & Partial<ErrorResponse> };

async function post(url: string, body: unknown): Promise<Res> {
  const res = await app.inject({ method: 'POST', url, payload: body as object });
  return { status: res.statusCode, body: res.json() as Res['body'] };
}

async function maxSeq(): Promise<number> {
  const rows = await db.select({ m: max(events.seq) }).from(events);
  return rows[0]?.m ?? 0;
}

async function eventsAfter(seq: number) {
  return db.select().from(events).where(gt(events.seq, seq)).orderBy(asc(events.seq));
}

async function ticketRow(id: string) {
  const rows = await db.select().from(tickets).where(eq(tickets.id, id));
  return rows[0]!;
}

async function agentRow(id: string) {
  const rows = await db.select().from(agents).where(eq(agents.id, id));
  return rows[0]!;
}

/** contract (API-AC-2): every non-2xx body parses as the shared ErrorResponse. */
function expectError(res: { status: number; body: unknown }, status: number, code: string) {
  expect(ErrorResponse.safeParse(res.body).success).toBe(true);
  expect(res.status).toBe(status);
  expect((res.body as ErrorResponse).error.code).toBe(code);
  return (res.body as ErrorResponse).error;
}

describe('POST /api/tickets (create)', () => {
  it('creates T-17 in Backlog with defaults and one ticket.created event (AC-7, AC-4, AC-22)', async () => {
    const before = await maxSeq();
    const res = await post('/api/tickets', {
      title: '  New ticket  ',
      acceptanceCriteria: ['  first ', '', 'second'],
    });
    // contract: 201 CommandResult with the next id, Backlog, medium priority, trimmed title
    expect(res.status).toBe(201);
    expect(CommandResult.safeParse(res.body).success).toBe(true);
    expect(res.body.ticket).toMatchObject({
      id: 'T-17',
      status: 'backlog',
      priority: 'medium',
      title: 'New ticket',
    });
    expect(res.body.ticket?.acceptanceCriteria).toEqual(['first', 'second']);

    // contract: events written in the same commit; returned seq is the last one
    const written = await eventsAfter(before);
    expect(written.map((e) => e.type)).toEqual(['ticket.created']);
    expect(res.body.seq).toBe(written[written.length - 1]?.seq);
    expect((await ticketRow('T-17')).status).toBe('backlog');

    // contract: ids are monotonic - the next create gets T-18
    const second = await post('/api/tickets', { title: 'Another', priority: 'high' });
    expect(second.body.ticket).toMatchObject({ id: 'T-18', priority: 'high' });
  });

  it('rejects an empty or whitespace title with details and writes nothing (AC-1, AC-8)', async () => {
    const before = await maxSeq();
    const res = await post('/api/tickets', { title: '   ' });
    // contract: 400 validation_failed with a title detail "Title is required."
    const err = expectError(res, 400, 'validation_failed');
    expect(err.details).toContainEqual({ path: 'title', message: 'Title is required.' });
    expect(await maxSeq()).toBe(before);
    expect(await db.select().from(tickets)).toHaveLength(16);
  });

  it('rejects unknown fields and bad types, one detail per invalid field (AC-1)', async () => {
    const before = await maxSeq();
    const res = await post('/api/tickets', { title: 'ok', bogus: 1, priority: 'urgent' });
    // contract: strict schema - unknown field and invalid enum each get their own detail
    const err = expectError(res, 400, 'validation_failed');
    expect(err.details?.map((d) => d.path).sort()).toEqual(['bogus', 'priority']);
    expect(await maxSeq()).toBe(before);
  });

  it('rejects a body over 64 KB without writing (payload limit)', async () => {
    const before = await maxSeq();
    const res = await post('/api/tickets', { title: 'x', description: 'a'.repeat(70_000) });
    // contract: oversized body is refused with an error envelope; no state change
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(ErrorResponse.safeParse(res.body).success).toBe(true);
    expect(await maxSeq()).toBe(before);
  });
});

describe('path / state errors', () => {
  it('answers 404 not_found naming the id for every command (AC-3)', async () => {
    const before = await maxSeq();
    const bodies: [string, unknown][] = [
      ['move', { to: 'ready', expectedStatus: 'backlog' }],
      ['assign', { agentId: 'charlie', expectedStatus: 'ready' }],
      ['request-changes', { comment: 'x' }],
      ['answer', { answer: 'x' }],
    ];
    for (const [cmd, body] of bodies) {
      const res = await post(`/api/tickets/T-999/${cmd}`, body);
      // contract: unknown ticket id -> 404 not_found with a message naming it
      const err = expectError(res, 404, 'not_found');
      expect(err.message).toContain('T-999');
    }
    const unknownAgent = await post('/api/tickets/T-10/assign', {
      agentId: 'nobody',
      expectedStatus: 'ready',
    });
    expect(expectError(unknownAgent, 404, 'not_found').message).toContain('nobody');
    expect(await maxSeq()).toBe(before);
  });

  it('answers 400 for a malformed ticket id', async () => {
    // contract: path params are validated by the shared schema
    const res = await post('/api/tickets/not-an-id/move', {
      to: 'ready',
      expectedStatus: 'backlog',
    });
    expectError(res, 400, 'validation_failed');
  });

  it('refuses a stale expectedStatus with "T-x is now in <Label>." (AC-6)', async () => {
    const before = await maxSeq();
    const res = await post('/api/tickets/T-10/move', { to: 'backlog', expectedStatus: 'backlog' });
    // contract: T-10 is Ready, the client believed Backlog
    const err = expectError(res, 409, 'stale_state');
    expect(err.message).toBe('T-10 is now in Ready.');
    expect((await ticketRow('T-10')).status).toBe('ready');
    expect(await maxSeq()).toBe(before);

    const assign = await post('/api/tickets/T-10/assign', {
      agentId: 'charlie',
      expectedStatus: 'backlog',
    });
    expect(expectError(assign, 409, 'stale_state').message).toBe('T-10 is now in Ready.');
  });
});

/** One representative fixture ticket per status. */
const SOURCE: Record<string, string> = {
  backlog: 'T-14',
  ready: 'T-10',
  in_progress: 'T-12',
  review: 'T-7',
  done: 'T-1',
};

type Cell =
  | { ok: true; confirm: boolean }
  | { ok: false; code: 'needs_input' | 'transition_refused'; reason: string };

const ALREADY = { ok: false, code: 'transition_refused', reason: 'Already here' } as const;
const NOT_STARTED = {
  ok: false,
  code: 'transition_refused',
  reason: 'Nobody worked on it yet — move it to In Progress first',
} as const;
const PENDING = {
  ok: false,
  code: 'transition_refused',
  reason: 'Approve it or request changes',
} as const;
const ASSIGN = { ok: false, code: 'needs_input', reason: 'Pick an agent — use assign.' } as const;

// Transcribed from the spec's Contracts §C4 table (not derived from the code under test).
const TABLE: [string, string, Cell][] = [
  ['backlog', 'backlog', ALREADY],
  ['backlog', 'ready', { ok: true, confirm: false }],
  ['backlog', 'in_progress', ASSIGN],
  ['backlog', 'review', NOT_STARTED],
  ['backlog', 'done', { ok: true, confirm: false }],
  ['ready', 'backlog', { ok: true, confirm: false }],
  ['ready', 'ready', ALREADY],
  ['ready', 'in_progress', ASSIGN],
  ['ready', 'review', NOT_STARTED],
  ['ready', 'done', { ok: true, confirm: false }],
  [
    'in_progress',
    'backlog',
    { ok: false, code: 'transition_refused', reason: 'Release it to Ready first' },
  ],
  ['in_progress', 'ready', { ok: true, confirm: true }],
  ['in_progress', 'in_progress', ALREADY],
  [
    'in_progress',
    'review',
    { ok: false, code: 'transition_refused', reason: 'Only the agent submits work for review' },
  ],
  ['in_progress', 'done', { ok: true, confirm: true }],
  ['review', 'backlog', PENDING],
  ['review', 'ready', PENDING],
  [
    'review',
    'in_progress',
    { ok: false, code: 'needs_input', reason: 'A comment is required — use request changes.' },
  ],
  ['review', 'review', ALREADY],
  ['review', 'done', { ok: true, confirm: false }],
  ['done', 'backlog', { ok: true, confirm: true }],
  ['done', 'ready', { ok: true, confirm: true }],
  ['done', 'in_progress', ASSIGN],
  [
    'done',
    'review',
    {
      ok: false,
      code: 'transition_refused',
      reason: 'Reopen it first — only an agent submits for review',
    },
  ],
  ['done', 'done', ALREADY],
];

describe('POST /api/tickets/:id/move - transition table (AC-5, AC-10, AC-11, AC-12)', () => {
  it('covers all 25 pairs of the table', () => {
    // contract: 5 x 5 statuses, each pair exactly once
    expect(new Set(TABLE.map(([f, t]) => `${f}>${t}`)).size).toBe(25);
  });

  it.each(TABLE)('%s -> %s', async (from, to, cell) => {
    const id = SOURCE[from]!;
    const before = await maxSeq();
    const res = await post(`/api/tickets/${id}/move`, { to, expectedStatus: from });

    if (!cell.ok) {
      // contract: refused cell -> 409 with the table's reason, nothing changes
      const err = expectError(res, 409, cell.code);
      expect(err.reason ?? err.message).toBe(cell.reason);
      expect((await ticketRow(id)).status).toBe(from);
      expect(await maxSeq()).toBe(before);
      return;
    }
    if (cell.confirm) {
      // contract: destructive moves need confirmed: true, else nothing changes
      expectError(res, 409, 'confirmation_required');
      expect((await ticketRow(id)).status).toBe(from);
      expect(await maxSeq()).toBe(before);
      const confirmed = await post(`/api/tickets/${id}/move`, {
        to,
        expectedStatus: from,
        confirmed: true,
      });
      expect(confirmed.status).toBe(200);
      expect((await ticketRow(id)).status).toBe(to);
      return;
    }
    expect(res.status).toBe(200);
    expect(CommandResult.safeParse(res.body).success).toBe(true);
    expect((await ticketRow(id)).status).toBe(to);
    expect((await eventsAfter(before)).length).toBeGreaterThan(0);
  });
});

describe('move side effects', () => {
  it('Ready <-> Backlog emits one ticket.moved with from/to and bumps updatedAt (AC-9, AC-22)', async () => {
    const t0 = (await ticketRow('T-10')).updatedAt;
    const before = await maxSeq();
    const res = await post('/api/tickets/T-10/move', { to: 'backlog', expectedStatus: 'ready' });
    expect(res.status).toBe(200);
    const written = await eventsAfter(before);
    // contract: exactly one ticket.moved carrying from and to
    expect(written.map((e) => e.type)).toEqual(['ticket.moved']);
    expect(written[0]?.payload).toMatchObject({ from: 'ready', to: 'backlog' });
    expect(res.body.seq).toBe(written[0]?.seq);
    // contract: updatedAt is set to the (simulated) now; it must not move backwards
    expect((await ticketRow('T-10')).updatedAt.getTime()).toBeGreaterThanOrEqual(t0.getTime());
  });

  it('release frees the agent, ends its session and emits ticket.released (AC-13)', async () => {
    const before = await maxSeq();
    const res = await post('/api/tickets/T-12/move', {
      to: 'ready',
      expectedStatus: 'in_progress',
      confirmed: true,
    });
    expect(res.status).toBe(200);
    // contract: ticket Ready, no assignee, no Blocked question
    const t = await ticketRow('T-12');
    expect(t).toMatchObject({ status: 'ready', assigneeId: null, blockedQuestion: null });
    // contract: agent idle with no ticket; its session ended completed
    const a = await agentRow('alpha');
    expect(a).toMatchObject({ stage: 'idle', currentTicketId: null, currentToolName: null });
    const open = await db.select().from(sessions).where(eq(sessions.agentId, 'alpha'));
    expect(open.filter((s) => s.status === 'running')).toHaveLength(0);
    expect(res.body.agent).toMatchObject({ id: 'alpha' });
    const written = await eventsAfter(before);
    const released = written.find((e) => e.type === 'ticket.released');
    expect(released?.payload).toMatchObject({
      summary: 'Moved In Progress → Ready · released alpha',
    });
    expect(written.map((e) => e.seq)).toEqual([...written.map((e) => e.seq)].sort((x, y) => x - y));
  });

  it('reopen Done -> Backlog clears the assignee and emits ticket.reopened (AC-14)', async () => {
    const before = await maxSeq();
    const res = await post('/api/tickets/T-1/move', {
      to: 'backlog',
      expectedStatus: 'done',
      confirmed: true,
    });
    expect(res.status).toBe(200);
    expect(await ticketRow('T-1')).toMatchObject({ status: 'backlog', assigneeId: null });
    const written = await eventsAfter(before);
    expect(written.find((e) => e.type === 'ticket.reopened')?.payload).toMatchObject({
      summary: 'Moved Done → Backlog',
    });
  });

  it('mark done from a Blocked In Progress ticket clears the question and frees the agent (AC-15)', async () => {
    const before = await maxSeq();
    const res = await post('/api/tickets/T-8/move', {
      to: 'done',
      expectedStatus: 'in_progress',
      confirmed: true,
    });
    expect(res.status).toBe(200);
    expect(await ticketRow('T-8')).toMatchObject({ status: 'done', blockedQuestion: null });
    expect(await agentRow('sim-1')).toMatchObject({ stage: 'idle', currentTicketId: null });
    const written = await eventsAfter(before);
    // contract: ticket.moved plus agent.stage_changed to idle
    expect(written.map((e) => e.type)).toEqual(
      expect.arrayContaining(['ticket.moved', 'agent.stage_changed']),
    );
    expect(written.find((e) => e.type === 'agent.stage_changed')?.payload).toMatchObject({
      to: 'idle',
    });
    expect(written.find((e) => e.type === 'ticket.moved')?.payload).toMatchObject({
      summary: 'Moved In Progress → Done',
    });
  });

  it('approve frees the holder and emits ticket.approved + agent.stage_changed (AC-16)', async () => {
    const before = await maxSeq();
    const res = await post('/api/tickets/T-7/move', { to: 'done', expectedStatus: 'review' });
    expect(res.status).toBe(200);
    expect(await ticketRow('T-7')).toMatchObject({ status: 'done' });
    expect(await agentRow('sim-2')).toMatchObject({ stage: 'idle', currentTicketId: null });
    const written = await eventsAfter(before);
    expect(written.find((e) => e.type === 'ticket.approved')?.payload).toMatchObject({
      summary: 'Approved T-7',
    });
    expect(written.find((e) => e.type === 'agent.stage_changed')?.payload).toMatchObject({
      to: 'idle',
    });
    const still = await db.select().from(sessions).where(eq(sessions.ticketId, 'T-7'));
    expect(still.filter((s) => s.status === 'running')).toHaveLength(0);
  });
});

describe('POST /api/tickets/:id/assign', () => {
  it('assigns Ready T-10 to idle charlie: one operator ticket.assigned, no claim (AC-19, AC-4)', async () => {
    const before = await maxSeq();
    const res = await post('/api/tickets/T-10/assign', {
      agentId: 'charlie',
      expectedStatus: 'ready',
    });
    expect(res.status).toBe(200);
    expect(CommandResult.safeParse(res.body).success).toBe(true);
    expect(res.body.ticket).toMatchObject({
      id: 'T-10',
      status: 'in_progress',
      assigneeId: 'charlie',
    });
    expect(res.body.session).toMatchObject({ status: 'running' });

    expect(await ticketRow('T-10')).toMatchObject({ status: 'in_progress', assigneeId: 'charlie' });
    expect(await agentRow('charlie')).toMatchObject({ stage: 'planning', currentTicketId: 'T-10' });
    // contract: exactly one running session for charlie, on T-10 (the old ticket-less one is completed)
    const running = (
      await db.select().from(sessions).where(eq(sessions.agentId, 'charlie'))
    ).filter((s) => s.status === 'running');
    expect(running.map((s) => s.ticketId)).toEqual(['T-10']);

    const written = await eventsAfter(before);
    const assigned = written.filter((e) => e.type === 'ticket.assigned');
    // contract: sole ticket.assigned, source operator, claim=false; never an agent_report claim
    expect(assigned).toHaveLength(1);
    expect(assigned[0]).toMatchObject({ source: 'operator' });
    expect(assigned[0]?.payload).toMatchObject({
      claim: false,
      summary: 'Moved Ready → In Progress · assigned to charlie',
    });
    // contract: no agent claim event accompanies an operator assign
    expect(
      written.filter((e) => e.type === 'ticket.assigned' && e.source === 'agent_report'),
    ).toHaveLength(0);
    expect(written.map((e) => e.type)).toEqual(
      expect.arrayContaining(['agent.stage_changed', 'session.started']),
    );
    expect(res.body.seq).toBe(written[written.length - 1]?.seq);
  });

  it('refuses a busy agent with agent_busy and the AC-20 reason (AC-20)', async () => {
    const before = await maxSeq();
    const res = await post('/api/tickets/T-10/assign', {
      agentId: 'alpha',
      expectedStatus: 'ready',
    });
    const err = expectError(res, 409, 'agent_busy');
    expect(err.message).toBe('alpha is busy with T-12 — one ticket per agent.');
    expect(await ticketRow('T-10')).toMatchObject({ status: 'ready', assigneeId: null });
    expect(await maxSeq()).toBe(before);
  });

  it('refuses to assign a Review ticket as transition_refused (AC-5)', async () => {
    const res = await post('/api/tickets/T-7/assign', {
      agentId: 'charlie',
      expectedStatus: 'review',
    });
    // TODO: contract unclear - the §C4 reason for assigning a Review ticket is not specified
    // (the cell is request_changes, so assign-ticket.ts answers the generic "Assign refused." with no reason).
    expectError(res, 409, 'transition_refused');
  });

  it('two concurrent assigns of one agent: one 200, one 409 agent_busy (AC-72, AC-4)', async () => {
    const before = await maxSeq();
    const [a, b] = await Promise.all([
      post('/api/tickets/T-10/assign', { agentId: 'charlie', expectedStatus: 'ready' }),
      post('/api/tickets/T-11/assign', { agentId: 'charlie', expectedStatus: 'ready' }),
    ]);
    // contract: commands are serialised - exactly one wins, the loser sees agent_busy
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expectError(loser, 409, 'agent_busy');
    const assignedEvents = (await eventsAfter(before)).filter((e) => e.type === 'ticket.assigned');
    expect(assignedEvents).toHaveLength(1);
    const rows = await db.select().from(tickets).where(eq(tickets.assigneeId, 'charlie'));
    expect(rows).toHaveLength(1);
  });

  it('a rejected database constraint rolls back and maps to a generic 500 without events (AC-72, AC-4)', async () => {
    const before = await maxSeq();
    // Force an unexpected DB failure inside the command transaction (test-only trigger, dropped below).
    await db.execute(
      sql.raw(`
      create or replace function t38_fail() returns trigger language plpgsql as
      $$ begin raise exception 'boom secret-internal-detail'; end $$;
      create trigger t38_fail_trg before update on tickets for each row execute function t38_fail();`),
    );
    try {
      const res = await post('/api/tickets/T-10/move', { to: 'backlog', expectedStatus: 'ready' });
      // contract: 500 internal, generic message, no SQL or internals leaked
      const err = expectError(res, 500, 'internal');
      expect(JSON.stringify(res.body)).not.toContain('secret-internal-detail');
      expect(err.message).toBe('Internal server error');
    } finally {
      await db.execute(
        sql.raw(
          'drop trigger if exists t38_fail_trg on tickets; drop function if exists t38_fail();',
        ),
      );
    }
    // contract: neither state change nor event survives
    expect((await ticketRow('T-10')).status).toBe('ready');
    expect(await maxSeq()).toBe(before);
  });
});

describe('POST /api/tickets/:id/request-changes', () => {
  it('moves Review -> In Progress for the same agent with a new running session (AC-17)', async () => {
    const before = await maxSeq();
    const res = await post('/api/tickets/T-7/request-changes', {
      comment: '  Please add tests  ',
      expectedStatus: 'review',
    });
    expect(res.status).toBe(200);
    expect(await ticketRow('T-7')).toMatchObject({
      status: 'in_progress',
      assigneeId: 'sim-2',
      reviewComment: 'Please add tests',
    });
    const running = (await db.select().from(sessions).where(eq(sessions.agentId, 'sim-2'))).filter(
      (s) => s.status === 'running',
    );
    expect(running.map((s) => s.ticketId)).toEqual(['T-7']);
    const written = await eventsAfter(before);
    expect(written.find((e) => e.type === 'ticket.changes_requested')?.payload).toMatchObject({
      summary: 'Requested changes · “Please add tests”',
    });
    expect(written.map((e) => e.type)).toContain('session.started');
  });

  it('rejects an empty comment with the comment detail (AC-18)', async () => {
    const before = await maxSeq();
    const res = await post('/api/tickets/T-7/request-changes', { comment: '   ' });
    const err = expectError(res, 400, 'validation_failed');
    expect(err.details).toContainEqual({
      path: 'comment',
      message: 'A comment is required — tell the agent what to change.',
    });
    expect(await maxSeq()).toBe(before);
  });
});

describe('POST /api/tickets/:id/answer', () => {
  it('unblocks T-8, stores the answer and emits ticket.unblocked (AC-21)', async () => {
    const before = await maxSeq();
    const res = await post('/api/tickets/T-8/answer', { answer: ' Use high and low ' });
    expect(res.status).toBe(200);
    expect(await ticketRow('T-8')).toMatchObject({
      blockedQuestion: null,
      answer: 'Use high and low',
    });
    const written = await eventsAfter(before);
    expect(written.map((e) => e.type)).toContain('ticket.unblocked');
    expect(written.find((e) => e.type === 'ticket.unblocked')?.payload).toMatchObject({
      summary: 'Answered sim-1 · “Use high and low”',
    });
  });

  it('refuses a ticket that is not Blocked, and an empty answer (AC-21)', async () => {
    const before = await maxSeq();
    expectError(await post('/api/tickets/T-12/answer', { answer: 'hi' }), 409, 'not_blocked');
    const empty = expectError(
      await post('/api/tickets/T-8/answer', { answer: '  ' }),
      400,
      'validation_failed',
    );
    expect(empty.details).toContainEqual({
      path: 'answer',
      message: 'Write an answer before unblocking.',
    });
    expect(await maxSeq()).toBe(before);
  });
});
