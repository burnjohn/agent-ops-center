import { eq } from 'drizzle-orm';
import type { SimClock } from '../../application/ports/clock.js';
import type { TxContext, UnitOfWork } from '../../application/ports/unit-of-work.js';
import { addSeconds } from '../../domain/index.js';
import { simulationState } from '../db/schema.js';
import type { Tx } from '../fixture/load-fixture.js';

/**
 * Simulation Clock of one transaction (SIM-10). `SimClock` is synchronous, so the stored `clock_at` is read
 * once by `prime()` at the start of the transaction; `flush()` writes the advanced value before COMMIT.
 * A rolled-back transaction therefore also rolls the clock back.
 */
export class DbSimClock implements SimClock {
  private at: string | null = null;
  private dirty = false;

  constructor(private readonly tx: Tx) {}

  async prime(): Promise<void> {
    const [row] = await this.tx
      .select({ clockAt: simulationState.clockAt })
      .from(simulationState)
      .where(eq(simulationState.id, 1))
      .limit(1);
    if (row === undefined)
      throw new Error('simulation_state row is missing; the database is not seeded.');
    this.at = row.clockAt.toISOString();
  }

  now(): string {
    if (this.at === null) throw new Error('Simulation clock used before it was primed');
    return this.at;
  }

  advance(seconds: number): void {
    this.at = addSeconds(this.now(), seconds);
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.dirty || this.at === null) return;
    await this.tx
      .update(simulationState)
      .set({ clockAt: new Date(this.at) })
      .where(eq(simulationState.id, 1));
    this.dirty = false;
  }
}

/** Reads the clock inside the transaction before the command body runs. */
export function withPrimedClock(inner: UnitOfWork): UnitOfWork {
  return {
    run: (fn) =>
      inner.run(async (tx: TxContext) => {
        if (tx.clock instanceof DbSimClock) await tx.clock.prime();
        return fn(tx);
      }),
  };
}
