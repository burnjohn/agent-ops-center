import Fastify, { type FastifyInstance } from 'fastify';
import { max, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HelloMessage, KEEPALIVE_INTERVAL_MS, ResyncMessage } from '@agent-ops/shared';
import { createResetCommand } from '../../container.js';
import { events, simulationState } from '../../infrastructure/db/schema.js';
import { EventsRepository } from '../../infrastructure/repositories/events.repository.js';
import { SseFanOut } from '../../infrastructure/sse/fan-out.js';
import { createIntervalScheduler } from '../../infrastructure/scheduler/interval-scheduler.js';
import { buildTestApp, type TestApp } from '../../../test/int/app.js';
import { freshFixture, openTestDb, testDatabaseUrl } from '../../../test/int/db.js';
import { makeUow, movedDraft } from '../../../test/int/factories.js';
import { parseSse, type SseMessage } from '../../../test/int/sse-client.js';
import { streamRoutes } from './stream.js';

const handle = openTestDb();

interface Conn {
  /** Complete messages received so far. */
  messages(): SseMessage[];
  raw(): string;
  /** Wall-clock arrival time (ms) per message id, for the latency test only. */
  arrivals: Map<string, number>;
  waitFor(
    pred: (messages: SseMessage[], raw: string) => boolean,
    timeoutMs?: number,
  ): Promise<void>;
  headers: Headers;
  close(): void;
}

const open: Conn[] = [];
afterEach(() => {
  for (const c of open.splice(0)) c.close();
});

async function connect(
  base: string,
  opts: { headers?: Record<string, string>; path?: string } = {},
): Promise<Conn> {
  const ctrl = new AbortController();
  const res = await fetch(`${base}${opts.path ?? '/api/stream'}`, {
    headers: { accept: 'text/event-stream', ...opts.headers },
    signal: ctrl.signal,
  });
  if (res.body === null) throw new Error('no body');
  let raw = '';
  const arrivals = new Map<string, number>();
  const waiters: { pred: () => boolean; resolve: () => void }[] = [];
  const messages = (): SseMessage[] => parseSse(raw.slice(0, raw.lastIndexOf('\n\n') + 2));
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        raw += value;
        const now = performance.now();
        for (const m of messages())
          if (m.id !== undefined && !arrivals.has(m.id)) arrivals.set(m.id, now);
        for (const w of [...waiters]) {
          if (w.pred()) {
            waiters.splice(waiters.indexOf(w), 1);
            w.resolve();
          }
        }
      }
    } catch {
      // aborted by close()
    }
  })();
  const conn: Conn = {
    messages,
    raw: () => raw,
    arrivals,
    headers: res.headers,
    waitFor: (pred, timeoutMs = 5000) =>
      new Promise<void>((resolve, reject) => {
        const check = (): boolean => pred(messages(), raw);
        if (check()) return resolve();
        const timer = setTimeout(
          () => reject(new Error(`timed out waiting; received: ${raw.slice(0, 500)}`)),
          timeoutMs,
        );
        waiters.push({
          pred: check,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
        });
      }),
    close: () => ctrl.abort(),
  };
  open.push(conn);
  return conn;
}

const hello = (c: Conn): HelloMessage => {
  const m = c.messages().find((x) => x.event === 'hello');
  if (m === undefined) throw new Error('no hello');
  return HelloMessage.parse(JSON.parse(m.data));
};
const domainSeqs = (c: Conn): number[] =>
  c
    .messages()
    .filter((m) => m.id !== undefined)
    .map((m) => Number(m.id));
const helloSeen = (c: Conn) => c.waitFor((ms) => ms.some((m) => m.event === 'hello'));

async function dbSeqsAfter(n: number): Promise<number[]> {
  const rows = await handle.db
    .select({ seq: events.seq })
    .from(events)
    .where(sql`${events.seq} > ${n}`)
    .orderBy(events.seq);
  return rows.map((r) => r.seq);
}
async function dbLastSeq(): Promise<number> {
  const [row] = await handle.db.select({ m: max(events.seq) }).from(events);
  return row?.m ?? 0;
}

let testApp: TestApp;
let base: string;

async function start(): Promise<void> {
  testApp = await buildTestApp();
  base = await testApp.app.listen({ port: 0, host: '127.0.0.1' });
}
const createTicket = (title: string) =>
  fetch(`${base}/api/tickets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });

beforeEach(async () => {
  await freshFixture(handle.db);
  await start();
});

describe('GET /api/stream (integration)', () => {
  it('answers with event-stream headers and a hello that matches the database', async () => {
    // contract: API-AC-58 - hello is first and carries lastSeq, journalFloorSeq, clock, playing
    const c = await connect(base);
    await helloSeen(c);
    expect(c.headers.get('content-type')).toContain('text/event-stream');
    expect(c.headers.get('cache-control')).toContain('no-cache');
    expect(c.messages()[0]?.event).toBe('hello');
    expect(c.messages()[0]?.id).toBeUndefined();
    const h = hello(c);
    const [state] = await handle.db.select().from(simulationState);
    expect(h.lastSeq).toBe(await dbLastSeq());
    expect(h.journalFloorSeq).toBe(state?.journalFloorSeq);
    expect(h.playing).toBe(false);
    expect(Number.isNaN(Date.parse(h.clock))).toBe(false);
  });

  it('delivers the events of a committed command in order with id equal to seq, after the response', async () => {
    // contract: API-AC-59 - a command's events arrive in commit order; id = seq; only committed data is published
    const c = await connect(base);
    await helloSeen(c);
    const before = hello(c).lastSeq;
    const res = await createTicket('Stream order');
    expect(res.status).toBe(201);
    const expected = await dbSeqsAfter(before);
    expect(expected.length).toBeGreaterThanOrEqual(1);
    await c.waitFor(() => domainSeqs(c).length >= expected.length);
    expect(domainSeqs(c)).toEqual(expected);
    const first = c.messages().find((m) => m.id !== undefined);
    expect(first?.event).toBe('ticket.created');
    expect(JSON.parse(first?.data ?? '{}')).toMatchObject({
      seq: expected[0],
      type: 'ticket.created',
    });
  });

  it('after a disconnect, reconnecting with Last-Event-ID or ?since= replays exactly the missed events', async () => {
    // contract: API-AC-59 - resume yields every seq > N exactly once, in order (header and ?since= alike)
    const first = await connect(base);
    await helloSeen(first);
    const last = hello(first).lastSeq;
    first.close();
    for (let i = 0; i < 5; i += 1) expect((await createTicket(`Missed ${i}`)).status).toBe(201);
    const expected = await dbSeqsAfter(last);
    expect(expected.length).toBeGreaterThanOrEqual(5);

    const viaHeader = await connect(base, { headers: { 'last-event-id': String(last) } });
    await viaHeader.waitFor(() => domainSeqs(viaHeader).length >= expected.length);
    const viaQuery = await connect(base, { path: `/api/stream?since=${last}` });
    await viaQuery.waitFor(() => domainSeqs(viaQuery).length >= expected.length);
    expect(domainSeqs(viaHeader)).toEqual(expected);
    expect(domainSeqs(viaQuery)).toEqual(expected);
    expect(viaHeader.messages().some((m) => m.event === 'resync')).toBe(false);
  });

  it('loses and duplicates nothing when 50 commands commit concurrently with the replay-to-live hand-over', async () => {
    // contract: API-AC-59 / DB-AC-28 - subscribe-buffer-replay-drain: no gap, no duplicate, strictly increasing
    const first = await connect(base);
    await helloSeen(first);
    const last = hello(first).lastSeq;
    first.close();

    const posts = Array.from({ length: 50 }, (_, i) => createTicket(`Concurrent ${i}`));
    const resumed = connect(base, { headers: { 'last-event-id': String(last) } });
    const results = await Promise.all(posts);
    expect(results.every((r) => r.status === 201)).toBe(true);
    const c = await resumed;
    const expected = await dbSeqsAfter(last);
    expect(expected.length).toBeGreaterThanOrEqual(50);
    await c.waitFor(() => domainSeqs(c).length >= expected.length, 10_000);
    // settle: a late duplicate would show up after the last expected seq
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(domainSeqs(c)).toEqual(expected);
  });

  it('sends resync "ahead" when the client id is beyond the journal', async () => {
    // contract: API-AC-60 - N > lastSeq -> resync{reason:ahead} after hello, nothing replayed
    const lastSeq = await dbLastSeq();
    const c = await connect(base, { headers: { 'last-event-id': String(lastSeq + 100) } });
    await c.waitFor((ms) => ms.some((m) => m.event === 'resync'));
    expect(c.messages().map((m) => m.event)).toEqual(['hello', 'resync']);
    const msg = c.messages()[1];
    expect(ResyncMessage.parse(JSON.parse(msg?.data ?? '{}'))).toMatchObject({
      reason: 'ahead',
      lastSeq,
    });
  });

  it('sends resync "below_floor" for a pre-reset id after the dataset was reset', async () => {
    // contract: API-AC-60 / DB-AC-30 - an id from before a reset is below the new floor -> resync{below_floor}
    const before = await dbLastSeq();
    await testApp.close();
    const reset = createResetCommand({ databaseUrl: testDatabaseUrl() });
    let floor: number;
    try {
      floor = await reset.run();
    } finally {
      await reset.close();
    }
    expect(floor).toBeGreaterThan(before);
    await start();
    const c = await connect(base, { headers: { 'last-event-id': String(before) } });
    await c.waitFor((ms) => ms.some((m) => m.event === 'resync'));
    const resync = ResyncMessage.parse(
      JSON.parse(c.messages().find((m) => m.event === 'resync')?.data ?? '{}'),
    );
    expect(resync).toMatchObject({ reason: 'below_floor', journalFloorSeq: floor });
    expect(domainSeqs(c)).toEqual([]);
  });

  it('sends resync "too_far_behind" when the client is more than 5000 events behind', async () => {
    // contract: API-AC-61 - lastSeq - N > 5000 -> resync{too_far_behind}, no replay
    await handle.db.execute(sql`select setval(pg_get_serial_sequence('events', 'seq'), 6000)`);
    expect((await createTicket('Far ahead')).status).toBe(201);
    const [state] = await handle.db.select().from(simulationState);
    const floor = state?.journalFloorSeq ?? 1;
    const c = await connect(base, { headers: { 'last-event-id': String(floor) } });
    await c.waitFor((ms) => ms.some((m) => m.event === 'resync'));
    const resync = ResyncMessage.parse(
      JSON.parse(c.messages().find((m) => m.event === 'resync')?.data ?? '{}'),
    );
    expect(resync.reason).toBe('too_far_behind');
    expect(resync.lastSeq - floor).toBeGreaterThan(5000);
    expect(domainSeqs(c)).toEqual([]);
  });

  it('delivers every event of 100 commits to two clients within 500 ms (p95)', async () => {
    // contract: ADR-0004 - committed events reach open streams promptly (p95 < 500 ms), identically for every client
    const a = await connect(base);
    const b = await connect(base);
    await helloSeen(a);
    await helloSeen(b);
    const last = hello(a).lastSeq;
    const latencies: number[] = [];
    let produced = 0;
    for (let i = 0; produced < 100; i += 1) {
      // NOTE: real wall-clock timing is the point of this test; it is the only place performance.now() is read.
      const t0 = performance.now();
      expect((await createTicket(`Latency ${i}`)).status).toBe(201);
      const seqs = await dbSeqsAfter(last);
      const newest = String(seqs.at(-1));
      await Promise.all([a, b].map((c) => c.waitFor(() => c.arrivals.has(newest))));
      for (const c of [a, b]) latencies.push((c.arrivals.get(newest) ?? Infinity) - t0);
      produced = seqs.length;
    }
    const expected = await dbSeqsAfter(last);
    await Promise.all([a, b].map((c) => c.waitFor(() => domainSeqs(c).length >= expected.length)));
    expect(domainSeqs(a)).toEqual(expected);
    expect(domainSeqs(b)).toEqual(expected);
    latencies.sort((x, y) => x - y);
    expect(latencies[Math.floor(latencies.length * 0.95)] ?? Infinity).toBeLessThan(500);
  });

  it(
    'emits an id-less keepalive event within the 15 s interval',
    async () => {
      // contract: API-AC-62 / plan Q1 - at least every 15 s: `event: keepalive`, data {} (EventSource-visible), plus a ": keepalive" comment
      const c = await connect(base);
      await helloSeen(c);
      await c.waitFor(
        (ms) => ms.some((m) => m.event === 'keepalive'),
        KEEPALIVE_INTERVAL_MS + 2000,
      );
      const k = c.messages().find((m) => m.event === 'keepalive');
      expect(k?.id).toBeUndefined();
      expect(JSON.parse(k?.data ?? 'null')).toEqual({});
      expect(c.raw()).toContain(': keepalive');
    },
    KEEPALIVE_INTERVAL_MS + 8000,
  );
});

describe('events are published only after commit', () => {
  let app: FastifyInstance;
  let fanOut: SseFanOut;

  beforeEach(async () => {
    fanOut = new SseFanOut();
    app = Fastify();
    await app.register(
      streamRoutes({
        journal: new EventsRepository(handle.db),
        subscriber: fanOut,
        scheduler: createIntervalScheduler(),
        hello: () => Promise.resolve({ clock: '2026-01-01T00:00:00.000Z', playing: false }),
      }),
      { prefix: '/api' },
    );
    base = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    for (const c of open.splice(0)) c.close();
    app.server.closeAllConnections();
    await app.close();
  });

  it('streams nothing for a rolled-back command and releases the subscription when the client disconnects', async () => {
    // contract: DB-AC-42 / ADR-0004 - a command that throws after appending events publishes nothing; a later commit is delivered
    const uow = makeUow(handle, fanOut);
    const c = await connect(base);
    await helloSeen(c);
    expect(fanOut.size).toBe(1);
    const before = await dbLastSeq();

    await expect(
      uow.run(async (tx) => {
        await tx.appendEvents([movedDraft('rolled back')]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await dbLastSeq()).toBe(before);

    await uow.run((tx) => tx.appendEvents([movedDraft('committed')]));
    await c.waitFor(() => domainSeqs(c).length >= 1);
    const received = c.messages().filter((m) => m.id !== undefined);
    expect(received).toHaveLength(1);
    expect(JSON.stringify(JSON.parse(received[0]?.data ?? '{}'))).toContain('committed');
    expect(JSON.stringify(c.messages())).not.toContain('rolled back');

    c.close();
    const deadline = Date.now() + 3000;
    while (fanOut.size > 0 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    expect(fanOut.size).toBe(0);
  });
});
