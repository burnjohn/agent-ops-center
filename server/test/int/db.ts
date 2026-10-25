import { getTableName, sql } from 'drizzle-orm';
import { afterAll } from 'vitest';
import { createDb, type Db, type DbHandle } from '../../src/infrastructure/db/client.js';
import { loadFixtureIfEmpty } from '../../src/infrastructure/fixture/load-fixture.js';
import * as schema from '../../src/infrastructure/db/schema.js';
import { testDatabaseUrl } from './env.js';

export { testDatabaseUrl };

const TABLES = [
  schema.modelPrices,
  schema.tickets,
  schema.agents,
  schema.sessions,
  schema.sessionLogEntries,
  schema.events,
  schema.simulationState,
  schema.agentSimState,
  schema.idCounters,
];

/** Opens a pool on the test DB; closed automatically after the calling test file. */
export function openTestDb(): DbHandle {
  const handle = createDb(testDatabaseUrl());
  afterAll(() => handle.close());
  return handle;
}

/** Empties every table (all named in one statement: they reference each other). Keeps the schema. */
export async function truncateAll(db: Db): Promise<void> {
  const names = TABLES.map((t) => `"${getTableName(t)}"`).join(', ');
  await db.execute(sql.raw(`truncate table ${names} restart identity`));
}

/** Test isolation: TRUNCATE everything, then load the seed fixture. Call in `beforeEach`. */
export async function freshFixture(db: Db): Promise<void> {
  await truncateAll(db);
  await loadFixtureIfEmpty(db);
}

class Rollback extends Error {}

/** Runs `fn` in a transaction that is always rolled back; returns its result. */
export async function withTx<T>(
  db: Db,
  fn: (tx: Parameters<Parameters<Db['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  try {
    await db.transaction(async (tx) => {
      result = await fn(tx);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  return result as T;
}
