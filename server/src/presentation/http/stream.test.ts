import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Event, HelloMessage, KEEPALIVE_INTERVAL_MS, ResyncMessage } from '@agent-ops/shared';
import type {
  EventJournal,
  EventListener,
  EventSubscriber,
  Scheduler,
} from '../../application/ports/index.js';
import { MAX_REPLAY_BEHIND, parseSeq, streamRoutes } from './stream.js';

const CLOCK = '2026-01-01T00:00:00.000Z';

function ev(seq: number): Event {
  return {
    seq,
    type: 'agent.heartbeat',
    at: CLOCK,
    realAt: CLOCK,
    source: 'agent_telemetry',
    category: 'agent',
    agentId: null,
    ticketId: null,
    sessionId: null,
    warn: false,
    payload: { summary: `e${seq}` },
  } as Event;
}

class FakeJournal implements EventJournal {
  events: Event[] = [];
  floorSeq = 1;
  /** Runs once, the first time `since` is called (to commit "during replay"). */
  onFirstSince: (() => void) | undefined;
  constructor(count = 0, floor = 1) {
    this.floorSeq = floor;
    for (let i = floor; i < floor + count; i += 1) this.events.push(ev(i));
  }
  since(seq: number, limit: number): Promise<Event[]> {
    const hook = this.onFirstSince;
    this.onFirstSince = undefined;
    hook?.();
    return Promise.resolve(this.events.filter((e) => e.seq > seq).slice(0, limit));
  }
  floor(): Promise<number> {
    return Promise.resolve(this.floorSeq);
  }
  lastSeq(): Promise<number> {
    return Promise.resolve(this.events.at(-1)?.seq ?? 0);
  }
  page(): Promise<Event[]> {
    return Promise.resolve([]);
  }
  latestForTicket(): Promise<Event[]> {
    return Promise.resolve([]);
  }
  latestForAgent(): Promise<Event[]> {
    return Promise.resolve([]);
  }
  perMinuteCounts(): Promise<number[]> {
    return Promise.resolve([]);
  }
}

class FakeSubscriber implements EventSubscriber {
  readonly listeners = new Set<EventListener>();
  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  publish(events: Event[]): void {
    for (const l of [...this.listeners]) l(events);
  }
}

class FakeScheduler implements Scheduler {
  readonly timers = new Map<number, { ms: number; fn: () => void | Promise<void> }>();
  private nextId = 1;
  every(ms: number, fn: () => void | Promise<void>): () => void {
    const id = this.nextId++;
    this.timers.set(id, { ms, fn });
    return () => {
      this.timers.delete(id);
    };
  }
  tick(): void {
    for (const t of [...this.timers.values()]) void t.fn();
  }
}

interface Msg {
  id?: string;
  event: string;
  data: unknown;
}

function parse(text: string): Msg[] {
  const out: Msg[] = [];
  for (const block of text.split('\n\n')) {
    if (block.trim() === '' || block.startsWith(':')) continue;
    const msg: Msg = { event: 'message', data: undefined };
    for (const line of block.split('\n')) {
      if (line.startsWith('id: ')) msg.id = line.slice(4);
      else if (line.startsWith('event: ')) msg.event = line.slice(7);
      else if (line.startsWith('data: ')) msg.data = JSON.parse(line.slice(6));
    }
    out.push(msg);
  }
  return out;
}

interface Opened {
  headers: Record<string, unknown>;
  status: number;
  read(): string;
  waitFor(pred: (text: string) => boolean): Promise<string>;
  close(): void;
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function open(
  journal: FakeJournal,
  subscriber: FakeSubscriber,
  scheduler: FakeScheduler,
  req: { url?: string; headers?: Record<string, string> } = {},
): Promise<Opened> {
  const instance = Fastify();
  app = instance;
  await instance.register(
    streamRoutes({
      journal,
      subscriber,
      scheduler,
      hello: () => Promise.resolve({ clock: CLOCK, playing: true }),
    }),
    {
      prefix: '/api',
    },
  );
  const res = await instance.inject({
    method: 'GET',
    url: req.url ?? '/api/stream',
    headers: req.headers ?? {},
    payloadAsStream: true,
  });
  let text = '';
  const waiters: { pred: (t: string) => boolean; resolve: (t: string) => void }[] = [];
  res.stream().on('data', (chunk: Buffer) => {
    text += chunk.toString('utf8');
    for (const w of [...waiters]) {
      if (w.pred(text)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(text);
      }
    }
  });
  return {
    headers: res.headers,
    status: res.statusCode,
    read: () => text,
    waitFor: (pred) =>
      pred(text)
        ? Promise.resolve(text)
        : new Promise((resolve) => waiters.push({ pred, resolve })),
    close: () => res.raw.res.destroy(),
  };
}

const seqsOf = (msgs: Msg[]): number[] =>
  msgs.filter((m) => m.id !== undefined).map((m) => Number(m.id));
const hasSeq = (n: number) => (t: string) => t.includes(`id: ${n}\n`);
const hasEvent = (name: string) => (t: string) => t.includes(`event: ${name}\n`);

describe('parseSeq', () => {
  it('treats anything but a plain non-negative integer as absent', () => {
    // contract: a garbage Last-Event-ID behaves like no header at all (API-AC-58)
    expect(parseSeq('42')).toBe(42);
    expect(parseSeq('0')).toBe(0);
    for (const bad of ['abc', '-1', '1.5', '', ' 3', '1e3', undefined, 7])
      expect(parseSeq(bad)).toBeUndefined();
  });
});

describe('GET /api/stream (hermetic)', () => {
  it('opens with SSE headers and a hello carrying lastSeq, journalFloorSeq, clock and playing', async () => {
    // contract: API-AC-58 - first message is hello; content-type event-stream, no caching
    const s = await open(new FakeJournal(3), new FakeSubscriber(), new FakeScheduler());
    const text = await s.waitFor(hasEvent('hello'));
    expect(s.status).toBe(200);
    expect(String(s.headers['content-type'])).toContain('text/event-stream');
    expect(String(s.headers['cache-control'])).toContain('no-cache');
    const msgs = parse(text);
    expect(msgs[0]?.event).toBe('hello');
    expect(msgs[0]?.id).toBeUndefined();
    expect(HelloMessage.parse(msgs[0]?.data)).toEqual({
      lastSeq: 3,
      journalFloorSeq: 1,
      clock: CLOCK,
      playing: true,
    });
    // no resume point -> nothing replayed
    expect(seqsOf(msgs)).toEqual([]);
    s.close();
  });

  it('sends live events with id equal to seq, in order', async () => {
    // contract: each domain event is framed with id = seq and event = type
    const sub = new FakeSubscriber();
    const s = await open(new FakeJournal(2), sub, new FakeScheduler());
    await s.waitFor(hasEvent('hello'));
    await settle();
    sub.publish([ev(3), ev(4)]);
    const text = await s.waitFor(hasSeq(4));
    const msgs = parse(text).filter((m) => m.id !== undefined);
    expect(msgs.map((m) => [m.id, m.event])).toEqual([
      ['3', 'agent.heartbeat'],
      ['4', 'agent.heartbeat'],
    ]);
    s.close();
  });

  it('Last-Event-ID resumes with every seq > N exactly once, in order, across replay pages', async () => {
    // contract: API-AC-59 - resume from N delivers N+1..last, no duplicates (1200 events spans 3 replay pages)
    const journal = new FakeJournal(1200);
    const s = await open(journal, new FakeSubscriber(), new FakeScheduler(), {
      headers: { 'last-event-id': '100' },
    });
    const text = await s.waitFor(hasSeq(1200));
    const seqs = seqsOf(parse(text));
    expect(seqs).toEqual(Array.from({ length: 1100 }, (_, i) => 101 + i));
    s.close();
  });

  it('falls back to ?since= and prefers the header when both are given', async () => {
    // contract: API-AC-59 - ?since=N is equivalent to Last-Event-ID: N; the header wins
    const a = await open(new FakeJournal(10), new FakeSubscriber(), new FakeScheduler(), {
      url: '/api/stream?since=7',
    });
    expect(seqsOf(parse(await a.waitFor(hasSeq(10))))).toEqual([8, 9, 10]);
    a.close();
    await app?.close();
    const b = await open(new FakeJournal(10), new FakeSubscriber(), new FakeScheduler(), {
      url: '/api/stream?since=2',
      headers: { 'last-event-id': '8' },
    });
    expect(seqsOf(parse(await b.waitFor(hasSeq(10))))).toEqual([9, 10]);
    b.close();
  });

  it('treats a garbage Last-Event-ID as absent (no replay, no resync)', async () => {
    // contract: unparsable id == no id: hello only
    const sub = new FakeSubscriber();
    const s = await open(new FakeJournal(5), sub, new FakeScheduler(), {
      headers: { 'last-event-id': 'nonsense' },
    });
    await s.waitFor(hasEvent('hello'));
    await settle();
    sub.publish([ev(6)]);
    const msgs = parse(await s.waitFor(hasSeq(6)));
    expect(msgs.map((m) => m.event)).toEqual(['hello', 'agent.heartbeat']);
    s.close();
  });

  it('hands over replay to live with no gap and no duplicate when events commit during replay', async () => {
    // contract: API-AC-59 / DB-AC-28 - events published while the replay is reading are neither lost nor repeated
    const journal = new FakeJournal(10);
    const sub = new FakeSubscriber();
    journal.onFirstSince = () => {
      // commit 11..13 during replay: visible to the journal (after the first page read) and published live
      journal.events.push(ev(11), ev(12), ev(13));
      sub.publish([ev(11), ev(12), ev(13)]);
    };
    const s = await open(journal, sub, new FakeScheduler(), { headers: { 'last-event-id': '5' } });
    await s.waitFor(hasSeq(13));
    await settle();
    sub.publish([ev(14)]);
    const seqs = seqsOf(parse(await s.waitFor(hasSeq(14))));
    expect(seqs).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
    s.close();
  });

  it.each([
    {
      name: 'ahead',
      resume: '99',
      journal: () => new FakeJournal(5),
      expected: { reason: 'ahead', lastSeq: 5, journalFloorSeq: 1 },
    },
    {
      name: 'below_floor',
      resume: '3',
      journal: () => new FakeJournal(5, 10),
      expected: { reason: 'below_floor', lastSeq: 14, journalFloorSeq: 10 },
    },
    {
      name: 'too_far_behind',
      resume: '1',
      journal: () => new FakeJournal(MAX_REPLAY_BEHIND + 10),
      expected: { reason: 'too_far_behind', lastSeq: MAX_REPLAY_BEHIND + 10, journalFloorSeq: 1 },
    },
  ])('sends resync reason $name and replays nothing', async ({ resume, journal, expected }) => {
    // contract: API-AC-60/61 - an unusable resume point yields hello, then resync with the reason, then live only
    const sub = new FakeSubscriber();
    const j = journal();
    const s = await open(j, sub, new FakeScheduler(), { headers: { 'last-event-id': resume } });
    await s.waitFor(hasEvent('resync'));
    await settle();
    const next = j.events.at(-1)!.seq + 1;
    sub.publish([ev(next)]);
    const msgs = parse(await s.waitFor(hasSeq(next)));
    expect(msgs.map((m) => m.event)).toEqual(['hello', 'resync', 'agent.heartbeat']);
    expect(ResyncMessage.parse(msgs[1]?.data)).toEqual(expected);
    expect(seqsOf(msgs)).toEqual([next]);
    s.close();
  });

  it('resumes exactly at the boundary (N == lastSeq, N == 5000 behind) without resync', async () => {
    // contract: ahead means strictly greater than lastSeq; too_far_behind means strictly more than 5000
    const s = await open(
      new FakeJournal(MAX_REPLAY_BEHIND + 1),
      new FakeSubscriber(),
      new FakeScheduler(),
      {
        headers: { 'last-event-id': '1' },
      },
    );
    const text = await s.waitFor(hasSeq(MAX_REPLAY_BEHIND + 1));
    expect(parse(text).some((m) => m.event === 'resync')).toBe(false);
    expect(seqsOf(parse(text))).toHaveLength(MAX_REPLAY_BEHIND);
    s.close();
  });

  it('sends an id-less keepalive event on the 15 s schedule and cleans up when the client disconnects', async () => {
    // contract: API-AC-62 - keepalive at least every 15 s (event: keepalive, data {}); disconnect releases subscription and timer
    const sub = new FakeSubscriber();
    const sched = new FakeScheduler();
    const s = await open(new FakeJournal(1), sub, sched);
    await s.waitFor(hasEvent('hello'));
    expect([...sched.timers.values()].map((t) => t.ms)).toEqual([KEEPALIVE_INTERVAL_MS]);
    expect(sub.listeners.size).toBe(1);
    sched.tick();
    const text = await s.waitFor(hasEvent('keepalive'));
    const keepalive = parse(text).find((m) => m.event === 'keepalive');
    expect(keepalive).toEqual({ event: 'keepalive', data: {} });
    expect(text).toContain(': keepalive\n\n');
    s.close();
    await vi.waitUntil(() => sub.listeners.size === 0 && sched.timers.size === 0);
  });
});

/** Lets the route finish setup (the hello write precedes going live by a few microtasks). */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
