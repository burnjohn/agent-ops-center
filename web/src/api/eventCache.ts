import type { InfiniteData, Query, QueryClient, QueryKey } from '@tanstack/react-query';
import type { Event, EventType, HelloMessage } from '@agent-ops/shared';
import type { SimulationState } from '@agent-ops/shared';
import type { Snapshot } from './client';
import { keys } from './keys';

/**
 * Applies stream events to the TanStack Query cache (ADR-0011, UI-AC-23/24/25).
 * Rule: an event only touches a query whose snapshot predates it (`asOfSeq < event.seq`).
 */

function snapshotSeq(data: unknown): number | null {
  if (data && typeof data === 'object') {
    if ('pages' in data) {
      const pages = (data as InfiniteData<Snapshot<unknown>>).pages;
      const seqs = pages.map((p) => p.asOfSeq).filter((s): s is number => s !== null);
      return seqs.length > 0 ? Math.min(...seqs) : null;
    }
    if ('asOfSeq' in data) return (data as Snapshot<unknown>).asOfSeq;
  }
  return null;
}

/** True when the cached snapshot already includes `seq`. */
function includes(query: Query, seq: number): boolean {
  const asOf = snapshotSeq(query.state.data);
  return asOf !== null && asOf >= seq;
}

function invalidate(qc: QueryClient, seq: number, ...queryKeys: QueryKey[]): void {
  for (const queryKey of queryKeys) {
    void qc.invalidateQueries({ queryKey, predicate: (q) => !includes(q, seq) });
  }
}

/** Invalidate every query that a read at or before `seq` could have missed (first connect). */
export function invalidateStale(qc: QueryClient, seq: number): void {
  void qc.invalidateQueries({ predicate: (q) => !includes(q, seq) && q.state.data !== undefined });
}

function patchSimulation(
  qc: QueryClient,
  seq: number,
  patch: (s: SimulationState) => Partial<SimulationState>,
): void {
  // Nothing cached yet (hello/event beat the Simulation read): refetch so the read — possibly in flight
  // with an older snapshot — cannot overwrite what the stream just told us (UI-AC-24/31).
  if (!qc.getQueryData(keys.simulation())) {
    // An in-flight fetch without data is not restarted by invalidation, so cancel it first.
    void qc
      .cancelQueries({ queryKey: keys.simulation() })
      .then(() => qc.invalidateQueries({ queryKey: keys.simulation() }));
    return;
  }
  qc.setQueryData<Snapshot<SimulationState>>(keys.simulation(), (old) => {
    if (!old) return old;
    if (old.asOfSeq !== null && old.asOfSeq >= seq) return old;
    return {
      data: { ...old.data, ...patch(old.data), lastSeq: Math.max(old.data.lastSeq, seq) },
      asOfSeq: seq,
    };
  });
}

/** `hello` carries the authoritative Simulation Clock and Play state (UI-AC-31). */
export function applyHello(qc: QueryClient, hello: HelloMessage): void {
  patchSimulation(qc, hello.lastSeq, () => ({
    clock: hello.clock,
    playing: hello.playing,
    journalFloorSeq: hello.journalFloorSeq,
  }));
}

/** `resync`: refetch what is on screen, drop the rest (UI-AC-32). */
export function applyResync(qc: QueryClient): void {
  void qc.refetchQueries({ type: 'active' });
  qc.removeQueries({ type: 'inactive' });
}

type Handler = (qc: QueryClient, event: Event) => void;

const ticketKeys = (e: Event): QueryKey[] => [
  keys.tickets(),
  keys.overview(),
  keys.agents(),
  ...(e.ticketId ? [keys.ticket(e.ticketId)] : []),
  ...(e.agentId ? [keys.agent(e.agentId)] : []),
  keys.sessionsAll(),
  keys.eventsAll(),
];

const agentKeys = (e: Event): QueryKey[] => [
  keys.agents(),
  keys.overview(),
  ...(e.agentId ? [keys.agent(e.agentId)] : []),
  ...(e.ticketId ? [keys.ticket(e.ticketId)] : []),
  keys.eventsAll(),
];

const sessionKeys = (e: Event): QueryKey[] => [
  keys.sessionsAll(),
  ['usage'],
  keys.overview(),
  keys.agents(),
  ...(e.sessionId ? [keys.session(e.sessionId)] : []),
  ...(e.agentId ? [keys.agent(e.agentId)] : []),
  ...(e.ticketId ? [keys.ticket(e.ticketId)] : []),
  keys.eventsAll(),
];

const onTicket: Handler = (qc, e) => invalidate(qc, e.seq, ...ticketKeys(e));
const onAgent: Handler = (qc, e) => invalidate(qc, e.seq, ...agentKeys(e));
const onSession: Handler = (qc, e) => invalidate(qc, e.seq, ...sessionKeys(e));

/** Journal-only types (`feed: false`) never touch the feed queries (UI-AC-103). */
const withoutFeed = (e: Event, list: QueryKey[]): QueryKey[] =>
  list.filter((k) => k[0] !== 'events');

/** One mapping per EventType; `satisfies` makes a missing type a compile error (ADR-0011). */
const handlers = {
  'ticket.created': onTicket,
  'ticket.moved': onTicket,
  'ticket.assigned': onTicket,
  'ticket.released': onTicket,
  'ticket.reopened': onTicket,
  'ticket.approved': onTicket,
  'ticket.changes_requested': onTicket,
  'ticket.unblocked': onTicket,
  'ticket.updated': onTicket,
  'ticket.blocked': onTicket,
  'ticket.answer_read': onTicket,
  'ticket.comment_read': onTicket,
  'ticket.submitted': onTicket,
  'agent.stage_changed': onAgent,
  'agent.refused': onAgent,
  'agent.connected': onAgent,
  'agent.heartbeat': (qc, e) => invalidate(qc, e.seq, ...withoutFeed(e, agentKeys(e))),
  'agent.health_changed': (qc, e) => invalidate(qc, e.seq, ...withoutFeed(e, agentKeys(e))),
  'tool.started': onSession,
  'tool.finished': onSession,
  'tool.failed': onSession,
  'session.started': (qc, e) => invalidate(qc, e.seq, ...withoutFeed(e, sessionKeys(e))),
  'session.ended': (qc, e) => invalidate(qc, e.seq, ...withoutFeed(e, sessionKeys(e))),
  'log.appended': (qc, e) =>
    invalidate(
      qc,
      e.seq,
      ...withoutFeed(e, [
        ...(e.sessionId ? [keys.session(e.sessionId)] : []),
        ...(e.agentId ? [keys.agent(e.agentId)] : []),
      ]),
    ),
  'simulation.stepped': (qc, e) => {
    if (e.type !== 'simulation.stepped') return;
    const { clock } = e.payload;
    patchSimulation(qc, e.seq, (s) => (clock > s.clock ? { clock } : {}));
  },
  'simulation.play_changed': (qc, e) => {
    if (e.type !== 'simulation.play_changed') return;
    const { playing } = e.payload;
    patchSimulation(qc, e.seq, () => ({ playing }));
  },
} as const satisfies Record<EventType, Handler>;

export function applyEvent(qc: QueryClient, event: Event): void {
  handlers[event.type](qc, event);
}
