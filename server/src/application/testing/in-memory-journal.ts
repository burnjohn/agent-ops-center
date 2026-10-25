import { isFeedEvent, type Event } from '@agent-ops/shared';
import type { EventJournal, FeedPageQuery } from '../ports/event-journal.js';
import type { InMemoryStore } from './in-memory-store.js';

export class InMemoryEventJournal implements EventJournal {
  constructor(private readonly store: InMemoryStore) {}

  private feed(): Event[] {
    return this.store.events.filter(isFeedEvent);
  }

  async since(seq: number, limit: number): Promise<Event[]> {
    return this.store.events.filter((e) => e.seq > seq).slice(0, limit);
  }

  async page(q: FeedPageQuery): Promise<Event[]> {
    return this.feed()
      .filter(
        (e) =>
          (q.beforeSeq === undefined || e.seq < q.beforeSeq) &&
          (q.source === undefined || e.source === q.source) &&
          (q.category === undefined || e.category === q.category) &&
          (q.agentId === undefined || e.agentId === q.agentId) &&
          (q.ticketId === undefined || e.ticketId === q.ticketId),
      )
      .sort((a, b) => b.seq - a.seq)
      .slice(0, q.limit);
  }

  async latestForTicket(ticketId: string, limit = 30): Promise<Event[]> {
    return this.page({ ticketId, limit });
  }

  async latestForAgent(agentId: string, limit = 16): Promise<Event[]> {
    return this.feed()
      .filter(
        (e) =>
          e.agentId === agentId && (e.source === 'agent_report' || e.source === 'agent_telemetry'),
      )
      .sort((a, b) => b.seq - a.seq)
      .slice(0, limit);
  }

  async perMinuteCounts(endAt: string, minutes: number): Promise<number[]> {
    const endMinute = Math.floor(Date.parse(endAt) / 60_000);
    const counts = new Array<number>(minutes).fill(0);
    for (const e of this.feed()) {
      const idx = Math.floor(Date.parse(e.at) / 60_000) - (endMinute - minutes + 1);
      if (idx >= 0 && idx < minutes) counts[idx] = (counts[idx] ?? 0) + 1;
    }
    return counts;
  }

  async floor(): Promise<number> {
    return this.store.data.simulation.journalFloorSeq;
  }

  async lastSeq(): Promise<number> {
    return this.store.events.at(-1)?.seq ?? 0;
  }
}
