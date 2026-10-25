import { and, asc, desc, eq, gt, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { EVENT_CATALOGUE, EVENT_TYPES, type Event } from '@agent-ops/shared';
import type { EventJournal, FeedPageQuery } from '../../application/ports/event-journal.js';
import type { EventDraft } from '../../domain/index.js';
import type { Db } from '../db/client.js';
import { events, simulationState } from '../db/schema.js';
import type { Tx } from '../fixture/load-fixture.js';

type Row = typeof events.$inferSelect;

/** Types shown in feeds (`feed: true` in the catalogue); journal-only types go through the stream only. */
const FEED_TYPES: string[] = EVENT_TYPES.filter((t) => EVENT_CATALOGUE[t].feed);

const DEFAULT_TICKET_LIMIT = 30;
const DEFAULT_AGENT_LIMIT = 16;
const MINUTE_MS = 60_000;

function toEvent(r: Row): Event {
  // Rows were written from validated drafts and the DB checks source/category/type format.
  return {
    seq: r.seq,
    at: r.at.toISOString(),
    realAt: r.realAt.toISOString(),
    source: r.source,
    category: r.category,
    type: r.type,
    agentId: r.agentId,
    ticketId: r.ticketId,
    sessionId: r.sessionId,
    payload: r.payload,
    warn: r.warn,
  } as Event;
}

/**
 * The append-only `events` journal (ADR-0009): insert and select only — never update or delete.
 * Constructed per transaction (or per snapshot) with that transaction's handle.
 */
export class EventsRepository implements EventJournal {
  constructor(private readonly q: Db | Tx) {}

  /** Inserts drafts in order; `seq` is assigned by the database and follows the order given. */
  async append(drafts: readonly EventDraft[]): Promise<Event[]> {
    const out: Event[] = [];
    for (const d of drafts) {
      const [row] = await this.q
        .insert(events)
        .values({
          at: new Date(d.at),
          source: d.source,
          category: d.category,
          type: d.type,
          agentId: d.agentId,
          ticketId: d.ticketId,
          sessionId: d.sessionId,
          payload: d.payload,
          warn: d.warn,
        })
        .returning();
      if (row === undefined) throw new Error('Event insert returned no row');
      out.push(toEvent(row));
    }
    return out;
  }

  async since(seq: number, limit: number): Promise<Event[]> {
    const rows = await this.q
      .select()
      .from(events)
      .where(gt(events.seq, seq))
      .orderBy(asc(events.seq))
      .limit(limit);
    return rows.map(toEvent);
  }

  async page(query: FeedPageQuery): Promise<Event[]> {
    const conds: SQL[] = [inArray(events.type, FEED_TYPES)];
    if (query.beforeSeq !== undefined) conds.push(lt(events.seq, query.beforeSeq));
    if (query.source !== undefined) conds.push(eq(events.source, query.source));
    if (query.category !== undefined) conds.push(eq(events.category, query.category));
    if (query.agentId !== undefined) conds.push(eq(events.agentId, query.agentId));
    if (query.ticketId !== undefined) conds.push(eq(events.ticketId, query.ticketId));
    const rows = await this.q
      .select()
      .from(events)
      .where(and(...conds))
      .orderBy(desc(events.seq))
      .limit(query.limit);
    return rows.map(toEvent);
  }

  latestForTicket(ticketId: string, limit = DEFAULT_TICKET_LIMIT): Promise<Event[]> {
    return this.page({ ticketId, limit });
  }

  async latestForAgent(agentId: string, limit = DEFAULT_AGENT_LIMIT): Promise<Event[]> {
    const rows = await this.q
      .select()
      .from(events)
      .where(
        and(
          inArray(events.type, FEED_TYPES),
          eq(events.agentId, agentId),
          inArray(events.source, ['agent_report', 'agent_telemetry']),
        ),
      )
      .orderBy(desc(events.seq))
      .limit(limit);
    return rows.map(toEvent);
  }

  /**
   * Feed events per simulation minute on `at`, oldest first. Bucket `i` covers
   * `(endAt - (minutes - i) min, endAt - (minutes - 1 - i) min]`, so an event at `endAt` counts in the last one.
   */
  async perMinuteCounts(endAt: string, minutes: number): Promise<number[]> {
    const end = new Date(endAt).getTime();
    const start = new Date(end - minutes * MINUTE_MS);
    const rows = await this.q
      .select({
        // 0-based bucket index from the oldest minute
        bucket: sql<number>`(${minutes} - 1 - floor((extract(epoch from ${new Date(end)}::timestamptz) - extract(epoch from ${events.at}) ) / 60.0))::int`,
        n: sql<number>`count(*)::int`,
      })
      .from(events)
      .where(
        and(
          inArray(events.type, FEED_TYPES),
          gt(events.at, start),
          sql`${events.at} <= ${new Date(end)}`,
        ),
      )
      .groupBy(sql`1`);
    const counts = new Array<number>(minutes).fill(0);
    for (const r of rows) {
      if (r.bucket >= 0 && r.bucket < minutes) counts[r.bucket] = r.n;
    }
    return counts;
  }

  async floor(): Promise<number> {
    const [row] = await this.q
      .select({ floor: simulationState.journalFloorSeq })
      .from(simulationState)
      .limit(1);
    return row?.floor ?? 0;
  }

  async lastSeq(): Promise<number> {
    const [row] = await this.q
      .select({ max: sql<number>`coalesce(max(${events.seq}), 0)::float8` })
      .from(events);
    return Number(row?.max ?? 0);
  }
}
