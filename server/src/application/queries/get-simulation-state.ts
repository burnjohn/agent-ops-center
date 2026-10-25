import { DEFAULT_HEALTH_THRESHOLDS, type SimulationState } from '@agent-ops/shared';
import { formatTicketId } from '../../domain/index.js';
import type { SnapshotReader } from '../ports/read-queries.js';

/** In-memory runtime flags owned by the play control (not persisted). */
export interface SimulationRuntime {
  playing: boolean;
  held: boolean;
}

/** §C2 SimulationState. `nextTicketId` comes from the stored ticket counter. */
export function getSimulationState(snapshots: SnapshotReader, runtime: SimulationRuntime) {
  return snapshots.read(async (q): Promise<SimulationState> => {
    const [sim, next, lastSeq] = await Promise.all([
      q.simulation(),
      q.nextTicketNumber(),
      q.journal.lastSeq(),
    ]);
    const th = DEFAULT_HEALTH_THRESHOLDS;
    return {
      clock: sim.clockAt,
      playing: runtime.playing,
      held: runtime.held,
      lastSeq,
      journalFloorSeq: sim.journalFloorSeq,
      stepSeconds: 6,
      playIntervalMs: 1600,
      nextTicketId: formatTicketId(next),
      healthThresholds: {
        staleAfterSec: th.staleAfterSec as 30,
        offlineAfterSec: th.offlineAfterSec as 120,
        toolGraceSec: th.runningToolSec as 600,
      },
    };
  });
}
