import { eq, sql } from 'drizzle-orm';
import type { Event } from '@agent-ops/shared';
import { ConstraintRace } from '../../application/ports/errors.js';
import type { EventPublisher } from '../../application/ports/publisher.js';
import type { TxContext, UnitOfWork } from '../../application/ports/unit-of-work.js';
import type { EventDraft } from '../../domain/index.js';
import { lockEvents, type Tx } from '../fixture/load-fixture.js';
import { EventsRepository } from '../repositories/events.repository.js';
import type { DbHandle } from './client.js';
import { toConstraintRace } from './constraint-errors.js';
import { idCounters } from './schema.js';

/** Everything in a `TxContext` that the unit of work does not provide itself (built by T17's repositories). */
export type TxRepos = Omit<TxContext, 'appendEvents' | 'nextNumber'> & {
  /** Persists in-memory state (e.g. the advanced clock) before COMMIT. */
  flush?(): Promise<void>;
};

/** Builds the state repositories bound to one transaction. Injected by `container.ts`. */
export type RepoFactory = (tx: Tx) => TxRepos;

const MAX_ATTEMPTS = 2; // counter collision: retry the command once, then `internal` (§C3)

/**
 * One command = one transaction (ADR-0009): BEGIN -> advisory lock (first statement, so `seq` follows commit
 * order and guards read the latest committed state) -> `fn` -> events inserted by `appendEvents` -> COMMIT ->
 * publish. Any throw rolls back and publishes nothing.
 */
export class PgUnitOfWork implements UnitOfWork {
  constructor(
    private readonly handle: DbHandle,
    private readonly repoFactory: RepoFactory,
    private readonly publisher: EventPublisher,
  ) {}

  async run<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const { result, committed } = await this.handle.guard((db) => this.attempt(db, fn));
        if (committed.length > 0) this.publishAfterCommit(committed);
        return result;
      } catch (err) {
        const race = toConstraintRace(err);
        if (race === null) throw err;
        if (race.kind === 'counter_collision') {
          if (attempt < MAX_ATTEMPTS) continue;
          throw new ConstraintRace('internal', 'Id counter collision persisted after retry', {
            cause: err,
          });
        }
        throw race;
      }
    }
  }

  private attempt<T>(
    db: DbHandle['db'],
    fn: (tx: TxContext) => Promise<T>,
  ): Promise<{ result: T; committed: Event[] }> {
    return db.transaction(async (tx) => {
      await lockEvents(tx);
      const repos = this.repoFactory(tx);
      const journal = new EventsRepository(tx);
      const committed: Event[] = [];
      const ctx: TxContext = {
        ...repos,
        appendEvents: async (drafts: readonly EventDraft[]) => {
          const written = await journal.append(drafts);
          committed.push(...written);
          return written;
        },
        nextNumber: async (counter) => {
          const [row] = await tx
            .update(idCounters)
            .set({ nextValue: sql`${idCounters.nextValue} + 1` })
            .where(eq(idCounters.name, counter))
            .returning({ next: idCounters.nextValue });
          if (row === undefined) throw new Error(`Missing id counter "${counter}"`);
          return row.next - 1;
        },
      };
      const result = await fn(ctx);
      await repos.flush?.();
      return { result, committed };
    });
  }

  /** The command already committed; a failing subscriber must not turn it into an error. */
  private publishAfterCommit(committed: readonly Event[]): void {
    try {
      this.publisher.publish(committed);
    } catch {
      // Live delivery is best effort: clients resume from the journal by `seq`.
    }
  }
}
