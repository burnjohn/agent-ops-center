import { TICKET_ACTIVITY_MAX, type TicketDetailResponse } from '@agent-ops/shared';
import type { SnapshotReader } from '../ports/read-queries.js';
import { priceMap, toSummary } from './list-sessions.js';

/** API-AC-24: ticket + newest 30 feed events + its sessions newest first; unknown id -> `data: null`. */
export function getTicket(snapshots: SnapshotReader, id: string) {
  return snapshots.read(async (q): Promise<TicketDetailResponse | null> => {
    const ticket = await q.getTicket(id);
    if (ticket === null) return null;
    const [activity, rows, priceList] = await Promise.all([
      q.journal.latestForTicket(id, TICKET_ACTIVITY_MAX),
      q.ticketSessions(id),
      q.modelPrices(),
    ]);
    const prices = priceMap(priceList);
    const sessions = [...rows]
      .sort(
        (a, b) =>
          Date.parse(b.session.startedAt) - Date.parse(a.session.startedAt) ||
          b.session.number - a.session.number,
      )
      .map((r) => toSummary(r, prices));
    return { ticket, activity, sessions, dataSource: 'mock' };
  });
}
