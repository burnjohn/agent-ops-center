import type { Agent } from '@agent-ops/shared';
import type { SnapshotReader } from '../ports/read-queries.js';
import { toAgent } from './list-agents.js';
import { priceMap } from './list-sessions.js';

/** API-AC-27: one agent; unknown id -> `data: null`. */
export function getAgent(snapshots: SnapshotReader, id: string) {
  return snapshots.read(async (q): Promise<Agent | null> => {
    const [sim, row, priceList] = await Promise.all([
      q.simulation(),
      q.getAgent(id),
      q.modelPrices(),
    ]);
    if (row === null) return null;
    const ticketId = row.agent.currentTicketId;
    const ticket = ticketId === null ? null : await q.getTicket(ticketId);
    return toAgent(row, ticket, sim.clockAt, priceMap(priceList));
  });
}
