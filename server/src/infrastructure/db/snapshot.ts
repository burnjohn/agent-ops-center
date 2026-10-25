import type { ReadQueries, SnapshotReader } from '../../application/ports/read-queries.js';
import type { Tx } from '../fixture/load-fixture.js';
import { EventsRepository } from '../repositories/events.repository.js';
import type { DbHandle } from './client.js';

/** Builds the read queries (except the journal) bound to one snapshot transaction. Injected by `container.ts`. */
export type ReadQueriesFactory = (tx: Tx) => Omit<ReadQueries, 'journal'>;

/**
 * A snapshot transaction owns one pg connection, which runs one query at a time. Use cases fan reads out with
 * `Promise.all`; queueing every call here keeps the driver from receiving overlapping `client.query()` calls
 * (pg DeprecationWarning, removed in pg@9). Calls still start in the order they were made.
 */
function serializer(): <T extends object>(target: T) => T {
  let tail: Promise<unknown> = Promise.resolve();
  return <T extends object>(target: T): T =>
    new Proxy(target, {
      get(obj, prop, receiver) {
        const value: unknown = Reflect.get(obj, prop, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          const run = (): unknown => (value as (...a: unknown[]) => unknown).apply(obj, args);
          const result = tail.then(run, run);
          tail = result.catch(() => undefined);
          return result;
        };
      },
    });
}

/**
 * Reads run in one REPEATABLE READ, READ ONLY transaction (DB-AC-29). The snapshot is taken by the first
 * statement, which reads `max(seq)`: `asOfSeq` is therefore exactly what the data includes, because commands
 * hold the events lock until COMMIT and `seq` follows commit order.
 */
export class PgSnapshotReader implements SnapshotReader {
  constructor(
    private readonly handle: DbHandle,
    private readonly queriesFactory: ReadQueriesFactory,
  ) {}

  read<T>(fn: (q: ReadQueries) => Promise<T>): Promise<{ data: T; asOfSeq: number }> {
    return this.handle.guard((db) =>
      db.transaction(
        async (tx) => {
          const journal = new EventsRepository(tx);
          const asOfSeq = await journal.lastSeq();
          const serialized = serializer();
          const q: ReadQueries = serialized({
            ...this.queriesFactory(tx),
            journal: serialized(journal),
          });
          return { data: await fn(q), asOfSeq };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      ),
    );
  }
}
