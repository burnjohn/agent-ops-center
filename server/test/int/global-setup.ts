import pg from 'pg';
import { createDb } from '../../src/infrastructure/db/client.js';
import { runMigrations } from '../../src/infrastructure/db/migrate.js';
import { adminDatabaseUrl, testDatabaseName, testDatabaseUrl } from './env.js';

/** Creates the per-agent test database if missing and migrates it once per run. */
export default async function setup(): Promise<void> {
  const name = testDatabaseName();
  if (name === 'agent_ops') throw new Error('Refusing to run integration tests against agent_ops');

  const admin = new pg.Client({ connectionString: adminDatabaseUrl() });
  await admin.connect();
  try {
    const found = await admin.query('select 1 from pg_database where datname = $1', [name]);
    if (found.rowCount === 0) await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }

  const handle = createDb(testDatabaseUrl());
  try {
    await runMigrations(handle.db);
  } finally {
    await handle.close();
  }
}
