import type { Event, EventCategory, EventSource } from '@agent-ops/shared';

export interface FeedPageQuery {
  /** Keyset: only events with `seq < beforeSeq`. */
  beforeSeq?: number | undefined;
  source?: EventSource | undefined;
  category?: EventCategory | undefined;
  agentId?: string | undefined;
  ticketId?: string | undefined;
  limit: number;
}

/** Read side of the append-only `events` journal (ADR-0009). Feeds exclude journal-only types. */
export interface EventJournal {
  /** Events with `seq > seq`, ascending, at most `limit` (all types, for stream replay). */
  since(seq: number, limit: number): Promise<Event[]>;
  /** Feed events, newest first. */
  page(query: FeedPageQuery): Promise<Event[]>;
  /** Newest feed events of a ticket, newest first (default 30). */
  latestForTicket(ticketId: string, limit?: number): Promise<Event[]>;
  /** Newest agent-report / telemetry feed events of an agent, newest first (default 16). */
  latestForAgent(agentId: string, limit?: number): Promise<Event[]>;
  /** Count of feed events per simulation minute for the `minutes` minutes ending at `endAt`, oldest first. */
  perMinuteCounts(endAt: string, minutes: number): Promise<number[]>;
  /** First `seq` of the current dataset (reset moves it). */
  floor(): Promise<number>;
  /** Highest committed `seq`, 0 when empty. */
  lastSeq(): Promise<number>;
}
