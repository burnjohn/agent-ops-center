import {
  AGENT_SESSIONS_MAX,
  AS_OF_SEQ_HEADER,
  AgentListResponse,
  AgentPageResponse,
  ErrorResponse,
  EventsPageResponse,
  EventsQuery,
  ModelPricesResponse,
  OverviewResponse,
  SessionDetail,
  SessionsPageResponse,
  SessionsQuery,
  SimulationState,
  TICKET_ACTIVITY_MAX,
  TicketDetailResponse,
  TicketListResponse,
  UsageQuery,
  UsageResponse,
  USAGE_DAYS,
  entryCostUsd,
  isFeedEvent,
  sumTokens,
  type ErrorCode,
  type Event,
  type ModelPrice,
  type Period,
  type SessionSummary,
  type Ticket,
  type TokenUsage,
} from '@agent-ops/shared';
import type { z } from 'zod';
import {
  SEED_CLOCK,
  buildOverview,
  buildSimulation,
  seedAgents,
  seedEvents,
  seedModelPrices,
  seedSessionDetail,
  seedSessionSummaries,
  seedTickets,
} from './fixtures';

export type HttpMethod = 'GET' | 'POST';

export interface RecordedRequest {
  method: HttpMethod;
  /** Path below `/api`, without the query string. */
  path: string;
  query: URLSearchParams;
  /** Parsed JSON body, undefined when none was sent. */
  body: unknown;
}

export interface FakeResponse {
  status: number;
  body: unknown;
  asOfSeq?: number | undefined;
}

type Responder = (req: RecordedRequest) => FakeResponse | Promise<FakeResponse>;

interface Route {
  method: HttpMethod;
  match: string | RegExp;
  respond: Responder;
}

export interface JsonOptions {
  status?: number;
  /** Sent as `X-As-Of-Seq`. Defaults to the seed journal head for GETs. */
  asOfSeq?: number | undefined;
}

/** Validates `body` with the shared schema before it can reach the app, so fakes cannot drift from the contract. */
export function jsonResponse<S extends z.ZodType>(
  schema: S,
  body: z.input<S>,
  opts: JsonOptions = {},
): FakeResponse {
  return { status: opts.status ?? 200, body: schema.parse(body), asOfSeq: opts.asOfSeq };
}

export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  extra: { reason?: string; details?: { path: string; message: string }[] } = {},
): FakeResponse {
  return { status, body: ErrorResponse.parse({ error: { code, message, ...extra } }) };
}

const installed = new Set<FakeNetwork>();

/** Restores `fetch` from every network installed by the current test (called from `setup.ts`). */
export function uninstallAllNetworks(): void {
  for (const n of [...installed]) n.uninstall();
}

const lastSeg = (path: string) => decodeURIComponent(path.split('/').at(-1) ?? '');

/**
 * Stubs `globalThis.fetch`. Routes are matched by method + path (string = exact, RegExp = test); the
 * newest registration wins; an unmatched request rejects loudly. Default GET routes serve the seed state
 * (`tickets`, `agents`, `agent page`, `simulation`, `events`, `sessions`, `session detail`, `ticket detail`,
 * `overview`, `model-prices`, `usage`) with `X-As-Of-Seq` = the journal head. The list routes filter, sort and
 * page like the server (`server/src/application/queries/*`), parsing the query with the shared schemas.
 */
export class FakeNetwork {
  readonly requests: RecordedRequest[] = [];
  /** The journal the default `/events` and `/tickets/:id` routes serve; swap it with `setEvents`. */
  private journal: readonly Event[] = seedEvents();
  private routes: Route[] = [];
  private original: typeof fetch | undefined;

  install(): this {
    installed.add(this);
    this.original = globalThis.fetch;
    globalThis.fetch = this.fetch;
    return this;
  }

  uninstall(): void {
    installed.delete(this);
    if (this.original) globalThis.fetch = this.original;
    else Reflect.deleteProperty(globalThis, 'fetch');
    this.original = undefined;
    this.routes = [];
    this.requests.length = 0;
  }

  /** Replaces the journal behind the default `/events` and `/tickets/:id` routes (oldest first, seq ascending). */
  setEvents(events: readonly Event[]): this {
    this.journal = events;
    return this;
  }

  /** Current journal, oldest first. */
  events(): readonly Event[] {
    return this.journal;
  }

  /** `X-As-Of-Seq` of the default routes: the journal head. */
  head(): number {
    return this.journal.reduce((max, e) => Math.max(max, e.seq), 0);
  }

  /** Registers (or overrides) a route. `respond` may be a fixed response or a function of the request. */
  on(method: HttpMethod, match: string | RegExp, respond: FakeResponse | Responder): this {
    this.routes.unshift({
      method,
      match,
      respond: typeof respond === 'function' ? respond : () => respond,
    });
    return this;
  }

  /** Requests seen so far for a method + exact path. */
  calls(method: HttpMethod, path: string): RecordedRequest[] {
    return this.requests.filter((r) => r.method === method && r.path === path);
  }

  /** Never settles: lets a test hold a read in its loading state. */
  pending(method: HttpMethod, match: string | RegExp): this {
    return this.on(method, match, () => new Promise<FakeResponse>(() => undefined));
  }

  /** Rejects like a dropped connection (the client turns it into `NetworkError`). */
  networkFailure(method: HttpMethod, match: string | RegExp): this {
    return this.on(method, match, () => Promise.reject(new TypeError('Failed to fetch')));
  }

  private readonly fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET') as HttpMethod;
    const path = url.pathname.replace(/^\/api/, '');
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const req: RecordedRequest = { method, path, query: url.searchParams, body };
    this.requests.push(req);

    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const route = this.routes.find(
      (r) =>
        r.method === method &&
        (typeof r.match === 'string' ? r.match === path : r.match.test(path)),
    );
    if (!route) throw new Error(`FakeNetwork: no route for ${method} ${path}`);

    const res = await route.respond(req);
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (res.asOfSeq !== undefined) headers.set(AS_OF_SEQ_HEADER, String(res.asOfSeq));
    return new Response(JSON.stringify(res.body), { status: res.status, headers });
  };
}

const DAY_MS = 86_400_000;
const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const shiftDay = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** API-AC-35: inclusive UTC-day range of a period; "today" is the day of the Simulation Clock. */
function periodRange(period: Period): { fromDay: string; toDay: string } {
  const today = utcDay(SEED_CLOCK);
  switch (period) {
    case 'today':
      return { fromDay: today, toDay: today };
    case '7d':
      return { fromDay: shiftDay(today, -6), toDay: today };
    case '30d':
      return { fromDay: shiftDay(today, -29), toDay: today };
    case 'all':
      return { fromDay: '0000-01-01', toDay: '9999-12-31' };
  }
}

interface CostedSession {
  summary: SessionSummary;
  /** Cost per token activity (entries without an activity are not counted, like the server). */
  activity: Map<string, number>;
}

let costedCache: CostedSession[] | undefined;

/** Seed sessions priced with the seed price list (the raw seed summaries carry `costUsd: 0`). */
function costedSessions(): CostedSession[] {
  if (costedCache) return costedCache;
  const prices = new Map(seedModelPrices().map((p) => [p.model, p]));
  costedCache = seedSessionSummaries().map((summary) => {
    const price = prices.get(summary.model);
    const activity = new Map<string, number>();
    let cost = 0;
    if (price) {
      for (const e of seedSessionDetail(summary.id).entries) {
        if (!e.tokens) continue;
        const c = entryCostUsd(e.tokens, price);
        cost += c;
        if (e.activity) activity.set(e.activity, (activity.get(e.activity) ?? 0) + c);
      }
    }
    return { summary: { ...summary, costUsd: cost }, activity };
  });
  return costedCache;
}

const inRange = (s: SessionSummary, r: { fromDay: string; toDay: string }) => {
  const day = utcDay(s.startedAt);
  return day >= r.fromDay && day <= r.toDay;
};

const newestFirst = (a: SessionSummary, b: SessionSummary) =>
  Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.id.localeCompare(a.id);

const BREAKDOWN_TOP = 6;

function breakdown(costs: Map<string | null, number>, total: number, top?: number) {
  const items = [...costs]
    .map(([key, costUsd]) => ({ key, costUsd, share: total > 0 ? costUsd / total : 0 }))
    .sort((a, b) => b.costUsd - a.costUsd);
  return top === undefined ? items : items.slice(0, top);
}

const add = <K>(m: Map<K, number>, key: K, v: number) => m.set(key, (m.get(key) ?? 0) + v);

function usageFor(period: Period): z.input<typeof UsageResponse> {
  const today = utcDay(SEED_CLOCK);
  const range = periodRange(period);
  const windowFrom = shiftDay(today, -(USAGE_DAYS - 1));
  const all = costedSessions();
  const inPeriod = all.filter((c) => inRange(c.summary, range));
  const costs = inPeriod.map((c) => c.summary.costUsd);
  const total = costs.reduce((a, b) => a + b, 0);
  const tokensSum: TokenUsage = sumTokens(inPeriod.map((c) => c.summary.tokens));
  const tokens = tokensSum.input + tokensSum.output + tokensSum.cacheRead + tokensSum.cacheWrite;
  const n = costs.length;
  const sorted = [...costs].sort((a, b) => a - b);

  const dayCost = new Map<string, number>();
  for (const c of all) add(dayCost, utcDay(c.summary.startedAt), c.summary.costUsd);
  const costPerDay = Array.from({ length: USAGE_DAYS }, (_, i) => {
    const date = shiftDay(windowFrom, i);
    return {
      date,
      inPeriod: date >= range.fromDay && date <= range.toDay,
      isToday: date === today,
      costUsd: dayCost.get(date) ?? 0,
    };
  });

  const byAgent = new Map<string | null, number>();
  const byTicket = new Map<string | null, number>();
  const byModel = new Map<string | null, number>();
  const byActivity = new Map<string | null, number>();
  for (const c of inPeriod) {
    add(byAgent, c.summary.agentId, c.summary.costUsd);
    add(byTicket, c.summary.ticketId, c.summary.costUsd);
    add(byModel, c.summary.model, c.summary.costUsd);
    for (const [activity, cost] of c.activity) add(byActivity, activity, cost);
  }

  return {
    period,
    dataSource: 'mock',
    kpis: {
      totalCostUsd: total,
      tokens,
      cacheReadShare: tokens > 0 ? tokensSum.cacheRead / tokens : 0,
      sessions: n,
      runningNow: inPeriod.filter((c) => c.summary.status === 'running').length,
      avgCostUsd: n > 0 ? total / n : 0,
      medianCostUsd: n > 0 ? (sorted[Math.floor(n / 2)] ?? 0) : 0,
    },
    costPerDay,
    peakUsd: costPerDay.reduce((m, d) => Math.max(m, d.costUsd), 0),
    breakdowns: {
      byAgent: breakdown(byAgent, total, BREAKDOWN_TOP),
      byTicket: breakdown(byTicket, total, BREAKDOWN_TOP),
      byModel: breakdown(byModel, total, BREAKDOWN_TOP),
      byActivity: breakdown(byActivity, total),
    },
  };
}

/**
 * `GET /tickets/:id` for the seed ticket, optionally patched (API-AC-24: newest 30 feed events and the
 * ticket's sessions, both newest first; unknown id -> 404). Exported so a test can serve a changed ticket
 * without re-implementing the ordering.
 */
export function ticketDetailResponse(
  net: FakeNetwork,
  id: string,
  patch: Partial<Ticket> = {},
): FakeResponse {
  const seed = seedTickets().find((t) => t.id === id);
  if (!seed) return errorResponse(404, 'not_found', 'Ticket not found.');
  const ticket = { ...seed, ...patch };
  const activity = net
    .events()
    .filter((e) => e.ticketId === id && isFeedEvent(e))
    .reverse()
    .slice(0, TICKET_ACTIVITY_MAX);
  const sessions = costedSessions()
    .map((c) => c.summary)
    .filter((s) => s.ticketId === id)
    .sort(newestFirst);
  return jsonResponse(
    TicketDetailResponse,
    { ticket, activity, sessions, dataSource: 'mock' },
    { asOfSeq: net.head() },
  );
}

function badQuery(error: z.ZodError): FakeResponse {
  return errorResponse(400, 'validation_failed', 'Invalid query.', {
    details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}

/** A `FakeNetwork` pre-loaded with the seed state; call `.install()` (and `.uninstall()` in teardown). */
export function createFakeNetwork(opts: { events?: readonly Event[] } = {}): FakeNetwork {
  const net = new FakeNetwork();
  if (opts.events) net.setEvents(opts.events);
  const get = (path: string | RegExp, respond: Responder) => net.on('GET', path, respond);
  const asOf = () => net.head();
  const query = (req: RecordedRequest) => Object.fromEntries(req.query);

  get('/tickets', () => jsonResponse(TicketListResponse, seedTickets(), { asOfSeq: asOf() }));
  get(/^\/tickets\/[^/]+$/, (req) => ticketDetailResponse(net, lastSeg(req.path)));
  get('/agents', () => jsonResponse(AgentListResponse, seedAgents(), { asOfSeq: asOf() }));
  get(/^\/agents\/[^/]+$/, (req) => {
    // API-AC-28: KPIs, 10 newest sessions + total, related tickets; unknown id -> 404.
    const id = lastSeg(req.path);
    const agent = seedAgents().find((a) => a.id === id);
    if (!agent) return errorResponse(404, 'not_found', 'Agent not found.');
    const today = utcDay(SEED_CLOCK);
    const mine = costedSessions()
      .map((c) => c.summary)
      .filter((s) => s.agentId === id)
      .sort(newestFirst);
    const week = { fromDay: shiftDay(today, -6), toDay: today };
    const tickets = seedTickets().filter(
      (t) =>
        t.assigneeId === id || net.events().some((e) => e.agentId === id && e.ticketId === t.id),
    );
    return jsonResponse(
      AgentPageResponse,
      {
        agent,
        kpis: {
          sessions7d: mine.filter((s) => inRange(s, week)).length,
          ticketsDone: tickets.filter((t) => t.status === 'done' && t.assigneeId === id).length,
          toolCallsToday: net
            .events()
            .filter((e) => e.agentId === id && e.type === 'tool.started' && utcDay(e.at) === today)
            .length,
          cost7dUsd: mine.filter((s) => inRange(s, week)).reduce((sum, s) => sum + s.costUsd, 0),
        },
        // Said vs did needs the server's journal analysis; the default page reports none.
        saidVsDid: { rows: [], mismatchCount: 0, notes: [] },
        sessions: mine.slice(0, AGENT_SESSIONS_MAX),
        sessionsTotal: mine.length,
        tickets: tickets.map((t) => ({ id: t.id, title: t.title, status: t.status })),
        dataSource: 'mock',
      },
      { asOfSeq: asOf() },
    );
  });
  get('/simulation', () => jsonResponse(SimulationState, buildSimulation(), { asOfSeq: asOf() }));
  get('/overview', () => jsonResponse(OverviewResponse, buildOverview(), { asOfSeq: asOf() }));
  get('/model-prices', () =>
    jsonResponse(
      ModelPricesResponse,
      { items: seedModelPrices() satisfies ModelPrice[], dataSource: 'mock' },
      { asOfSeq: asOf() },
    ),
  );
  get('/events', (req) => {
    // API-AC-25: feed events only, newest first, keyset on `beforeSeq`, `nextBeforeSeq` while more remain.
    const parsed = EventsQuery.safeParse(query(req));
    if (!parsed.success) return badQuery(parsed.error);
    const q = parsed.data;
    const feed = net
      .events()
      .filter(isFeedEvent)
      .filter(
        (e) =>
          (q.beforeSeq === undefined || e.seq < q.beforeSeq) &&
          (q.source === undefined || e.source === q.source) &&
          (q.category === undefined || e.category === q.category) &&
          (q.agentId === undefined || e.agentId === q.agentId) &&
          (q.ticketId === undefined || e.ticketId === q.ticketId),
      )
      .sort((a, b) => b.seq - a.seq);
    const items = feed.slice(0, q.limit);
    const next = feed.length > q.limit ? (items.at(-1)?.seq ?? null) : null;
    return jsonResponse(EventsPageResponse, { items, nextBeforeSeq: next }, { asOfSeq: asOf() });
  });
  get('/usage', (req) => {
    const parsed = UsageQuery.safeParse(query(req));
    if (!parsed.success) return badQuery(parsed.error);
    return jsonResponse(UsageResponse, usageFor(parsed.data.period), { asOfSeq: asOf() });
  });
  get('/sessions', (req) => {
    // API-AC-36: period/agent/model filtered, sorted descending by the chosen key, paged.
    const parsed = SessionsQuery.safeParse(query(req));
    if (!parsed.success) return badQuery(parsed.error);
    const q = parsed.data;
    const range = periodRange(q.period);
    const key = (s: SessionSummary): number | string =>
      q.sort === 'start' ? s.startedAt : q.sort === 'cost' ? s.costUsd : s.tokens[q.sort];
    const matching = costedSessions()
      .map((c) => c.summary)
      .filter(
        (s) =>
          inRange(s, range) &&
          (q.agentId === undefined || s.agentId === q.agentId) &&
          (q.model === undefined || s.model === q.model),
      )
      .sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : newestFirst(a, b)));
    return jsonResponse(
      SessionsPageResponse,
      {
        items: matching.slice(q.offset, q.offset + q.limit),
        total: matching.length,
        limit: q.limit,
        offset: q.offset,
        sort: q.sort,
        dataSource: 'mock',
      },
      { asOfSeq: asOf() },
    );
  });
  get(/^\/sessions\/[^/]+$/, (req) => {
    try {
      return jsonResponse(SessionDetail, seedSessionDetail(lastSeg(req.path)), { asOfSeq: asOf() });
    } catch {
      return errorResponse(404, 'not_found', 'Session not found.');
    }
  });
  return net;
}
