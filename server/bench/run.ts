/**
 * Benchmarks (T68): seeds the fixture x10 + 100 000 events + one 1 000-entry session into a throwaway
 * database `agent_ops_bench`, measures the NFR-DB-1…6 and SPEC-server-api latency budgets, prints a
 * target-vs-measured table and exits non-zero when a target is missed. Report only; not a CI gate.
 * Run: `pnpm --filter @agent-ops/server bench` (needs `docker compose up -d`).
 */
import { performance } from 'node:perf_hooks';
import { eq, asc, sql } from 'drizzle-orm';
import pg from 'pg';
import { createContainer, type Container } from '../src/container.js';
import { createDb } from '../src/infrastructure/db/client.js';
import { runMigrations } from '../src/infrastructure/db/migrate.js';
import { sessionLogEntries } from '../src/infrastructure/db/schema.js';
import {
  insertFixture,
  lockEvents,
  readFixture,
} from '../src/infrastructure/fixture/load-fixture.js';
import { getUsage } from '../src/infrastructure/queries/usage.js';
import { EventsRepository } from '../src/infrastructure/repositories/events.repository.js';

const BENCH_DB = 'agent_ops_bench';
const TARGET_EVENTS = 100_000;
const BIG_SESSION_NUMBER = 9900;
const BIG_SESSION_ENTRIES = 1000;
const FIXTURE_COPIES = 10;
const ITERATIONS = 60;
const STREAMS = 20;
const STREAM_COMMANDS = 30;

// ---- database bootstrap -----------------------------------------------------------------------

function baseUrl(): URL {
  const raw =
    process.env['DATABASE_URL_TEST_BASE'] ??
    process.env['DATABASE_URL'] ??
    'postgres://agent_ops:agent_ops@127.0.0.1:5432/postgres';
  return new URL(raw);
}

function urlFor(db: string): string {
  const u = baseUrl();
  u.pathname = `/${db}`;
  return u.toString();
}

async function recreateDatabase(): Promise<void> {
  if ((BENCH_DB as string) === 'agent_ops')
    throw new Error('Refusing to run the bench against agent_ops');
  const admin = new pg.Client({ connectionString: urlFor('postgres') });
  await admin.connect();
  try {
    await admin.query(`drop database if exists "${BENCH_DB}" with (force)`);
    await admin.query(`create database "${BENCH_DB}"`);
  } finally {
    await admin.end();
  }
}

async function dropDatabase(): Promise<void> {
  const admin = new pg.Client({ connectionString: urlFor('postgres') });
  await admin.connect();
  try {
    await admin.query(`drop database if exists "${BENCH_DB}" with (force)`);
  } finally {
    await admin.end();
  }
}

// ---- stats ------------------------------------------------------------------------------------

function p95(samples: number[]): number {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] ?? Number.NaN;
}

async function time(n: number, fn: (i: number) => Promise<void>, warmup = 5): Promise<number[]> {
  for (let i = 0; i < warmup; i++) await fn(-1 - i);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn(i);
    out.push(performance.now() - t0);
  }
  return out;
}

interface Row {
  id: string;
  what: string;
  targetMs: number;
  measuredMs: number;
  note?: string;
}
const rows: Row[] = [];
const record = (
  id: string,
  what: string,
  targetMs: number,
  samples: number[],
  note?: string,
): void => {
  rows.push({
    id,
    what,
    targetMs,
    measuredMs: p95(samples),
    ...(note === undefined ? {} : { note }),
  });
};

// ---- seeding ----------------------------------------------------------------------------------

async function seed(
  handle: ReturnType<typeof createDb>,
): Promise<{ firstFixtureEvents: number; fixtureMs: number }> {
  const fx = readFixture();
  const t0 = performance.now();
  await runMigrations(handle.db);
  await handle.db.transaction(async (tx) => {
    await lockEvents(tx);
    await insertFixture(tx, fx);
  });
  const fixtureMs = performance.now() - t0;

  await handle.db.transaction(async (tx) => {
    // sessions x10: every non-running session copied 9 more times with shifted time and number
    const copies = FIXTURE_COPIES - 1;
    await tx.execute(sql`
      insert into sessions (id, number, agent_id, ticket_id, model, status, started_at, ended_at)
      select 'S-' || lpad((s.number + k * 1000)::text, 4, '0'), s.number + k * 1000, s.agent_id, s.ticket_id,
             s.model, s.status, s.started_at - k * interval '3 days', s.ended_at - k * interval '3 days'
      from sessions s cross join generate_series(1, ${copies}) k
      where s.status <> 'running'`);
    await tx.execute(sql`
      insert into session_log_entries (session_id, ordinal, at, kind, text, stage, tool_name, tool_arg, tool_ok,
        tool_result, tool_duration_sec, tool_output, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, token_activity)
      select 'S-' || lpad((s.number + k * 1000)::text, 4, '0'), e.ordinal, e.at - k * interval '3 days', e.kind,
             e.text, e.stage, e.tool_name, e.tool_arg, e.tool_ok, e.tool_result, e.tool_duration_sec,
             e.tool_output, e.input_tokens, e.output_tokens, e.cache_read_tokens, e.cache_write_tokens,
             e.token_activity
      from sessions s
      join session_log_entries e on e.session_id = s.id
      cross join generate_series(1, ${copies}) k
      where s.status <> 'running' and s.number < 1000`);

    // the 1 000-entry session
    await tx.execute(sql`
      insert into sessions (id, number, agent_id, ticket_id, model, status, started_at, ended_at)
      select 'S-' || lpad(${BIG_SESSION_NUMBER}::text, 4, '0'), ${BIG_SESSION_NUMBER}, 'alpha', 'T-1',
             'sonnet-5-5', 'completed', clock_at - interval '2 days', clock_at - interval '1 day'
      from simulation_state`);
    await tx.execute(sql`
      insert into session_log_entries (session_id, ordinal, at, kind, tool_name, tool_arg, tool_ok, tool_result,
        tool_duration_sec, tool_output, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        token_activity)
      select 'S-' || lpad(${BIG_SESSION_NUMBER}::text, 4, '0'), g, clock_at - interval '2 days' + g * interval '20 seconds',
             'tool', 'Read', 'src/api/routes.ts', true, '79 LINES', 1, repeat('x', 200),
             1000 + g, 100, 5000, 200, 'reading_code'
      from simulation_state cross join generate_series(0, ${BIG_SESSION_ENTRIES - 1}) g`);

    // events: clone the fixture journal until TARGET_EVENTS, keeping a monotonic seq per copy
    const [{ n } = { n: '0' }] = (
      await tx.execute<{ n: string }>(sql`select count(*)::text as n from events`)
    ).rows;
    const base = Number(n);
    const rounds = Math.ceil((TARGET_EVENTS - base) / base);
    await tx.execute(sql`
      insert into events (at, source, category, type, agent_id, ticket_id, session_id, payload, warn)
      select e.at - g * interval '1 minute', e.source, e.category, e.type, e.agent_id, e.ticket_id,
             e.session_id, e.payload, e.warn
      from generate_series(1, ${rounds}) g
      cross join lateral (select * from events where seq <= (select min(seq) + ${base - 1} from events) ) e
      order by g, e.seq`);
  });
  await handle.pool.query('analyze');
  return { firstFixtureEvents: 0, fixtureMs };
}

// ---- measurement ------------------------------------------------------------------------------

interface Injected {
  statusCode: number;
  body: string;
}
const inject = (
  c: Container,
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
): Promise<Injected> =>
  c.app.inject(
    payload === undefined ? { method, url } : { method, url, payload: payload as object },
  ) as Promise<Injected>;

async function ok(
  c: Container,
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
): Promise<void> {
  const res = await inject(c, method, url, payload);
  if (res.statusCode >= 300)
    throw new Error(`${method} ${url} -> ${res.statusCode}: ${res.body.slice(0, 200)}`);
}

async function measureReads(c: Container): Promise<void> {
  const handle = c.handle;
  const journal = new EventsRepository(handle.db);

  // NFR-DB-2: feed pages straight from the repository (DB budget)
  record(
    'NFR-DB-2',
    'events feed page (40)',
    20,
    await time(ITERATIONS, () => journal.page({ limit: 40 }).then(() => {})),
  );
  record(
    'NFR-DB-2',
    'events feed page (40) source+category',
    20,
    await time(ITERATIONS, () =>
      journal.page({ limit: 40, source: 'agent_telemetry', category: 'tool' }).then(() => {}),
    ),
  );
  record(
    'NFR-DB-2',
    'ticket newest 30',
    20,
    await time(ITERATIONS, () => journal.latestForTicket('T-8', 30).then(() => {})),
  );
  record(
    'NFR-DB-2',
    'agent newest 16',
    20,
    await time(ITERATIONS, () => journal.latestForAgent('sim-1', 16).then(() => {})),
  );

  // NFR-DB-3: all 1 000 entries of one session, in order
  const bigId = `S-${String(BIG_SESSION_NUMBER).padStart(4, '0')}`;
  const entries = await time(ITERATIONS, async () => {
    const r = await handle.db
      .select()
      .from(sessionLogEntries)
      .where(eq(sessionLogEntries.sessionId, bigId))
      .orderBy(asc(sessionLogEntries.ordinal));
    if (r.length !== BIG_SESSION_ENTRIES)
      throw new Error(`expected ${BIG_SESSION_ENTRIES} entries, got ${r.length}`);
  });
  record('NFR-DB-3', '1 000-entry session, all entries', 50, entries);

  // NFR-DB-4: usage aggregate, ALL TIME
  record(
    'NFR-DB-4',
    'usage aggregate (period all)',
    150,
    await time(ITERATIONS, () =>
      handle.db
        .transaction((tx) => getUsage(tx, { fromDay: '0000-01-01', toDay: '9999-12-31' }))
        .then(() => {}),
    ),
    'raw aggregate queries; HTTP row below',
  );

  // NFR-DB-5: resume read of 1 000 events
  const last = await journal.lastSeq();
  record(
    'NFR-DB-5',
    '1 000 events after seq',
    50,
    await time(ITERATIONS, () =>
      journal.since(last - 1000, 1000).then((r) => {
        if (r.length !== 1000) throw new Error(`since returned ${r.length}`);
      }),
    ),
  );

  // SPEC-server-api read endpoints: p95 < 300 ms; usage and session detail < 500 ms
  const reads: [string, string][] = [
    ['tickets', '/api/tickets'],
    ['ticket detail', '/api/tickets/T-8'],
    ['agents', '/api/agents'],
    ['agent detail', '/api/agents/sim-1'],
    ['overview', '/api/overview'],
    ['events feed', '/api/events?limit=40'],
    ['sessions (30d)', '/api/sessions?period=30d'],
    ['sessions (all, by cost)', '/api/sessions?period=all&sort=cost'],
    ['model prices', '/api/model-prices'],
    ['simulation', '/api/simulation'],
  ];
  for (const [name, url] of reads) {
    record('API-READ', `GET ${name}`, 300, await time(ITERATIONS, () => ok(c, 'GET', url)));
  }
  record(
    'API-READ',
    'GET /api/usage (all)',
    500,
    await time(ITERATIONS, () => ok(c, 'GET', '/api/usage?period=all')),
  );
  record(
    'API-READ',
    'GET /api/usage (30d)',
    500,
    await time(ITERATIONS, () => ok(c, 'GET', '/api/usage?period=30d')),
  );
  record(
    'API-READ',
    'GET /api/sessions/:id (1 000 entries)',
    500,
    await time(ITERATIONS, () => ok(c, 'GET', `/api/sessions/${bigId}`)),
  );
}

async function measureCommands(c: Container): Promise<void> {
  // NFR-DB-1 / API budget: inject-measured commands (validation + transaction + events + commit + publish)
  const create = await time(ITERATIONS, (i) =>
    ok(c, 'POST', '/api/tickets', { title: `Bench ticket ${i}` }),
  );
  record(
    'NFR-DB-1',
    'command: create ticket (via inject)',
    20,
    create,
    'includes validation + publish',
  );
  record('API-CMD', 'POST /api/tickets', 150, create);

  const toggle = [false];
  const move = await time(
    ITERATIONS,
    async () => {
      const [from, to] = toggle[0]
        ? (['ready', 'backlog'] as const)
        : (['backlog', 'ready'] as const);
      await ok(c, 'POST', '/api/tickets/T-15/move', { to, expectedStatus: from });
      toggle[0] = !toggle[0];
    },
    0,
  );
  record('API-CMD', 'POST /api/tickets/:id/move', 150, move);
}

async function measureRun(c: Container): Promise<void> {
  // First candidate that is allowed to step (a blocked or idle agent answers 409 cannot_step).
  const candidates: [string, string][] = [
    ['alpha', 'T-12'],
    ['bravo', 'T-9'],
    ['sim-1', 'T-8'],
  ];
  for (const [agentId, ticketId] of candidates) {
    const t0 = performance.now();
    const res = await inject(c, 'POST', `/api/simulation/agents/${agentId}/step`, {
      ticketId,
      mode: 'to_next_stage',
    });
    const ms = performance.now() - t0;
    if (res.statusCode >= 300) continue;
    const body = JSON.parse(res.body) as { steps: number; stoppedBecause: string };
    rows.push({
      id: 'API-RUN',
      what: `run to next stage (${agentId})`,
      targetMs: 4000,
      measuredMs: ms,
      note: `${body.steps} steps, ${body.stoppedBecause}`,
    });
    return;
  }
  throw new Error('run to next stage: no candidate agent could step');
}

interface StreamClient {
  seen: Set<number>;
  firstAfter: number | null;
  ready: Promise<void>;
  close(): void;
}

function openStream(url: string, onEvent: (seq: number, at: number) => void): StreamClient {
  const ctrl = new AbortController();
  const seen = new Set<number>();
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));
  const client: StreamClient = { seen, firstAfter: null, ready, close: () => ctrl.abort() };
  void (async () => {
    try {
      const res = await fetch(url, {
        headers: { accept: 'text/event-stream' },
        signal: ctrl.signal,
      });
      if (res.body === null) return;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const at = performance.now();
        buf += value;
        let cut: number;
        while ((cut = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          if (/^event: hello$/m.test(block)) resolveReady();
          const id = /^id: (\d+)$/m.exec(block);
          if (id !== null && id[1] !== undefined) {
            const seq = Number(id[1]);
            seen.add(seq);
            onEvent(seq, at);
          }
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return client;
}

async function measureStreams(c: Container): Promise<void> {
  const address = await c.app.listen({ port: 0, host: '127.0.0.1' });
  const arrivals: number[] = [];
  let sentAt = 0;
  let marker = 0; // seqs above this belong to the command in flight
  const clients: StreamClient[] = [];
  const latencies: number[] = [];
  const first = new Map<StreamClient, number>();
  for (let i = 0; i < STREAMS; i++) {
    const client: StreamClient = openStream(`${address}/api/stream`, (seq, at) => {
      if (seq > marker && !first.has(client)) first.set(client, at - sentAt);
      arrivals.push(seq);
    });
    clients.push(client);
  }
  await Promise.all(clients.map((cl) => cl.ready));

  const commandMs: number[] = [];
  for (let i = 0; i < STREAM_COMMANDS; i++) {
    first.clear();
    marker = Math.max(marker, ...clients.flatMap((cl) => [...cl.seen]), 0);
    sentAt = performance.now();
    await ok(c, 'POST', '/api/tickets', { title: `Stream ticket ${i}` });
    commandMs.push(performance.now() - sentAt);
    const deadline = performance.now() + 5000;
    while (first.size < STREAMS && performance.now() < deadline)
      await new Promise((r) => setTimeout(r, 2));
    latencies.push(...first.values());
  }
  await new Promise((r) => setTimeout(r, 200));

  const last = await new EventsRepository(c.handle.db).lastSeq();
  const missing = clients.filter((cl) => cl.seen.size === 0 || !cl.seen.has(last)).length;
  const counts = clients.map((cl) => cl.seen.size);
  const lost = counts.some((n) => n !== counts[0]) || missing > 0;
  for (const cl of clients) cl.close();

  record('API-CMD', `POST /api/tickets with ${STREAMS} streams open`, 150, commandMs);
  record('AC-59', `event delivery to ${STREAMS} streams`, 500, latencies);
  rows.push({
    id: 'API-STREAM',
    what: `${STREAMS} streams, no event loss`,
    targetMs: 0,
    measuredMs: lost ? 1 : 0,
    note: lost
      ? `LOSS: per-stream counts ${[...new Set(counts)].join('/')}, missing last seq on ${missing}`
      : `${counts[0]} events each`,
  });
}

// ---- reporting --------------------------------------------------------------------------------

function printTable(): boolean {
  const w = { id: 10, what: 42, t: 10, m: 12 };
  const line = (a: string, b: string, c: string, d: string, e: string): string =>
    `${a.padEnd(w.id)} ${b.padEnd(w.what)} ${c.padStart(w.t)} ${d.padStart(w.m)}  ${e}`;
  console.log(line('budget', 'measurement', 'target', 'p95 (ms)', 'result'));
  console.log('-'.repeat(w.id + w.what + w.t + w.m + 14));
  let failed = false;
  for (const r of rows) {
    const stream = r.id === 'API-STREAM';
    const pass = stream ? r.measuredMs === 0 : r.measuredMs < r.targetMs;
    if (!pass) failed = true;
    console.log(
      line(
        r.id,
        r.what,
        stream ? 'none lost' : `< ${r.targetMs}`,
        stream ? (pass ? 'ok' : 'LOSS') : r.measuredMs.toFixed(1),
        `${pass ? 'PASS' : 'FAIL'}${r.note === undefined ? '' : `  (${r.note})`}`,
      ),
    );
  }
  return !failed;
}

async function main(): Promise<void> {
  await recreateDatabase();
  const url = urlFor(BENCH_DB);
  const seedHandle = createDb(url);
  let container: Container | undefined;
  try {
    console.log(
      `Seeding ${BENCH_DB} (fixture x${FIXTURE_COPIES}, ~${TARGET_EVENTS} events, 1 000-entry session)...`,
    );
    const t0 = performance.now();
    const { fixtureMs } = await seed(seedHandle);
    const [counts] = (
      await seedHandle.pool.query<{ e: string; s: string; l: string }>(
        `select (select count(*) from events) e, (select count(*) from sessions) s, (select count(*) from session_log_entries) l`,
      )
    ).rows;
    console.log(
      `Seeded in ${((performance.now() - t0) / 1000).toFixed(1)} s: ${counts?.e} events, ${counts?.s} sessions, ${counts?.l} log entries`,
    );
    rows.push({
      id: 'NFR-DB-6',
      what: 'migrations + fixture load, empty DB',
      targetMs: 5000,
      measuredMs: fixtureMs,
      note: 'single run',
    });

    container = await createContainer({ databaseUrl: url });
    await measureReads(container);
    await measureCommands(container);
    await measureRun(container);
    await measureStreams(container);
  } finally {
    await container?.close();
    await seedHandle.close();
    await dropDatabase();
  }
  const pass = printTable();
  if (!pass) {
    console.error('\nOne or more targets were missed.');
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
  void dropDatabase().catch(() => undefined);
});
