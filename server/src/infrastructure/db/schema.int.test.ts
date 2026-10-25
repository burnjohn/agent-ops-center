import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyConstraintError } from './constraint-errors.js';
import { openTestDb, truncateAll, withTx } from '../../../test/int/db.js';

const handle = openTestDb();
type Tx = Parameters<Parameters<typeof withTx>[1]>[0];

const T0 = "'2026-01-01T10:00:00Z'";
const T1 = "'2026-01-01T11:00:00Z'";

interface PgErr {
  code: string;
  constraint?: string;
}

/** Walks the `cause` chain (drizzle wraps the driver error) to the pg DatabaseError. */
function pgError(err: unknown): PgErr {
  let cur: unknown = err;
  for (let i = 0; i < 6 && cur !== null && typeof cur === 'object'; i++) {
    const e = cur as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) {
      return {
        code: e.code,
        ...(typeof e.constraint === 'string' ? { constraint: e.constraint } : {}),
      };
    }
    cur = e.cause;
  }
  throw new Error(`no pg error in chain: ${String(err)}`);
}

/** Runs `fn` in a rolled-back tx after seeding base rows and returns the pg error it raises. */
async function violation(fn: (tx: Tx) => Promise<unknown>): Promise<PgErr> {
  let caught: unknown;
  try {
    await withTx(handle.db, async (tx) => {
      await seed(tx);
      await fn(tx);
    });
  } catch (err) {
    caught = err;
  }
  if (caught === undefined)
    throw new Error('expected the statement to be rejected, but it succeeded');
  return pgError(caught);
}

/** Runs `fn` in a rolled-back tx after seeding; the statements must be accepted. */
async function accepted(fn: (tx: Tx) => Promise<unknown>): Promise<void> {
  await withTx(handle.db, async (tx) => {
    await seed(tx);
    await fn(tx);
  });
}

const run = (tx: Tx, stmt: string) => tx.execute(sql.raw(stmt));

async function seed(tx: Tx): Promise<void> {
  await run(tx, `insert into model_prices values ('m', 1, 1, 1, 1)`);
  await run(
    tx,
    `insert into agents (id, name, kind, model, stage, last_seen_at, created_at) values
      ('alpha', 'Alpha', 'real', 'm', 'idle', ${T0}, ${T0}),
      ('bravo', 'Bravo', 'simulated', 'm', 'idle', ${T0}, ${T0})`,
  );
  await run(
    tx,
    `insert into tickets (id, number, title, priority, status, created_at, updated_at) values
      ('T-1', 1, 'one', 'high', 'backlog', ${T0}, ${T0}),
      ('T-2', 2, 'two', 'low', 'ready', ${T0}, ${T0})`,
  );
}

const ticket = (
  id: string,
  number: number,
  extra: { title?: string; status?: string; priority?: string; assignee?: string } = {},
) =>
  `insert into tickets (id, number, title, priority, status, assignee_id, created_at, updated_at) values
   ('${id}', ${number}, '${extra.title ?? 't'}', '${extra.priority ?? 'low'}', '${extra.status ?? 'backlog'}',
    ${extra.assignee === undefined ? 'null' : `'${extra.assignee}'`}, ${T0}, ${T0})`;

const session = (id: string, number: number, status: string, ended: string, agent = 'alpha') =>
  `insert into sessions (id, number, agent_id, model, status, started_at, ended_at) values
   ('${id}', ${number}, '${agent}', 'm', '${status}', ${T0}, ${ended})`;

const event = (type: string, source = 'operator', category = 'ticket', refs = '') =>
  `insert into events (at, source, category, type${refs === '' ? '' : ', ' + refs.split('=')[0]}) values
   (${T0}, '${source}', '${category}', '${type}'${refs === '' ? '' : ', ' + refs.split('=')[1]})`;

const logEntry = (cols: string, vals: string) =>
  `insert into session_log_entries (session_id, ordinal, at, ${cols}) values ('S-0001', 0, ${T0}, ${vals})`;

beforeEach(() => truncateAll(handle.db));
afterEach(() => truncateAll(handle.db));

describe('DB-AC-15 ticket id format', () => {
  it.each([
    ['leading zero T-01', ticket('T-01', 1)],
    ['wrong prefix X-3', ticket('X-3', 3)],
    ['number differs from id', ticket('T-5', 6)],
    ['number below 1', ticket('T-0', 0)],
  ])('rejects %s with tickets_id_format_ck', async (_label, stmt) => {
    // contract: a ticket id must equal 'T-' || number (n >= 1, no leading zeros)
    const err = await violation((tx) => run(tx, stmt));
    expect(err).toEqual({ code: '23514', constraint: 'tickets_id_format_ck' });
  });

  it('accepts T-12 with number 12', async () => {
    // contract: a well-formed ticket id is accepted
    await accepted((tx) => run(tx, ticket('T-12', 12)));
  });
});

describe('DB-AC-16 session id format', () => {
  it.each([
    ['S-12 (not padded)', session('S-12', 12, 'completed', T1)],
    ['number differs from id', session('S-0005', 6, 'completed', T1)],
  ])('rejects %s with sessions_id_format_ck', async (_label, stmt) => {
    // contract: session id must be 'S-' + number zero-padded to at least 4 digits
    const err = await violation((tx) => run(tx, stmt));
    expect(err).toEqual({ code: '23514', constraint: 'sessions_id_format_ck' });
  });

  it('accepts S-0416 (4-digit id)', async () => {
    // contract: a zero-padded 4-digit session id is valid
    await accepted((tx) => run(tx, session('S-0416', 416, 'completed', T1)));
  });

  it('accepts S-10000 (padding is a minimum, not a width)', async () => {
    // contract: a 5-digit session id is valid
    await accepted((tx) => run(tx, session('S-10000', 10000, 'completed', T1, 'bravo')));
  });
});

describe('DB-AC-17 one active ticket per agent', () => {
  it.each(['in_progress', 'review'])(
    'rejects a second %s ticket for the same assignee',
    async (status) => {
      // contract: an agent is the assignee of at most one ticket in in_progress/review
      const err = await violation(async (tx) => {
        await run(tx, ticket('T-3', 3, { status: 'in_progress', assignee: 'alpha' }));
        await run(tx, ticket('T-4', 4, { status, assignee: 'alpha' }));
      });
      expect(err).toEqual({ code: '23505', constraint: 'tickets_assignee_active_uq' });
      expect(
        classifyConstraintError({ cause: { code: err.code, constraint: err.constraint } }),
      ).toBe('agent_busy');
    },
  );

  it('allows several done tickets for one assignee (partial index only covers active states)', async () => {
    // contract: finished tickets do not count toward the one-active-ticket rule
    await accepted(async (tx) => {
      await run(tx, ticket('T-3', 3, { status: 'done', assignee: 'alpha' }));
      await run(tx, ticket('T-4', 4, { status: 'done', assignee: 'alpha' }));
    });
  });

  it('rejects two agents pointing at the same current ticket', async () => {
    // contract: a ticket is the current ticket of at most one agent
    const err = await violation(async (tx) => {
      await run(tx, `update agents set current_ticket_id = 'T-1' where id = 'alpha'`);
      await run(tx, `update agents set current_ticket_id = 'T-1' where id = 'bravo'`);
    });
    expect(err).toEqual({ code: '23505', constraint: 'agents_current_ticket_id_uq' });
  });

  it('lets exactly one of two concurrent assigns of the same agent commit', async () => {
    // contract: two concurrent transactions assigning one free agent -> one commits, the other is refused
    await handle.pool.query(`insert into model_prices values ('m', 1, 1, 1, 1)`);
    await handle.pool.query(
      `insert into agents (id, name, kind, model, stage, last_seen_at, created_at) values ('alpha','Alpha','real','m','idle',${T0},${T0})`,
    );
    await handle.pool.query(ticket('T-1', 1, { status: 'ready' }));
    await handle.pool.query(ticket('T-2', 2, { status: 'ready' }));
    const assign = (id: string) =>
      `update tickets set status = 'in_progress', assignee_id = 'alpha' where id = '${id}'`;

    const c1 = await handle.pool.connect();
    const c2 = await handle.pool.connect();
    try {
      await c1.query('begin');
      await c2.query('begin');
      await c1.query(assign('T-1'));
      const second = c2.query(assign('T-2')).then(
        () => ({ ok: true as const }),
        (e: unknown) => ({ ok: false as const, err: pgError(e) }),
      );
      await c1.query('commit'); // unblocks the waiting unique-index check in c2
      const outcome = await second;
      expect(outcome.ok).toBe(false);
      if (!outcome.ok)
        expect(outcome.err).toEqual({ code: '23505', constraint: 'tickets_assignee_active_uq' });
      await c2.query('rollback');
    } finally {
      c1.release();
      c2.release();
    }
    const res = await handle.pool.query(
      `select id from tickets where assignee_id = 'alpha' and status = 'in_progress'`,
    );
    expect(res.rows).toEqual([{ id: 'T-1' }]);
  });
});

describe('DB-AC-18 one running session per agent', () => {
  it('rejects a second running session for the same agent', async () => {
    // contract: at most one running session per agent
    const err = await violation(async (tx) => {
      await run(tx, session('S-0001', 1, 'running', 'null'));
      await run(tx, session('S-0002', 2, 'running', 'null'));
    });
    expect(err).toEqual({ code: '23505', constraint: 'sessions_agent_running_uq' });
    expect(classifyConstraintError({ cause: { code: err.code, constraint: err.constraint } })).toBe(
      'agent_busy',
    );
  });

  it('allows a running session for another agent and further finished sessions', async () => {
    // contract: the rule is per agent and only for running sessions
    await accepted(async (tx) => {
      await run(tx, session('S-0001', 1, 'running', 'null'));
      await run(tx, session('S-0002', 2, 'running', 'null', 'bravo'));
      await run(tx, session('S-0003', 3, 'completed', T1));
      await run(tx, session('S-0004', 4, 'failed', T1));
    });
  });
});

describe('DB-AC-19 session ended_at rules', () => {
  it.each([
    ['running with ended_at', session('S-0001', 1, 'running', T1)],
    ['completed without ended_at', session('S-0001', 1, 'completed', 'null')],
    ['failed without ended_at', session('S-0001', 1, 'failed', 'null')],
    ['ended_at before started_at', session('S-0001', 1, 'completed', "'2026-01-01T09:00:00Z'")],
  ])('rejects %s with sessions_ended_at_ck', async (_label, stmt) => {
    // contract: running <=> ended_at null; finished sessions end at or after they started
    const err = await violation((tx) => run(tx, stmt));
    expect(err).toEqual({ code: '23514', constraint: 'sessions_ended_at_ck' });
  });

  it('accepts ended_at equal to started_at', async () => {
    // contract: ended_at >= started_at (boundary is inclusive)
    await accepted((tx) => run(tx, session('S-0001', 1, 'completed', T0)));
  });
});

describe('DB-AC-20 blank ticket title', () => {
  it.each(['', '   '])('rejects title %j with tickets_title_nonblank_ck', async (title) => {
    // contract: a ticket title must contain at least one non-whitespace character
    const err = await violation((tx) => run(tx, ticket('T-3', 3, { title })));
    expect(err).toEqual({ code: '23514', constraint: 'tickets_title_nonblank_ck' });
    expect(classifyConstraintError({ cause: { code: err.code, constraint: err.constraint } })).toBe(
      'empty_title',
    );
  });
});

describe('DB-AC-20 whitespace beyond spaces', () => {
  it('rejects a tab/newline-only title', async () => {
    // contract: a whitespace-only title is rejected
    const err = await violation((tx) => run(tx, ticket('T-3', 3, { title: '\t\n' })));
    expect(err.constraint).toBe('tickets_title_nonblank_ck');
  });
});

describe('DB-AC-21 log entry token rules', () => {
  const sess = async (tx: Tx) => run(tx, session('S-0001', 1, 'completed', T1));
  const bad = (name: string, cols: string, vals: string, constraint: string) => ({
    name,
    cols,
    vals,
    constraint,
  });
  const cases = [
    bad(
      'only input tokens set',
      `kind, input_tokens, token_activity`,
      `'agent', 1, 'other'`,
      'session_log_entries_tokens_all_or_none_ck',
    ),
    bad(
      'negative token count',
      `kind, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, token_activity`,
      `'agent', -1, 0, 0, 0, 'other'`,
      'session_log_entries_tokens_nonneg_ck',
    ),
    bad(
      'tokens on an operator entry',
      `kind, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, token_activity`,
      `'operator', 1, 1, 1, 1, 'other'`,
      'session_log_entries_tokens_kind_ck',
    ),
    bad(
      'tokens on a stage entry',
      `kind, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, token_activity`,
      `'stage', 1, 1, 1, 1, 'other'`,
      'session_log_entries_tokens_kind_ck',
    ),
    bad(
      'tokens without token activity',
      `kind, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens`,
      `'agent', 1, 1, 1, 1`,
      'session_log_entries_activity_iff_tokens_ck',
    ),
    bad(
      'token activity without tokens',
      `kind, token_activity`,
      `'agent', 'other'`,
      'session_log_entries_activity_iff_tokens_ck',
    ),
  ];
  it.each(cases)('rejects $name with $constraint', async ({ cols, vals, constraint }) => {
    // contract: four token counts all-or-none, non-negative, only on agent/tool/system, iff an activity is set
    const err = await violation(async (tx) => {
      await sess(tx);
      await run(tx, logEntry(cols, vals));
    });
    expect(err).toEqual({ code: '23514', constraint });
  });

  it('accepts a full token-bearing agent entry and a token-less operator entry', async () => {
    // contract: valid combinations pass
    await accepted(async (tx) => {
      await sess(tx);
      await run(
        tx,
        logEntry(
          `kind, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, token_activity`,
          `'agent', 1, 2, 3, 4, 'reading_code'`,
        ),
      );
      await run(
        tx,
        `insert into session_log_entries (session_id, ordinal, at, kind) values ('S-0001', 1, ${T0}, 'operator')`,
      );
    });
  });
});

describe('DB-AC-22 enumerated columns', () => {
  const cases: [string, string, string][] = [
    ['ticket status', ticket('T-3', 3, { status: 'archived' }), 'tickets_status_ck'],
    ['ticket priority', ticket('T-3', 3, { priority: 'urgent' }), 'tickets_priority_ck'],
    [
      'agent kind',
      `insert into agents (id, name, kind, model, stage, last_seen_at, created_at) values ('x','X','robot','m','idle',${T0},${T0})`,
      'agents_kind_ck',
    ],
    [
      'agent stage',
      `insert into agents (id, name, kind, model, stage, last_seen_at, created_at) values ('x','X','real','m','sleeping',${T0},${T0})`,
      'agents_stage_ck',
    ],
    ['session status', session('S-0001', 1, 'paused', T1), 'sessions_status_ck'],
    [
      'event category simulation',
      event('ticket.moved', 'operator', 'simulation'),
      'events_category_ck',
    ],
    ['event source', event('ticket.moved', 'robot', 'ticket'), 'events_source_ck'],
  ];
  it.each(cases)('rejects an unknown %s', async (_label, stmt, constraint) => {
    // contract: enumerated columns accept only the Contracts §1 values
    const err = await violation((tx) => run(tx, stmt));
    expect(err.code).toBe('23514');
    // Postgres checks CHECKs by name order: an unknown session status also trips sessions_ended_at_ck first.
    expect([constraint, 'sessions_ended_at_ck']).toContain(err.constraint);
  });

  it('rejects an unknown log entry kind and token activity', async () => {
    // contract: log entry kind and token activity are closed sets
    const kind = await violation(async (tx) => {
      await run(tx, session('S-0001', 1, 'completed', T1));
      await run(tx, logEntry('kind', `'banana'`));
    });
    expect(kind.constraint).toBe('session_log_entries_kind_ck');
    const act = await violation(async (tx) => {
      await run(tx, session('S-0001', 1, 'completed', T1));
      await run(
        tx,
        logEntry(
          'kind, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, token_activity',
          `'agent',1,1,1,1,'napping'`,
        ),
      );
    });
    expect(act.constraint).toBe('session_log_entries_token_activity_ck');
  });
});

describe('DB-AC-24 foreign keys restrict deletes', () => {
  it('rejects deleting an agent, ticket, session or model price that another row references', async () => {
    // contract: referenced rows cannot be deleted (ON DELETE RESTRICT)
    const cases: [string, string][] = [
      [`delete from agents where id = 'alpha'`, 'sessions_agent_id_fk'],
      [`delete from tickets where id = 'T-1'`, 'sessions_ticket_id_fk'],
      [`delete from sessions where id = 'S-0001'`, 'session_log_entries_session_id_fk'],
      [`delete from model_prices where model = 'm'`, 'agents_model_fk'],
    ];
    for (const [stmt, constraint] of cases) {
      const err = await violation(async (tx) => {
        await run(
          tx,
          `update tickets set status='in_progress', assignee_id='alpha' where id='T-2'`,
        );
        await run(
          tx,
          `insert into sessions (id, number, agent_id, ticket_id, model, status, started_at, ended_at) values ('S-0001', 1, 'alpha', 'T-1', 'm', 'completed', ${T0}, ${T1})`,
        );
        await run(tx, logEntry('kind', `'agent'`));
        await run(tx, stmt);
      });
      expect(err).toEqual({ code: '23001', constraint });
    }
  });

  it('rejects deleting an agent that is the assignee of a ticket', async () => {
    // contract: deleting 'alpha' while a ticket references it fails
    const err = await violation(async (tx) => {
      await run(tx, `update tickets set status='ready', assignee_id='alpha' where id='T-1'`);
      await run(tx, `delete from agents where id = 'alpha'`);
    });
    expect(err).toEqual({ code: '23001', constraint: 'tickets_assignee_id_fk' });
  });
});

describe('DB-AC-25 events are append-only', () => {
  it('rejects raw UPDATE and DELETE of an event, but allows TRUNCATE', async () => {
    // contract: UPDATE/DELETE on events fail via the trigger; TRUNCATE (reset) is the exception
    await handle.pool.query(
      `insert into events (at, source, category, type) values (${T0}, 'system', 'agent', 'agent.connected')`,
    );
    const upd = await violation((tx) => run(tx, `update events set warn = true`));
    expect(upd.code).toBe('23001');
    const del = await violation((tx) => run(tx, `delete from events`));
    expect(del.code).toBe('23001');
    const still = await handle.pool.query('select count(*)::int as n from events');
    expect(still.rows[0]).toEqual({ n: 1 });

    await truncateAll(handle.db);
    const after = await handle.pool.query('select count(*)::int as n from events');
    expect(after.rows[0]).toEqual({ n: 0 });
  });
});

describe('DB-AC-31 event references and type format', () => {
  it.each([
    ['dangling agent_id', "agent_id='ghost'", 'events_agent_id_fk', '23503'],
    ['dangling ticket_id', "ticket_id='T-99'", 'events_ticket_id_fk', '23503'],
    ['dangling session_id', "session_id='S-9999'", 'events_session_id_fk', '23503'],
  ])('rejects an event with a %s', async (_label, refs, constraint, code) => {
    // contract: event references must point at existing rows
    const err = await violation((tx) => run(tx, event('ticket.moved', 'operator', 'ticket', refs)));
    expect(err).toEqual({ code, constraint });
  });

  it.each(['Ticket.Moved', 'ticket_moved', 'ticket.', '.moved', 'ticket.moved.x', '1ticket.moved'])(
    'rejects malformed type %j with events_type_format_ck',
    async (type) => {
      // contract: type is <word>.<word> in lowercase snake_case
      const err = await violation((tx) => run(tx, event(type)));
      expect(err).toEqual({ code: '23514', constraint: 'events_type_format_ck' });
    },
  );

  it('accepts one row of every SPEC-server-api §C5 event type without a migration', async () => {
    // contract: the whole event catalogue fits the schema (types, sources, categories)
    const catalogue: [string, string, string][] = [
      ['ticket.created', 'operator', 'ticket'],
      ['ticket.moved', 'operator', 'ticket'],
      ['ticket.assigned', 'operator', 'ticket'],
      ['ticket.assigned', 'agent_report', 'ticket'],
      ['ticket.released', 'operator', 'ticket'],
      ['ticket.reopened', 'operator', 'ticket'],
      ['ticket.approved', 'operator', 'ticket'],
      ['ticket.changes_requested', 'operator', 'ticket'],
      ['ticket.unblocked', 'operator', 'ticket'],
      ['ticket.updated', 'agent_report', 'ticket'],
      ['ticket.blocked', 'agent_report', 'ticket'],
      ['ticket.answer_read', 'agent_report', 'ticket'],
      ['ticket.comment_read', 'agent_report', 'ticket'],
      ['ticket.submitted', 'agent_report', 'ticket'],
      ['agent.stage_changed', 'agent_report', 'agent'],
      ['agent.refused', 'agent_report', 'agent'],
      ['agent.connected', 'agent_report', 'agent'],
      ['agent.heartbeat', 'agent_report', 'agent'],
      ['agent.health_changed', 'system', 'agent'],
      ['tool.started', 'agent_telemetry', 'tool'],
      ['tool.finished', 'agent_telemetry', 'tool'],
      ['tool.failed', 'agent_telemetry', 'tool'],
      ['session.started', 'system', 'agent'],
      ['session.ended', 'system', 'agent'],
      ['log.appended', 'system', 'agent'],
      ['simulation.stepped', 'system', 'agent'],
      ['simulation.play_changed', 'operator', 'agent'],
    ];
    await accepted(async (tx) => {
      for (const [type, source, category] of catalogue)
        await run(tx, event(type, source, category));
      const res = await run(tx, 'select count(*)::int as n from events');
      expect(res.rows[0]).toEqual({ n: catalogue.length });
    });
  });
});
