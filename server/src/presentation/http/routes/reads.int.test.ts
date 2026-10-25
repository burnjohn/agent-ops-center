import {
  AgentListResponse,
  AgentPageResponse,
  EventsPageResponse,
  ModelPricesResponse,
  OverviewResponse,
  SessionDetail,
  SessionsPageResponse,
  TicketDetailResponse,
  TicketListResponse,
  UsageResponse,
  type Event,
  type SessionSummary,
} from '@agent-ops/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../../../../test/int/app.js';
import { freshFixture, openTestDb } from '../../../../test/int/db.js';
import { readFixture } from '../../../infrastructure/fixture/load-fixture.js';

// HTTP integration tests for every GET read (server-api AC-23..AC-37, AC-67, AC-71) against the
// seeded fixture on a real Postgres. Golden values come from the fixture itself, not from the code.

const handle = openTestDb();
const fixture = readFixture();
let app: TestApp['app'];

beforeEach(async () => {
  await freshFixture(handle.db);
  ({ app } = await buildTestApp());
});

interface Res {
  status: number;
  asOf: string | undefined;
  body: unknown;
}

async function get(url: string): Promise<Res> {
  const r = (await app.inject({ method: 'GET', url })) as unknown as {
    statusCode: number;
    headers: Record<string, string | undefined>;
    body: string;
  };
  return {
    status: r.statusCode,
    asOf: r.headers['x-as-of-seq'],
    body: JSON.parse(r.body) as unknown,
  };
}

async function post(
  url: string,
  payload: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = (await app.inject({ method: 'POST', url, payload })) as unknown as {
    statusCode: number;
    body: string;
  };
  return { status: r.statusCode, body: JSON.parse(r.body) as Record<string, unknown> };
}

/** Success reads carry the snapshot's highest seq as a header (AC-71). */
function expectAsOf(res: Res): number {
  expect(res.status).toBe(200);
  expect(res.asOf).toMatch(/^\d+$/);
  return Number(res.asOf);
}

const FEED_EVENTS = fixture.events.filter((e) => e.type !== 'agent.heartbeat');

describe('GET /api/tickets and /api/tickets/:id (AC-23, AC-24)', () => {
  it('orders each status by priority then creation, Done by updatedAt newest first', async () => {
    const res = await get('/api/tickets');
    const as = expectAsOf(res);
    const tickets = TicketListResponse.parse(res.body);
    expect(tickets).toHaveLength(16);
    // contract: Ready column = T-13 (high), T-11 (medium), T-10 (low)
    expect(tickets.filter((t) => t.status === 'ready').map((t) => t.id)).toEqual([
      'T-13',
      'T-11',
      'T-10',
    ]);
    // contract: within a status, priority high -> low; equal priority keeps creation order
    const rank = { high: 0, medium: 1, low: 2 } as const;
    for (const status of ['backlog', 'ready', 'in_progress', 'review'] as const) {
      const col = tickets.filter((t) => t.status === status);
      for (let i = 1; i < col.length; i++) {
        const [a, b] = [col[i - 1]!, col[i]!];
        expect(rank[a.priority]).toBeLessThanOrEqual(rank[b.priority]);
        if (a.priority === b.priority) expect(a.createdAt <= b.createdAt).toBe(true);
      }
    }
    // contract: Done is ordered by updatedAt, newest first
    const done = tickets.filter((t) => t.status === 'done');
    expect(done.map((t) => t.updatedAt)).toEqual(
      [...done.map((t) => t.updatedAt)].sort().reverse(),
    );
    expect(done[0]?.id).toBe('T-5');
    expect(as).toBe(fixture.events.length);
  });

  it('returns the ticket, its newest-first activity (max 30) and its sessions newest first', async () => {
    const res = await get('/api/tickets/T-12');
    const as = expectAsOf(res);
    const detail = TicketDetailResponse.parse(res.body);
    expect(detail.ticket).toMatchObject({ id: 'T-12', status: 'in_progress', assigneeId: 'alpha' });
    expect(detail.dataSource).toBe('mock');
    // contract: activity is newest first and capped at 30 events of this ticket
    expect(detail.activity.length).toBeGreaterThan(0);
    expect(detail.activity.length).toBeLessThanOrEqual(30);
    expect(detail.activity.every((e) => e.ticketId === 'T-12')).toBe(true);
    const seqs = detail.activity.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    // contract: sessions that worked on the ticket, newest first (API-AC-24)
    const expected = fixture.sessions
      .filter((s) => s.ticketId === 'T-12')
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((s) => s.id);
    expect(expected.length).toBeGreaterThan(0);
    expect(detail.sessions.map((s) => s.id)).toEqual(expected);
    expect(as).toBeGreaterThan(0);
  });

  it('answers 404 for an unknown ticket and 400 for a malformed id', async () => {
    // contract: unknown id -> not_found envelope; malformed id -> validation_failed
    const missing = await get('/api/tickets/T-999');
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ error: { code: 'not_found' } });
    const bad = await get('/api/tickets/nope');
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: { code: 'validation_failed' } });
  });
});

describe('GET /api/agents and /api/agents/:id (AC-27, AC-28, AC-29)', () => {
  it('lists the six agents with health derived from the Simulation Clock (PDR-0011)', async () => {
    const res = await get('/api/agents');
    expectAsOf(res);
    const agents = AgentListResponse.parse(res.body);
    expect(agents.map((a) => a.id)).toEqual(fixture.agents.map((a) => a.id));
    const clock = Date.parse('2026-10-24T14:32:00.000Z');
    for (const a of agents) {
      // contract: online < 30 s since last seen (or tool running < 600 s), stale < 120 s, else offline
      const gap = (clock - Date.parse(a.lastSeenAt)) / 1000;
      const toolRunning =
        a.currentTool !== null && (clock - Date.parse(a.currentTool.startedAt)) / 1000 < 600;
      const expected = toolRunning || gap < 30 ? 'online' : gap < 120 ? 'stale' : 'offline';
      expect(a.health).toBe(expected);
    }
    expect(Object.fromEntries(agents.map((a) => [a.id, a.health]))).toMatchObject({
      alpha: 'online',
      'sim-2': 'stale',
      'sim-3': 'offline',
    });
    // contract: a blocked agent's Next step is unavailable and says why
    expect(agents.find((a) => a.id === 'sim-1')?.step).toEqual({
      available: false,
      reason: 'Blocked — answer above to continue',
    });
  });

  it("returns an agent's page: 10 newest sessions of the total, said-vs-did with 1 mismatch", async () => {
    const res = await get('/api/agents/alpha');
    expectAsOf(res);
    const page = AgentPageResponse.parse(res.body);
    expect(page.dataSource).toBe('mock');
    expect(page.agent.id).toBe('alpha');
    // contract: at most 10 newest sessions, sessionsTotal counts all of the agent's sessions
    expect(page.sessions).toHaveLength(10);
    expect(page.sessionsTotal).toBe(fixture.sessions.filter((s) => s.agentId === 'alpha').length);
    const starts = page.sessions.map((s) => s.startedAt);
    expect(starts).toEqual([...starts].sort().reverse());
    expect(page.sessions.every((s) => s.agentId === 'alpha')).toBe(true);
    // contract: exactly one Testing-without-commands mismatch in the fixture (AC-29)
    expect(page.saidVsDid.mismatchCount).toBe(1);
    expect(page.saidVsDid.rows.filter((r) => r.mismatch).length).toBeGreaterThanOrEqual(1);
    expect(page.saidVsDid.rows.length).toBeLessThanOrEqual(16);
    expect(page.saidVsDid.notes).toHaveLength(1);
    expect(page.saidVsDid.notes[0]?.text).toMatch(
      /^Reported Testing, but ran no commands for \d+ min/,
    );
    expect(page.tickets.map((t) => t.id)).toContain('T-12');
  });

  it('answers 404 for an unknown agent', async () => {
    // contract: unknown agent id -> not_found envelope
    const res = await get('/api/agents/nobody');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'not_found' } });
  });
});

describe('GET /api/overview (AC-26)', () => {
  it('returns 4/6 online, 1 blocked, 2 in review and 12 per-minute bars ending at the clock', async () => {
    const res = await get('/api/overview');
    const as = expectAsOf(res);
    const ov = OverviewResponse.parse(res.body);
    expect(ov).toMatchObject({
      agentsOnline: 4,
      agentsTotal: 6,
      blockedTickets: 1,
      reviewTickets: 2,
    });
    expect(ov.eventsPerMinute).toHaveLength(12);
    expect(ov.clock).toBe('2026-10-24T14:32:00.000Z');
    // contract: bars count feed events of the last 12 clock minutes, so their sum equals the feed events in
    // (clock - 12 min, clock]; heartbeats are not counted
    const clockMs = Date.parse(ov.clock);
    const inWindow = FEED_EVENTS.filter((e) => {
      const t = Date.parse(e.at);
      return t > clockMs - 12 * 60_000 && t <= clockMs;
    }).length;
    expect(ov.eventsPerMinute.reduce((a, b) => a + b, 0)).toBe(inWindow);
    // TODO: contract unclear - whether an event exactly on a minute boundary (14:32:00.000) belongs to the
    // ending bucket or the next one; the per-bucket split is therefore not asserted.
    expect(as).toBe(fixture.events.length);
  });
});

describe('GET /api/events (AC-25)', () => {
  it('serves feed events only, newest first, hiding agent.heartbeat', async () => {
    const res = await get('/api/events?limit=200');
    const as = expectAsOf(res);
    const page = EventsPageResponse.parse(res.body);
    // contract: 43 of the 44 seed events are feed events; heartbeats never appear
    expect(fixture.events).toHaveLength(44);
    expect(page.items).toHaveLength(43);
    expect(page.items.some((e) => e.type === 'agent.heartbeat')).toBe(false);
    const seqs = page.items.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    expect(page.nextBeforeSeq).toBeNull();
    expect(Math.max(...seqs)).toBeLessThanOrEqual(as);
  });

  it('pages with beforeSeq / nextBeforeSeq without overlap or gaps', async () => {
    const all = EventsPageResponse.parse((await get('/api/events?limit=200')).body).items.map(
      (e) => e.seq,
    );
    const collected: number[] = [];
    let cursor: number | null = null;
    let pages = 0;
    do {
      const url: string =
        cursor === null ? '/api/events?limit=10' : `/api/events?limit=10&beforeSeq=${cursor}`;
      const page = EventsPageResponse.parse((await get(url)).body);
      expect(page.items.length).toBeLessThanOrEqual(10);
      collected.push(...page.items.map((e) => e.seq));
      // contract: every older event comes strictly below the cursor (no overlap)
      if (cursor !== null) expect(page.items.every((e) => e.seq < cursor!)).toBe(true);
      // contract: nextBeforeSeq is set exactly when more events exist
      expect(page.nextBeforeSeq === null).toBe(collected.length === all.length);
      cursor = page.nextBeforeSeq;
      pages++;
    } while (cursor !== null && pages < 10);
    expect(collected).toEqual(all);
    // contract: the cursor beyond the oldest event yields an empty page with no cursor
    const beyond = EventsPageResponse.parse((await get('/api/events?beforeSeq=1')).body);
    expect(beyond).toEqual({ items: [], nextBeforeSeq: null });
  });

  it('filters by source, category, agentId and ticketId', async () => {
    const byAgent = EventsPageResponse.parse(
      (await get('/api/events?limit=200&agentId=alpha')).body,
    );
    expect(byAgent.items.length).toBeGreaterThan(0);
    expect(byAgent.items.every((e: Event) => e.agentId === 'alpha')).toBe(true);
    const byTicket = EventsPageResponse.parse(
      (await get('/api/events?limit=200&ticketId=T-12')).body,
    );
    expect(byTicket.items.every((e: Event) => e.ticketId === 'T-12')).toBe(true);
    const byCat = EventsPageResponse.parse((await get('/api/events?limit=200&category=tool')).body);
    expect(byCat.items.length).toBeGreaterThan(0);
    expect(byCat.items.every((e: Event) => e.category === 'tool')).toBe(true);
    const bySource = EventsPageResponse.parse(
      (await get('/api/events?limit=200&source=operator')).body,
    );
    expect(bySource.items.every((e: Event) => e.source === 'operator')).toBe(true);
  });

  it('rejects bad query params with 400', async () => {
    // contract: limit outside 1..200, non-numeric cursor or unknown params -> validation_failed
    for (const q of ['limit=0', 'limit=201', 'beforeSeq=abc', 'source=nope', 'bogus=1']) {
      const res = await get(`/api/events?${q}`);
      expect(res.status, q).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'validation_failed' } });
    }
  });
});

describe('GET /api/sessions (AC-36, AC-37) and /api/sessions/:id (AC-30, AC-31, AC-33)', () => {
  it('returns page metadata with defaults and dataSource mock', async () => {
    const res = await get('/api/sessions');
    expectAsOf(res);
    const page = SessionsPageResponse.parse(res.body);
    expect(page).toMatchObject({
      total: 121,
      limit: 12,
      offset: 0,
      sort: 'start',
      dataSource: 'mock',
    });
    expect(page.items).toHaveLength(12);
    // contract: default sort is start time, newest first
    const starts = page.items.map((s) => s.startedAt);
    expect(starts).toEqual([...starts].sort().reverse());
  });

  it('filters by period (today = 7 sessions, 4 running), agent and model', async () => {
    const today = SessionsPageResponse.parse(
      (await get('/api/sessions?period=today&limit=100')).body,
    );
    expect(today.total).toBe(7);
    expect(today.items.filter((s) => s.status === 'running')).toHaveLength(4);
    // contract: "today" is the UTC date of the Simulation Clock
    expect(today.items.every((s) => s.startedAt.startsWith('2026-10-24'))).toBe(true);

    const alpha = SessionsPageResponse.parse(
      (await get('/api/sessions?agentId=alpha&period=all&limit=100')).body,
    );
    expect(alpha.total).toBe(fixture.sessions.filter((s) => s.agentId === 'alpha').length);
    expect(alpha.items.every((s) => s.agentId === 'alpha')).toBe(true);

    const model = fixture.sessions[0]!.model;
    const byModel = SessionsPageResponse.parse(
      (await get(`/api/sessions?model=${model}&period=all&limit=100`)).body,
    );
    expect(byModel.total).toBe(fixture.sessions.filter((s) => s.model === model).length);
    expect(byModel.items.every((s) => s.model === model)).toBe(true);

    // contract: 7d / 30d windows are nested inside "all"
    const w7 = SessionsPageResponse.parse((await get('/api/sessions?period=7d')).body).total;
    const w30 = SessionsPageResponse.parse((await get('/api/sessions?period=30d')).body).total;
    expect(7).toBeLessThanOrEqual(w7);
    expect(w7).toBeLessThanOrEqual(w30);
    expect(w30).toBeLessThanOrEqual(121);
  });

  it('sorts descending by each token/cost column and pages by offset without overlap', async () => {
    for (const sort of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
      const page = SessionsPageResponse.parse(
        (await get(`/api/sessions?period=all&sort=${sort}&limit=30`)).body,
      );
      expect(page.sort).toBe(sort);
      // contract: the chosen column is descending
      const vals = page.items.map((s) => s.tokens[sort]);
      expect(vals).toEqual([...vals].sort((a, b) => b - a));
    }
    const byCost = SessionsPageResponse.parse(
      (await get('/api/sessions?period=all&sort=cost&limit=30')).body,
    );
    const costs = byCost.items.map((s) => s.costUsd);
    expect(costs).toEqual([...costs].sort((a, b) => b - a));

    const p1 = SessionsPageResponse.parse(
      (await get('/api/sessions?period=all&limit=50&offset=0')).body,
    );
    const p2 = SessionsPageResponse.parse(
      (await get('/api/sessions?period=all&limit=50&offset=50')).body,
    );
    const p3 = SessionsPageResponse.parse(
      (await get('/api/sessions?period=all&limit=50&offset=100')).body,
    );
    expect([p1.items.length, p2.items.length, p3.items.length]).toEqual([50, 50, 21]);
    const ids = [...p1.items, ...p2.items, ...p3.items].map((s) => s.id);
    expect(new Set(ids).size).toBe(121);
    expect(p3.offset).toBe(100);
  });

  it('rejects bad query params with 400', async () => {
    for (const q of ['period=1y', 'sort=nope', 'limit=0', 'limit=101', 'offset=-1', 'bogus=1']) {
      const res = await get(`/api/sessions?${q}`);
      expect(res.status, q).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'validation_failed' } });
    }
  });

  it('returns S-0409 with 19 entries in ordinal order and byte-exact tool output', async () => {
    const res = await get('/api/sessions/S-0409');
    expectAsOf(res);
    const detail = SessionDetail.parse(res.body);
    const fx = fixture.sessions.find((s) => s.id === 'S-0409')!;
    expect(detail.dataSource).toBe('mock');
    expect(detail.entries).toHaveLength(19);
    expect(detail.entryCount).toBe(19);
    // contract: entries come in chronological / ordinal order
    expect(detail.entries.map((e) => e.index)).toEqual(
      fx.entries.map((e) => e.ordinal).sort((a, b) => a - b),
    );
    // contract: tool output is returned in full, unchanged (line breaks and indentation) - AC-31
    const outputs = fx.entries.filter((e) => e.toolOutput !== null);
    expect(outputs.length).toBeGreaterThan(0);
    for (const e of outputs) {
      expect(detail.entries.find((d) => d.index === e.ordinal)?.tool?.output).toBe(e.toolOutput);
    }
    expect(outputs.some((e) => e.toolOutput!.includes('\n  '))).toBe(true);
    // contract: session tokens are the sum of the entries' tokens (AC-33); a completed session is final (AC-34)
    const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const e of detail.entries) {
      for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += e.tokens?.[k] ?? 0;
    }
    expect(detail.tokens).toEqual(sum);
    expect(detail.costIsFinal).toBe(true);
    expect(detail.topSteps.length).toBeLessThanOrEqual(5);
  });

  it('marks a running session cost as not final', async () => {
    // contract: WHILE running the cost is provisional (AC-34)
    const detail = SessionDetail.parse((await get('/api/sessions/S-0412')).body);
    expect(detail.status).toBe('running');
    expect(detail.costIsFinal).toBe(false);
  });

  it('answers 404 for an unknown session and 400 for a malformed id', async () => {
    const missing = await get('/api/sessions/S-9999');
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ error: { code: 'not_found' } });
    expect((await get('/api/sessions/zzz')).status).toBe(400);
  });
});

describe('GET /api/usage (AC-35, AC-37) and /api/model-prices', () => {
  it('matches the golden totals for period=all', async () => {
    const res = await get('/api/usage?period=all');
    expectAsOf(res);
    const usage = UsageResponse.parse(res.body);
    expect(usage.dataSource).toBe('mock');
    // contract: fixture golden cost total is $305.19 over 121 sessions, 4 running
    expect(usage.kpis.totalCostUsd).toBeCloseTo(305.19, 2);
    expect(usage.kpis.sessions).toBe(121);
    expect(usage.kpis.runningNow).toBe(4);
    expect(usage.kpis.tokens).toBe(10_753_797 + 1_844_687 + 179_299_980 + 8_523_948);

    // contract: token totals per type equal the sum over all sessions
    const items: SessionSummary[] = [];
    for (const offset of [0, 100]) {
      items.push(
        ...SessionsPageResponse.parse(
          (await get(`/api/sessions?period=all&limit=100&offset=${offset}`)).body,
        ).items,
      );
    }
    const tot = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const s of items)
      for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += s.tokens[k];
    expect(tot).toEqual({
      input: 10_753_797,
      output: 1_844_687,
      cacheRead: 179_299_980,
      cacheWrite: 8_523_948,
    });
    expect(usage.kpis.cacheReadShare).toBeCloseTo(179_299_980 / usage.kpis.tokens, 6);
    expect(usage.kpis.avgCostUsd).toBeCloseTo(usage.kpis.totalCostUsd / 121, 6);
  });

  it('returns 30 daily points ending today and breakdowns that sum to the period total', async () => {
    const usage = UsageResponse.parse((await get('/api/usage')).body);
    expect(usage.period).toBe('30d');
    expect(usage.costPerDay).toHaveLength(30);
    const dates = usage.costPerDay.map((d) => d.date);
    expect(dates).toEqual([...dates].sort());
    // contract: the last point is today (clock date) and is the only one flagged isToday
    expect(usage.costPerDay.at(-1)).toMatchObject({ date: '2026-10-24', isToday: true });
    expect(usage.costPerDay.filter((d) => d.isToday)).toHaveLength(1);
    expect(usage.peakUsd).toBeCloseTo(Math.max(...usage.costPerDay.map((d) => d.costUsd)), 6);
    for (const list of [usage.breakdowns.byAgent, usage.breakdowns.byModel]) {
      expect(list.length).toBeLessThanOrEqual(6);
      expect(list.reduce((a, b) => a + b.share, 0)).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(usage.breakdowns.byAgent.reduce((a, b) => a + b.costUsd, 0)).toBeCloseTo(
      usage.kpis.totalCostUsd,
      4,
    );
  });

  it('computes period=today over the 7 sessions of the clock date', async () => {
    const usage = UsageResponse.parse((await get('/api/usage?period=today')).body);
    expect(usage.kpis.sessions).toBe(7);
    expect(usage.kpis.runningNow).toBe(4);
    expect(usage.costPerDay.filter((d) => d.inPeriod)).toHaveLength(1);
  });

  it('rejects an unknown period with 400', async () => {
    const res = await get('/api/usage?period=1y');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'validation_failed' } });
  });

  it('lists the three model prices with dataSource mock', async () => {
    const res = await get('/api/model-prices');
    expectAsOf(res);
    const prices = ModelPricesResponse.parse(res.body);
    expect(prices.dataSource).toBe('mock');
    expect(prices.items.map((p) => p.model).sort()).toEqual(
      fixture.modelPrices.map((p) => p.model).sort(),
    );
  });
});

describe('cross-cutting read behaviour', () => {
  it('sets X-As-Of-Seq on every successful GET, equal to the journal head on a quiet system (AC-71)', async () => {
    const urls = [
      '/api/tickets',
      '/api/tickets/T-12',
      '/api/agents',
      '/api/agents/alpha',
      '/api/overview',
      '/api/events',
      '/api/sessions',
      '/api/sessions/S-0409',
      '/api/usage',
      '/api/model-prices',
    ];
    for (const url of urls) {
      const res = await get(url);
      // contract: header present and equal to the highest seq in the journal
      expect(expectAsOf(res), url).toBe(fixture.events.length);
    }
  });

  it('treats a simulation-style session like a fixture session (AC-67): assigning T-10 makes today count 8', async () => {
    const before = SessionsPageResponse.parse((await get('/api/sessions?period=today')).body).total;
    expect(before).toBe(7);
    const asBefore = expectAsOf(await get('/api/overview'));
    const assign = await post('/api/tickets/T-10/assign', {
      agentId: 'charlie',
      expectedStatus: 'ready',
    });
    expect(assign.status).toBe(200);
    // contract: the new session shows up in lists, usage and the agent page exactly like fixture sessions
    const after = SessionsPageResponse.parse((await get('/api/sessions?period=today')).body);
    expect(after.total).toBe(8);
    expect(after.items.some((s) => s.ticketId === 'T-10' && s.agentId === 'charlie')).toBe(true);
    expect(UsageResponse.parse((await get('/api/usage?period=today')).body).kpis.sessions).toBe(8);
    const ticket = TicketDetailResponse.parse((await get('/api/tickets/T-10')).body);
    expect(ticket.sessions.some((s) => s.agentId === 'charlie')).toBe(true);
    const asAfter = expectAsOf(await get('/api/overview'));
    expect(asAfter).toBeGreaterThan(asBefore);
  });

  it('keeps each read one consistent snapshot while commands commit concurrently (AC-71)', async () => {
    const creates = Array.from({ length: 6 }, (_, i) =>
      post('/api/tickets', { title: `Concurrent ${i}` }),
    );
    const reads = Array.from({ length: 12 }, async (_, i) => {
      const url = i % 2 === 0 ? '/api/tickets' : '/api/events?limit=200';
      return { url, res: await get(url) };
    });
    const [created, snapshots] = await Promise.all([Promise.all(creates), Promise.all(reads)]);
    expect(created.every((c) => c.status === 201)).toBe(true);
    const base = fixture.events.length;
    for (const { url, res } of snapshots) {
      const as = expectAsOf(res);
      if (url === '/api/tickets') {
        // contract: the body contains exactly the tickets whose creation event is <= X-As-Of-Seq
        expect(TicketListResponse.parse(res.body)).toHaveLength(16 + (as - base));
      } else {
        // contract: no event newer than the header is present
        const seqs = EventsPageResponse.parse(res.body).items.map((e) => e.seq);
        expect(Math.max(...seqs)).toBeLessThanOrEqual(as);
        expect(seqs.filter((q) => q > base)).toHaveLength(as - base);
      }
    }
    // contract: a fresh read afterwards reflects all six commits
    const final = await get('/api/tickets');
    expect(expectAsOf(final)).toBe(base + 6);
    expect(TicketListResponse.parse(final.body)).toHaveLength(22);
  });
});
