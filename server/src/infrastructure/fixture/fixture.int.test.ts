import { count, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { entryCostUsd } from '@agent-ops/shared';
import { freshFixture, openTestDb, truncateAll } from '../../../test/int/db.js';
import { agents, events, idCounters, simulationState } from '../db/schema.js';
import { loadFixtureIfEmpty, readFixture } from './load-fixture.js';

const handle = openTestDb();
const db = handle.db;

async function rows<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const res = await db.execute(sql.raw(query));
  return res.rows as T[];
}
async function one<T = Record<string, unknown>>(query: string): Promise<T> {
  const r = await rows<T>(query);
  return r[0] as T;
}

describe('fixture load (DB-AC-6, 8-14)', () => {
  beforeEach(() => freshFixture(db));

  it('AC-8: 6 agents with kinds and 16 tickets with the documented statuses', async () => {
    // contract: alpha/bravo/charlie are real, sim-1..3 simulated; T-1..T-16 carry the specified statuses
    const ag = await rows<{ id: string; kind: string }>('select id, kind from agents order by id');
    expect(ag).toHaveLength(6);
    expect(Object.fromEntries(ag.map((a) => [a.id, a.kind]))).toEqual({
      alpha: 'real',
      bravo: 'real',
      charlie: 'real',
      'sim-1': 'simulated',
      'sim-2': 'simulated',
      'sim-3': 'simulated',
    });

    const tk = await rows<{
      number: number;
      id: string;
      status: string;
      blocked_question: string | null;
    }>('select number, id, status, blocked_question from tickets order by number');
    expect(tk).toHaveLength(16);
    const statusOf = (n: number): string => tk.find((t) => t.number === n)?.status ?? '';
    const expected: Record<string, number[]> = {
      done: [1, 2, 3, 4, 5],
      review: [6, 7],
      in_progress: [8, 9, 12],
      ready: [10, 11, 13],
      backlog: [14, 15, 16],
    };
    for (const [status, nums] of Object.entries(expected))
      for (const n of nums) expect(statusOf(n)).toBe(status);
    expect(tk.map((t) => t.id)).toEqual(Array.from({ length: 16 }, (_, i) => `T-${i + 1}`));
    // contract: T-8 is the blocked ticket
    expect(tk.find((t) => t.number === 8)?.blocked_question).not.toBeNull();
  });

  it('AC-9: 3 prices and the session population statistics', async () => {
    // contract: 3 model prices, 121 sessions (114 historical + 7 on fixture day) with the documented mix
    expect((await one<{ n: number }>('select count(*)::int as n from model_prices')).n).toBe(3);

    const s = await one<Record<string, number>>(`
      select count(*)::int as total,
        count(*) filter (where number <= 114)::int as historical,
        count(*) filter (where number >= 401)::int as fixture_day,
        count(*) filter (where status = 'running')::int as running,
        count(*) filter (where status = 'failed')::int as failed,
        count(*) filter (where ticket_id is null)::int as no_ticket
      from sessions`);
    expect(s).toEqual({
      total: 121,
      historical: 114,
      fixture_day: 7,
      running: 4,
      failed: 9,
      no_ticket: 19,
    });

    const running = await rows<{ id: string }>(
      `select id from sessions where status = 'running' order by id`,
    );
    expect(running.map((r) => r.id)).toEqual(['S-0412', 'S-0413', 'S-0414', 'S-0415']);
    const day = await rows<{ id: string }>(
      `select id from sessions where number >= 401 order by id`,
    );
    expect(day.map((r) => r.id)).toEqual([
      'S-0401',
      'S-0409',
      'S-0410',
      'S-0412',
      'S-0413',
      'S-0414',
      'S-0415',
    ]);

    const failedTool = await one<{ n: number }>(
      `select count(distinct session_id)::int as n from session_log_entries where tool_ok = false`,
    );
    expect(failedTool.n).toBe(10);

    const longest = await one<{ n: number }>(
      `select max(c)::int as n from (select count(*) as c from session_log_entries group by session_id) x`,
    );
    expect(longest.n).toBe(23);

    const longOut = await rows<{ session_id: string }>(
      `select distinct session_id from session_log_entries
       where tool_output is not null and array_length(string_to_array(tool_output, E'\\n'), 1) > 4`,
    );
    expect(longOut.map((r) => r.session_id)).toEqual(['S-0409']);
  });

  it('AC-10: golden entry counts, token totals and cost', async () => {
    // contract: 1918 entries, 1670 with tokens; fixture-wide token sums and cost $305.19 at fixture prices
    const t = await one<Record<string, number>>(`
      select count(*)::int as entries,
        count(*) filter (where input_tokens is not null)::int as with_tokens,
        coalesce(sum(input_tokens), 0)::float8 as input,
        coalesce(sum(output_tokens), 0)::float8 as output,
        coalesce(sum(cache_read_tokens), 0)::float8 as cache_read,
        coalesce(sum(cache_write_tokens), 0)::float8 as cache_write
      from session_log_entries`);
    expect(t).toEqual({
      entries: 1918,
      with_tokens: 1670,
      input: 10_753_797,
      output: 1_844_687,
      cache_read: 179_299_980,
      cache_write: 8_523_948,
    });

    // cost via the shared cost function, summed per (session model, entry)
    const prices = await rows<{ model: string; i: string; o: string; cr: string; cw: string }>(
      `select model, input_per_m::text as i, output_per_m::text as o, cache_read_per_m::text as cr,
              cache_write_per_m::text as cw from model_prices`,
    );
    const byModel = new Map(
      prices.map((p) => [
        p.model,
        {
          inputPerM: Number(p.i),
          outputPerM: Number(p.o),
          cacheReadPerM: Number(p.cr),
          cacheWritePerM: Number(p.cw),
        },
      ]),
    );
    const perModel = await rows<{ model: string; i: number; o: number; cr: number; cw: number }>(`
      select s.model, sum(e.input_tokens)::float8 as i, sum(e.output_tokens)::float8 as o,
             sum(e.cache_read_tokens)::float8 as cr, sum(e.cache_write_tokens)::float8 as cw
      from session_log_entries e join sessions s on s.id = e.session_id
      where e.input_tokens is not null group by s.model`);
    let cost = 0;
    for (const m of perModel) {
      const price = byModel.get(m.model);
      expect(price, `price for ${m.model}`).toBeDefined();
      if (price)
        cost += entryCostUsd({ input: m.i, output: m.o, cacheRead: m.cr, cacheWrite: m.cw }, price);
    }
    expect(Math.round(cost * 100) / 100).toBe(305.19);
  });

  it('AC-11 and AC-12: 44 events seq 1-44 floor 1, clock, next ticket/session numbers', async () => {
    // contract: events keep prototype order with strictly increasing seq; clock fixed; counters 17 / 416
    const seqs = (
      await rows<{ seq: number }>('select seq::int as seq from events order by seq')
    ).map((r) => r.seq);
    expect(seqs).toEqual(Array.from({ length: 44 }, (_, i) => i + 1));

    const fx = readFixture();
    const types = (await rows<{ type: string }>('select type from events order by seq')).map(
      (r) => r.type,
    );
    expect(types).toEqual(fx.events.map((e) => e.type));

    const sim = await one<{ clock_at: string | Date; journal_floor_seq: number }>(
      'select clock_at, journal_floor_seq::int as journal_floor_seq from simulation_state',
    );
    expect(new Date(sim.clock_at).toISOString()).toBe('2026-10-24T14:32:00.000Z');
    expect(sim.journal_floor_seq).toBe(1);

    // contract: next ticket is T-17 and next session S-0416 (counter values 17 and 416)
    const counters = await rows<{ name: string; next_value: number }>(
      'select name, next_value::int as next_value from id_counters',
    );
    expect(Object.fromEntries(counters.map((c) => [c.name, c.next_value]))).toEqual({
      ticket: 17,
      session: 416,
    });
    const [row] = await db.select({ n: count() }).from(idCounters);
    expect(row?.n).toBe(2);
  });

  it('AC-14: no token/cost column on sessions; session totals equal the sum of entries (MOCK-03)', async () => {
    // contract: tokens live only on log entries; a session total is derived and equals the sum of its entries
    const cols = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'sessions'`,
    );
    expect(cols.filter((c) => /token|cost/i.test(c.column_name))).toEqual([]);

    const fx = readFixture();
    const dbTotals = await rows<{ id: string; i: number; o: number; cr: number; cw: number }>(`
      select session_id as id, coalesce(sum(input_tokens),0)::float8 as i, coalesce(sum(output_tokens),0)::float8 as o,
             coalesce(sum(cache_read_tokens),0)::float8 as cr, coalesce(sum(cache_write_tokens),0)::float8 as cw
      from session_log_entries group by session_id`);
    expect(dbTotals).toHaveLength(fx.sessions.length);
    const byId = new Map(dbTotals.map((r) => [r.id, r]));
    for (const s of fx.sessions) {
      const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      for (const e of s.entries) {
        sum.input += e.tokens?.input ?? 0;
        sum.output += e.tokens?.output ?? 0;
        sum.cacheRead += e.tokens?.cacheRead ?? 0;
        sum.cacheWrite += e.tokens?.cacheWrite ?? 0;
      }
      const r = byId.get(s.id);
      expect({ input: r?.i, output: r?.o, cacheRead: r?.cr, cacheWrite: r?.cw }, s.id).toEqual(sum);
    }
  });

  it('AC-6: loadFixtureIfEmpty loads once and is a no-op when agents exist', async () => {
    // contract: second call returns false and leaves data untouched; on an empty DB it returns true
    const before = await one<{ n: number }>('select count(*)::int as n from session_log_entries');
    expect(await loadFixtureIfEmpty(db)).toBe(false);
    const after = await one<{ n: number }>('select count(*)::int as n from session_log_entries');
    expect(after.n).toBe(before.n);
    const [a] = await db.select({ n: count() }).from(agents);
    expect(a?.n).toBe(6);

    await truncateAll(db);
    expect(await loadFixtureIfEmpty(db)).toBe(true);
    const [e] = await db.select({ n: count() }).from(events);
    expect(e?.n).toBe(44);
    const [s] = await db.select({ n: count() }).from(simulationState);
    expect(s?.n).toBe(1);
  });

  it('AC-13: two loads give identical rows except real_at, absolute seq, floor and seeded_at', async () => {
    // contract: loads are deterministic; only the listed columns may differ
    const dump = async (): Promise<unknown> => {
      const tables = [
        'model_prices',
        'tickets',
        'agents',
        'sessions',
        'agent_sim_state',
        'id_counters',
      ];
      const out: Record<string, unknown> = {};
      for (const t of tables) out[t] = await rows(`select * from ${t} order by 1`);
      out['entries'] = (
        await rows('select * from session_log_entries order by session_id, ordinal')
      ).map((r) => ({ ...r, id: undefined }));
      out['events'] = (await rows('select * from events order by seq')).map((r, i) => ({
        ...r,
        seq: i,
        real_at: undefined,
      }));
      const sim = await rows<Record<string, unknown>>('select * from simulation_state');
      out['sim'] = sim.map((r) => ({ ...r, journal_floor_seq: undefined, seeded_at: undefined }));
      return out;
    };
    const first = await dump();
    await truncateAll(db);
    await loadFixtureIfEmpty(db);
    const second = await dump();
    expect(second).toEqual(first);
  });
});
