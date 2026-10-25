import { eq } from 'drizzle-orm';
import type {
  SimulationRow,
  SimulationStateRepository,
} from '../../application/ports/repositories.js';
import type { Db } from '../db/client.js';
import { simulationState } from '../db/schema.js';
import type { Tx } from '../fixture/load-fixture.js';

/** The singleton `simulation_state` row (id = 1). The clock is advanced elsewhere (`SimClock`). */
export class SimulationStateRepo implements SimulationStateRepository {
  constructor(private readonly q: Db | Tx) {}

  async get(): Promise<SimulationRow> {
    const [r] = await this.q
      .select()
      .from(simulationState)
      .where(eq(simulationState.id, 1))
      .limit(1);
    if (r === undefined)
      throw new Error('simulation_state row is missing; the database is not seeded.');
    return {
      clockAt: r.clockAt.toISOString(),
      seed: r.seed,
      journalFloorSeq: r.journalFloorSeq,
      seededAt: r.seededAt.toISOString(),
    };
  }
}

export const createSimulationStateRepository = (q: Db | Tx): SimulationStateRepository =>
  new SimulationStateRepo(q);
