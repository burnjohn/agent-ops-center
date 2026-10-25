import { getTableName, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { isServerRunning } from '../db/server-lock.js';
import {
  agentSimState,
  agents,
  events,
  idCounters,
  modelPrices,
  sessionLogEntries,
  sessions,
  simulationState,
  tickets,
} from '../db/schema.js';
import type { FixtureData } from './fixture-data.js';
import { insertFixture, lockEvents, readFixture } from './load-fixture.js';

export const SERVER_RUNNING_MESSAGE = 'Stop the server first';

export class ServerRunningError extends Error {
  constructor() {
    super(SERVER_RUNNING_MESSAGE);
    this.name = 'ServerRunningError';
  }
}

const ALL_TABLES = [
  modelPrices,
  tickets,
  agents,
  sessions,
  sessionLogEntries,
  events,
  simulationState,
  agentSimState,
  idCounters,
];

/**
 * Replaces all data with the seed fixture in one transaction. Refuses while a server holds the server lock.
 * `TRUNCATE ... CONTINUE IDENTITY` keeps `seq` rising past every earlier value; all tables are named in a
 * single statement because they reference each other. Any error rolls everything back. Returns the new floor.
 */
export async function resetToFixture(
  db: Db,
  databaseUrl: string,
  fixture: FixtureData = readFixture(),
): Promise<number> {
  if (await isServerRunning(databaseUrl)) throw new ServerRunningError();
  return db.transaction(async (tx) => {
    await lockEvents(tx);
    const names = ALL_TABLES.map((t) => `"${getTableName(t)}"`).join(', ');
    await tx.execute(sql.raw(`truncate table ${names} continue identity`));
    return insertFixture(tx, fixture);
  });
}
