import { deriveHealth, type OverviewResponse } from '@agent-ops/shared';
import type { SnapshotReader } from '../ports/read-queries.js';

export const OVERVIEW_MINUTES = 12;

/** API-AC-26: agents online / total, Blocked and Review counts, 12 per-minute feed counts on the sim clock. */
export function getOverview(snapshots: SnapshotReader) {
  return snapshots.read(async (q): Promise<OverviewResponse> => {
    const sim = await q.simulation();
    const [raw, eventsPerMinute] = await Promise.all([
      q.overview(),
      q.journal.perMinuteCounts(sim.clockAt, OVERVIEW_MINUTES),
    ]);
    return {
      agentsOnline: raw.agents.filter((a) => deriveHealth(a, sim.clockAt) === 'online').length,
      agentsTotal: raw.agents.length,
      blockedTickets: raw.blockedCount,
      reviewTickets: raw.reviewCount,
      eventsPerMinute,
      clock: sim.clockAt,
    };
  });
}
