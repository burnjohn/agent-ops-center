import { PRIORITIES, TICKET_STATUSES, type Ticket } from '@agent-ops/shared';
import type { SnapshotReader } from '../ports/read-queries.js';

/** API-AC-23: by status; priority high->low then oldest first; Done by `updatedAt` newest first. */
export function listTickets(snapshots: SnapshotReader) {
  return snapshots.read(async (q): Promise<Ticket[]> => {
    const tickets = await q.listTickets();
    return [...tickets].sort((a, b) => {
      const byStatus = TICKET_STATUSES.indexOf(a.status) - TICKET_STATUSES.indexOf(b.status);
      if (byStatus !== 0) return byStatus;
      if (a.status === 'done') {
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.number - a.number;
      }
      return (
        PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) ||
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        a.number - b.number
      );
    });
  });
}
