import { count, sql } from 'drizzle-orm';
import { entryCostUsd, sumTokens, type TokenUsage } from '@agent-ops/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionState } from '../../domain/index.js';
import { freshFixture, openTestDb } from '../../../test/int/db.js';
import { makeSnapshotReader } from '../../../test/int/factories.js';
import { sessions } from '../db/schema.js';
import { createSessionRepository } from '../repositories/sessions.repository.js';

const handle = openTestDb();
const { db } = handle;
const reader = makeSnapshotReader(handle);

const ALL = { fromDay: '0001-01-01', toDay: '9999-12-31' };

const zero = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const add = (a: TokenUsage, b: TokenUsage): TokenUsage => sumTokens([a, b]);

function doneSession(
  number: number,
  ticketId: string | null,
  startedAt: string,
  model: string,
): SessionState {
  return {
    id: `S-${String(number).padStart(4, '0')}`,
    number,
    agentId: 'alpha',
    ticketId,
    model,
    startedAt,
    endedAt: startedAt,
    status: 'completed',
    entryCount: 0,
  };
}

describe('read queries against the seeded fixture (DB-AC-35/36, API-AC-24)', () => {
  beforeEach(() => freshFixture(db));

  it('lists 121 sessions whose token sums and cost equal the fixture totals (AC-10, AC-36)', async () => {
    const { data } = await reader.read(async (q) => ({
      list: await q.listSessions({
        ...ALL,
        sort: 'startedAt',
        order: 'asc',
        limit: 1000,
        offset: 0,
      }),
      prices: await q.modelPrices(),
    }));

    // contract: the whole period covers every fixture session
    expect(data.list.total).toBe(121);
    expect(data.list.rows).toHaveLength(121);

    const total = data.list.rows.reduce((acc, r) => add(acc, r.tokens), zero());
    expect(total).toEqual({
      input: 10_753_797,
      output: 1_844_687,
      cacheRead: 179_299_980,
      cacheWrite: 8_523_948,
    });

    // contract: cost is derived from the sums at the fixture prices, $305.19 to cents
    const priceOf = new Map(data.prices.map((p) => [p.model, p]));
    const cost = data.list.rows.reduce(
      (acc, r) => acc + entryCostUsd(r.tokens, priceOf.get(r.session.model)!),
      0,
    );
    expect(cost.toFixed(2)).toBe('305.19');
  });

  it('usage for `today` (UTC day of the simulation clock) covers 7 sessions, 4 running; every dimension sums to the same tokens (AC-36)', async () => {
    const { data } = await reader.read(async (q) => {
      const sim = await q.simulation();
      const day = sim.clockAt.slice(0, 10);
      return { usage: await q.usage({ fromDay: day, toDay: day }) };
    });
    const { usage } = data;

    // contract: today's sessions are selected by the UTC day of started_at on the simulation clock
    expect(usage.perSession).toHaveLength(7);
    expect(usage.perSession.filter((r) => r.session.status === 'running')).toHaveLength(4);

    const fold = (items: { tokens: TokenUsage }[]): TokenUsage =>
      items.reduce((a, i) => add(a, i.tokens), zero());
    const expected = fold(usage.perSession);
    expect(expected.input).toBeGreaterThan(0);

    // contract: by agent, by ticket (incl. "no ticket"), by day and by session all sum to the same totals
    expect(fold(usage.byAgent.flatMap((a) => a.sums))).toEqual(expected);
    expect(fold(usage.byTicket.flatMap((t) => t.sums))).toEqual(expected);
    expect(fold(usage.perDay.flatMap((d) => d.sums))).toEqual(expected);
    expect(usage.perDay).toHaveLength(1);
  });

  it('usage over the whole period equals the fixture token totals in every dimension (AC-10, AC-36)', async () => {
    const { data: usage } = await reader.read((q) => q.usage(ALL));
    const fold = (items: { tokens: TokenUsage }[]): TokenUsage =>
      items.reduce((a, i) => add(a, i.tokens), zero());
    const golden = {
      input: 10_753_797,
      output: 1_844_687,
      cacheRead: 179_299_980,
      cacheWrite: 8_523_948,
    };

    // contract: every aggregation dimension partitions the same entries
    expect(fold(usage.byAgent.flatMap((a) => a.sums))).toEqual(golden);
    expect(fold(usage.byTicket.flatMap((t) => t.sums))).toEqual(golden);
    expect(fold(usage.perDay.flatMap((d) => d.sums))).toEqual(golden);
    expect(fold(usage.perSession)).toEqual(golden);
    expect(usage.perSession).toHaveLength(121);
    // sessions without a ticket are counted under ticketId null
    expect(usage.byTicket.some((t) => t.ticketId === null)).toBe(true);
  });

  it('session log entries keep write order when timestamps are equal or go backwards (AC-35)', async () => {
    const model = (await reader.read((q) => q.modelPrices())).data[0]!.model;
    const repo = createSessionRepository(db);
    const s = doneSession(9999, null, '2026-01-01T10:00:00.000Z', model);
    await repo.insert(s);
    const base = { type: 'agent' as const, stage: null, tool: null, tokens: null, activity: null };
    const times = ['10:00:05', '10:00:05', '10:00:01', '10:00:05'];
    for (const [i, t] of times.entries()) {
      await repo.appendEntry(s.id, {
        ...base,
        index: i,
        at: `2026-01-01T${t}.000Z`,
        text: `entry ${i}`,
      });
    }

    // contract: entries come back by ordinal, not by `at`
    const viaRepo = await repo.entries(s.id);
    expect(viaRepo.map((e) => e.text)).toEqual(['entry 0', 'entry 1', 'entry 2', 'entry 3']);
    const detail = (await reader.read((q) => q.sessionDetail(s.id))).data;
    expect(detail?.entries.map((e) => e.index)).toEqual([0, 1, 2, 3]);
    expect(detail?.entries.map((e) => e.text)).toEqual([
      'entry 0',
      'entry 1',
      'entry 2',
      'entry 3',
    ]);
  });

  it('ticket sessions come newest first by started_at, ties by session number descending (API-AC-24)', async () => {
    const model = (await reader.read((q) => q.modelPrices())).data[0]!.model;
    const repo = createSessionRepository(db);
    const same = '2027-01-01T00:00:00.000Z';
    await repo.insert(doneSession(9001, 'T-1', same, model));
    await repo.insert(doneSession(9002, 'T-1', same, model));
    await repo.insert(doneSession(9003, 'T-1', '2027-02-01T00:00:00.000Z', model));

    const rows = (await reader.read((q) => q.ticketSessions('T-1'))).data;
    const ids = rows.map((r) => r.session.id);

    // contract: newest first; equal start times break by number descending
    expect(ids.slice(0, 3)).toEqual(['S-9003', 'S-9002', 'S-9001']);
    const starts = rows.map((r) => Date.parse(r.session.startedAt));
    expect(starts).toEqual([...starts].sort((a, b) => b - a));
  });

  it('fixture entry counts reported by the session list match the stored entries', async () => {
    const [{ n = 0 } = {}] = await db.select({ n: count() }).from(sessions);
    const rows = (await db.execute(sql`select count(*)::int as n from session_log_entries`)).rows;
    const { data } = await reader.read((q) =>
      q.listSessions({ ...ALL, sort: 'startedAt', order: 'asc', limit: 1000, offset: 0 }),
    );
    // contract: sum of per-session entryCount equals the total number of entries (1 918)
    expect(n).toBe(121);
    expect(data.rows.reduce((a, r) => a + r.session.entryCount, 0)).toBe(Number(rows[0]?.['n']));
    expect(Number(rows[0]?.['n'])).toBe(1918);
  });

  it('every fixture session reports token totals equal to the sum of its entries (API-AC-33)', async () => {
    const list = (
      await reader.read((q) =>
        q.listSessions({ ...ALL, sort: 'startedAt', order: 'asc', limit: 1000, offset: 0 }),
      )
    ).data;
    expect(list.rows).toHaveLength(121);
    const raw = await db.execute(sql`
      select session_id,
             sum(input_tokens)::bigint as i, sum(output_tokens)::bigint as o,
             sum(cache_read_tokens)::bigint as cr, sum(cache_write_tokens)::bigint as cw
      from session_log_entries group by session_id`);
    const expected = new Map(
      raw.rows.map((r) => [
        String(r['session_id']),
        {
          input: Number(r['i']),
          output: Number(r['o']),
          cacheRead: Number(r['cr']),
          cacheWrite: Number(r['cw']),
        },
      ]),
    );
    // contract: the list total, and the detail view, equal the per-session sum of entry tokens (zero without entries)
    for (const r of list.rows) {
      expect(r.tokens, r.session.id).toEqual(expected.get(r.session.id) ?? zero());
      const detail = (await reader.read((q) => q.sessionDetail(r.session.id))).data;
      const sum = detail!.entries.reduce((acc, e) => add(acc, e.tokens ?? zero()), zero());
      expect(sum, r.session.id).toEqual(r.tokens);
    }
  });
});
