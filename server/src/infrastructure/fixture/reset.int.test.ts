import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshFixture, openTestDb, testDatabaseUrl } from '../../../test/int/db.js';
import { acquireServerLock, type ServerLock } from '../db/server-lock.js';
import { events } from '../db/schema.js';
import { readFixture } from './load-fixture.js';
import { resetToFixture, ServerRunningError, SERVER_RUNNING_MESSAGE } from './reset.js';

const handle = openTestDb();
const db = handle.db;
const url = testDatabaseUrl();

async function one<T = Record<string, unknown>>(query: string): Promise<T> {
  const res = await db.execute(sql.raw(query));
  return res.rows[0] as T;
}

async function snapshot(): Promise<Record<string, unknown>> {
  return one(`select
    (select count(*)::int from events) as events,
    (select max(seq)::int from events) as max_seq,
    (select count(*)::int from sessions) as sessions,
    (select count(*)::int from session_log_entries) as entries,
    (select count(*)::int from tickets) as tickets,
    (select journal_floor_seq::int from simulation_state) as floor`);
}

/** Simulates a command having run: one extra journal event beyond the fixture. */
async function runCommand(): Promise<void> {
  const e = readFixture().events[0];
  if (!e) throw new Error('fixture has no events');
  await db.insert(events).values({
    at: new Date('2026-10-24T14:40:00Z'),
    source: e.source,
    category: e.category,
    type: e.type,
    agentId: e.agentId,
    ticketId: e.ticketId,
    sessionId: e.sessionId,
    payload: e.payload,
    warn: e.warn,
  });
}

describe('reset to fixture (DB-AC-39, 40, 42)', () => {
  let lock: ServerLock | null = null;

  beforeEach(() => freshFixture(db));
  afterEach(async () => {
    await lock?.release();
    lock = null;
  });

  it('AC-39/AC-42: restores the golden dataset, seq rises past every old value, floor = first new seq', async () => {
    // contract: reset replaces everything, seq never reused, floor equals the first fixture seq
    await runCommand();
    await runCommand();
    const old = await snapshot();
    expect(old['events']).toBe(46);

    const floor = await resetToFixture(db, url);

    const snap = await snapshot();
    expect(snap).toMatchObject({ events: 44, sessions: 121, entries: 1918, tickets: 16 });
    const range = await one<{ min_seq: number; max_seq: number }>(
      'select min(seq)::int as min_seq, max(seq)::int as max_seq from events',
    );
    expect(range.min_seq).toBeGreaterThan(old['max_seq'] as number);
    expect(range.max_seq - range.min_seq).toBe(43);
    expect(floor).toBe(range.min_seq);
    expect(snap['floor']).toBe(range.min_seq);

    // contract: golden totals hold again after reset (AC-10)
    const tok = await one<Record<string, number>>(
      `select sum(input_tokens)::float8 as i, sum(cache_write_tokens)::float8 as cw from session_log_entries`,
    );
    expect(tok).toEqual({ i: 10_753_797, cw: 8_523_948 });
    const counters = await one<{ t: number; s: number }>(
      `select (select next_value::int from id_counters where name='ticket') as t,
              (select next_value::int from id_counters where name='session') as s`,
    );
    expect(counters).toEqual({ t: 17, s: 416 });

    // contract (AC-42): a client resuming from a pre-reset seq is detectable from the stored floor alone
    expect(old['max_seq'] as number).toBeLessThan(snap['floor'] as number);
    expect(1).toBeLessThan(snap['floor'] as number);
  });

  it('AC-40: refused with "Stop the server first" while a server holds the lock; data unchanged', async () => {
    // contract: a running server (session lock holder) blocks reset and nothing changes
    await runCommand();
    const before = await snapshot();
    lock = await acquireServerLock(url);
    expect(lock).not.toBeNull();

    const attempt = resetToFixture(db, url);
    await expect(attempt).rejects.toBeInstanceOf(ServerRunningError);
    await expect(resetToFixture(db, url)).rejects.toThrow(SERVER_RUNNING_MESSAGE);
    expect(SERVER_RUNNING_MESSAGE).toBe('Stop the server first');
    expect(await snapshot()).toEqual(before);

    // contract: after the server stops, reset proceeds
    await lock?.release();
    lock = null;
    await expect(resetToFixture(db, url)).resolves.toBeGreaterThan(before['max_seq'] as number);
  });

  it('AC-40: a failure part-way through rolls everything back', async () => {
    // contract: forced mid-reset failure (FK violation after truncate) leaves the database unchanged
    await runCommand();
    const before = await snapshot();
    const broken = structuredClone(readFixture());
    const s = broken.sessions[0];
    if (!s) throw new Error('fixture has no sessions');
    (s as { agentId: string }).agentId = 'ghost-agent';

    await expect(resetToFixture(db, url, broken)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);

    // contract: seq issuance stays usable and a good reset still works afterwards
    await expect(resetToFixture(db, url)).resolves.toBeGreaterThan(before['max_seq'] as number);
  });
});
