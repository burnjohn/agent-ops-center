import { QueryClient, QueryObserver, type QueryKey } from '@tanstack/react-query';
import { EVENT_CATALOGUE, EventType, type Event, type HelloMessage } from '@agent-ops/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEvent, buildSimulation, buildTicket, seedSessionDetail } from '../test/fixtures';
import type { Snapshot } from './client';
import { applyEvent, applyHello, applyResync } from './eventCache';
import { keys } from './keys';

const T = 'T-1';
const A = 'alpha';
const S = 'S-0409';
const SNAPSHOT_SEQ = 10;
const EVENT_SEQ = 11;

// One valid payload per EventType. `satisfies Record<EventType, ...>` makes a new type a compile error here
// too, so this file cannot silently skip a type added to the contract (ADR-0011 Confirmation).
const logEntry = seedSessionDetail(S).entries[0];
const payloads = {
  'ticket.created': { summary: 's', ticket: buildTicket() },
  'ticket.moved': { summary: 's', from: 'backlog', to: 'ready' },
  'ticket.assigned': { summary: 's', from: 'ready', agentId: A, sessionId: S, claim: true },
  'ticket.released': { summary: 's', agentId: A },
  'ticket.reopened': { summary: 's', to: 'ready' },
  'ticket.approved': { summary: 's', agentId: A },
  'ticket.changes_requested': { summary: 's', comment: 'c', agentId: A, sessionId: S },
  'ticket.unblocked': { summary: 's', answer: 'a', agentId: A },
  'ticket.updated': { summary: 's', text: 't', progress: 50 },
  'ticket.blocked': { summary: 's', question: 'q' },
  'ticket.answer_read': { summary: 's' },
  'ticket.comment_read': { summary: 's' },
  'ticket.submitted': { summary: 's', reviewSummary: 'r', resultLink: 'l' },
  'agent.stage_changed': { summary: 's', from: 'idle', to: 'planning' },
  'agent.refused': { summary: 's', reason: 'r' },
  'agent.connected': { summary: 's' },
  'agent.heartbeat': { summary: 's' },
  'agent.health_changed': { summary: 's', from: 'online', to: 'stale' },
  'tool.started': { summary: 's', tool: 'Read', arg: 'x' },
  'tool.finished': { summary: 's', tool: 'Read', arg: 'x', durationSec: 1, result: 'ok' },
  'tool.failed': { summary: 's', tool: 'Read', arg: 'x', durationSec: 1, result: 'err' },
  'session.started': { summary: 's', model: 'm' },
  'session.ended': { summary: 's', status: 'completed' },
  'log.appended': { summary: 's', entry: logEntry },
  'simulation.stepped': {
    summary: 's',
    mode: 'step',
    clock: '2027-01-01T00:00:00Z',
    actedAgentIds: [],
  },
  'simulation.play_changed': { summary: 's', playing: true },
} as const satisfies Record<EventType, Record<string, unknown>>;

const snap = <T>(data: T, asOfSeq: number | null = SNAPSHOT_SEQ): Snapshot<T> => ({
  data,
  asOfSeq,
});

const FEED_KEY = keys.events({});

/** A cache holding one stale (pre-event) snapshot for every query family the app reads. */
function seededClient(asOfSeq = SNAPSHOT_SEQ): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const plain: QueryKey[] = [
    keys.tickets(),
    keys.overview(),
    keys.agents(),
    keys.ticket(T),
    keys.agent(A),
    keys.sessions({}),
    keys.session(S),
    keys.usage({}),
  ];
  for (const k of plain) qc.setQueryData(k, snap({}, asOfSeq));
  qc.setQueryData(FEED_KEY, { pages: [snap({ items: [] }, asOfSeq)], pageParams: [undefined] });
  qc.setQueryData(keys.simulation(), snap(buildSimulation(), asOfSeq));
  return qc;
}

const isInvalidated = (qc: QueryClient, key: QueryKey) =>
  qc.getQueryState(key)?.isInvalidated === true;

const event = (type: EventType, seq = EVENT_SEQ): Event =>
  buildEvent(seq, type, payloads[type], { agentId: A, ticketId: T, sessionId: S });

describe('eventCache', () => {
  const clients: QueryClient[] = [];
  const make = (asOfSeq?: number) => {
    const qc = seededClient(asOfSeq);
    clients.push(qc);
    return qc;
  };
  afterEach(() => {
    for (const qc of clients.splice(0)) qc.clear();
  });

  describe('ADR-0011: every EventType has a mapping', () => {
    it.each(EventType.options)('%s changes the cache and respects its feed flag', (type) => {
      const qc = make();

      applyEvent(qc, event(type));

      // Contract: each event type must visibly affect the cache — invalidate a read family or patch the
      // Simulation snapshot. A type with no effect would leave screens stale (UI-AC-23).
      const touchedReads = [
        keys.tickets(),
        keys.agents(),
        keys.overview(),
        keys.session(S),
        keys.agent(A),
      ].some((k) => isInvalidated(qc, k));
      const sim = qc.getQueryData<Snapshot<unknown>>(keys.simulation());
      const patchedSimulation = sim?.asOfSeq === EVENT_SEQ;
      expect(touchedReads || patchedSimulation).toBe(true);

      // Contract (UI-AC-103): the events feed is invalidated exactly when the catalogue marks the type as
      // a feed event; journal-only types never create or refresh feed rows.
      expect(isInvalidated(qc, FEED_KEY)).toBe(EVENT_CATALOGUE[type].feed);
    });

    it('covers the whole enum (guards the it.each above against an empty list)', () => {
      // Contract: the catalogue and the enum describe the same set of types.
      expect(new Set(Object.keys(EVENT_CATALOGUE))).toEqual(new Set(EventType.options));
      expect(EventType.options.length).toBeGreaterThan(0);
    });

    it('journal-only types never invalidate the feed, even with a filtered feed cached', () => {
      const qc = make();
      const filtered = keys.events({ category: 'tool' });
      qc.setQueryData(filtered, { pages: [snap({ items: [] })], pageParams: [undefined] });
      const journalOnly = EventType.options.filter((t) => !EVENT_CATALOGUE[t].feed);
      expect(journalOnly.length).toBeGreaterThan(0);

      for (const type of journalOnly) applyEvent(qc, event(type));

      // Contract (AC-103): no journal-only event reaches any `events` query.
      expect(isInvalidated(qc, FEED_KEY)).toBe(false);
      expect(isInvalidated(qc, filtered)).toBe(false);
    });
  });

  describe('snapshot rule (UI-AC-24)', () => {
    it('applies only events newer than the cached snapshot (asOfSeq 50: 49,50 skipped; 51,52 applied)', () => {
      const qc = make(50);

      applyEvent(qc, event('ticket.moved', 49));
      applyEvent(qc, event('ticket.moved', 50));
      // Contract: a snapshot that already includes the event is not invalidated.
      expect(isInvalidated(qc, keys.tickets())).toBe(false);

      applyEvent(qc, event('ticket.moved', 51));
      // Contract: an event newer than the snapshot invalidates it.
      expect(isInvalidated(qc, keys.tickets())).toBe(true);

      qc.setQueryData(keys.tickets(), snap({}, 52));
      applyEvent(qc, event('ticket.moved', 52));
      // Contract: replaying an already-included event is a no-op (duplicate ignored).
      expect(isInvalidated(qc, keys.tickets())).toBe(false);
    });

    it('does not patch the simulation snapshot with an event it already includes', () => {
      const qc = make(50);

      applyEvent(qc, event('simulation.play_changed', 50));
      // Contract: an old event must not overwrite fresher simulation state.
      expect(qc.getQueryData<Snapshot<{ playing: boolean }>>(keys.simulation())?.data.playing).toBe(
        false,
      );

      applyEvent(qc, event('simulation.play_changed', 51));
      const patched = qc.getQueryData<Snapshot<{ playing: boolean; lastSeq: number }>>(
        keys.simulation(),
      );
      // Contract: a newer event patches the snapshot in place and advances its seq.
      expect(patched?.data.playing).toBe(true);
      expect(patched?.asOfSeq).toBe(51);
    });

    it('simulation.stepped moves the clock forward only', () => {
      const qc = make();
      const clock = qc.getQueryData<Snapshot<{ clock: string }>>(keys.simulation())?.data.clock;

      applyEvent(qc, event('simulation.stepped', 11));
      // Contract: the payload clock (2027) is later than the seed clock, so the cache adopts it.
      expect(qc.getQueryData<Snapshot<{ clock: string }>>(keys.simulation())?.data.clock).toBe(
        '2027-01-01T00:00:00Z',
      );
      expect(clock).not.toBe('2027-01-01T00:00:00Z');

      const earlier = buildEvent(
        12,
        'simulation.stepped',
        { ...payloads['simulation.stepped'], clock: '2020-01-01T00:00:00Z' },
        {},
      );
      applyEvent(qc, earlier);
      // Contract: a stepped event never moves the Simulation Clock backwards.
      expect(qc.getQueryData<Snapshot<{ clock: string }>>(keys.simulation())?.data.clock).toBe(
        '2027-01-01T00:00:00Z',
      );
    });
  });

  describe('hello (UI-AC-31)', () => {
    it('overwrites clock, playing and journal floor from the server', () => {
      const qc = make();
      const hello: HelloMessage = {
        lastSeq: 20,
        journalFloorSeq: 3,
        clock: '2028-02-02T00:00:00Z',
        playing: true,
      };

      applyHello(qc, hello);

      // Contract: hello is authoritative for clock and Play state.
      const sim = qc.getQueryData<
        Snapshot<{ clock: string; playing: boolean; journalFloorSeq: number }>
      >(keys.simulation());
      expect(sim?.data).toMatchObject({ clock: hello.clock, playing: true, journalFloorSeq: 3 });
      expect(sim?.asOfSeq).toBe(20);
    });
  });

  describe('hello before the Simulation read is cached (UI-AC-24/31)', () => {
    it('makes the Simulation read refetch instead of dropping the hello', async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      clients.push(qc);
      let reads = 0;
      const observer = new QueryObserver(qc, {
        queryKey: keys.simulation(),
        queryFn: () => {
          reads += 1;
          return new Promise<Snapshot<unknown>>((resolve) =>
            setTimeout(() => resolve(snap(buildSimulation(), 5)), 5),
          );
        },
      });
      const unsubscribe = observer.subscribe(() => undefined);
      try {
        expect(qc.getQueryData(keys.simulation())).toBeUndefined();

        applyHello(qc, {
          lastSeq: 20,
          journalFloorSeq: 0,
          clock: '2028-02-02T00:00:00Z',
          playing: true,
        });

        // Contract: the in-flight read (older snapshot) is restarted so it reflects the hello.
        await new Promise((r) => setTimeout(r, 30));
        expect(reads).toBe(2);
        expect(qc.getQueryData(keys.simulation())).toBeDefined();
      } finally {
        unsubscribe();
      }
    });
  });

  describe('resync (UI-AC-32)', () => {
    it('refetches queries on screen and drops the ones nobody observes', async () => {
      const qc = make();
      let fetches = 0;
      const observer = new QueryObserver(qc, {
        queryKey: ['visible'],
        queryFn: () => {
          fetches += 1;
          return snap({}, 1);
        },
      });
      const unsubscribe = observer.subscribe(() => undefined);
      await qc.fetchQuery({ queryKey: ['visible'], queryFn: () => snap({}, 1), staleTime: 0 });
      const baseline = fetches;

      applyResync(qc);

      try {
        // Contract: the active query is refetched ...
        await new Promise((r) => setTimeout(r, 0));
        expect(fetches).toBeGreaterThan(baseline);
        // ... and every inactive cached query is removed so nothing stale survives.
        expect(qc.getQueryData(keys.tickets())).toBeUndefined();
        expect(qc.getQueryData(FEED_KEY)).toBeUndefined();
        expect(qc.getQueryData(['visible'])).toBeDefined();
      } finally {
        unsubscribe();
      }
    });
  });
});
