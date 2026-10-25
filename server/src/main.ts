import { loadDotEnv } from './cli/load-env.js';
import { createContainer } from './container.js';
import { describeTarget, loadConfig } from './infrastructure/config.js';
import { createDb, toDbError } from './infrastructure/db/client.js';
import { runMigrations } from './infrastructure/db/migrate.js';
import { acquireServerLock } from './infrastructure/db/server-lock.js';
import { loadFixtureIfEmpty } from './infrastructure/fixture/load-fixture.js';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** The driver's message (e.g. `database \"x\" does not exist`), not drizzle's query dump. */
function reason(err: unknown): string {
  const root = err instanceof Error && err.cause instanceof Error ? err.cause : err;
  return root instanceof Error ? root.message : String(root);
}

async function main(): Promise<void> {
  loadDotEnv();
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  // Connect, migrate, seed: any failure exits non-zero before the server listens.
  const bootstrap = createDb(config.databaseUrl);
  try {
    await bootstrap.guard((db) => db.execute('select 1'));
  } catch (err) {
    fail(
      err instanceof Error && err.name === 'DbUnavailableError'
        ? err.message
        : `Cannot use the database at ${describeTarget(config.databaseUrl)}: ${reason(err)}`,
    );
  }
  try {
    await runMigrations(bootstrap.db);
  } catch (err) {
    try {
      toDbError(err, config.databaseUrl);
    } catch (mapped) {
      fail(mapped instanceof Error ? mapped.message : String(mapped));
    }
  }

  const lock = await acquireServerLock(config.databaseUrl, {
    // Another process took the lock after an outage: stop serving rather than run two servers (API-AC-66).
    onTaken: () => process.exit(1),
  }).catch((err: unknown) => {
    try {
      return toDbError(err, config.databaseUrl);
    } catch (mapped) {
      return fail(mapped instanceof Error ? mapped.message : String(mapped));
    }
  });
  if (lock === null) {
    await bootstrap.close();
    fail('Another server is already running against this database.');
  }

  try {
    await loadFixtureIfEmpty(bootstrap.db);
  } catch (err) {
    await lock.release();
    fail(`Cannot load the seed fixture: ${err instanceof Error ? err.message : String(err)}`);
  }
  await bootstrap.close();

  const container = await createContainer(config);
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);
    await container.close();
    await lock.release();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await container.app.listen({ host: config.host, port: config.port });
  } catch (err) {
    await container.close();
    await lock.release();
    fail(
      `Cannot listen on ${config.host}:${config.port}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  console.log(
    `Agent Ops Center listening on http://${config.host}:${config.port} (database ${describeTarget(config.databaseUrl)})`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
