import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const serverDir = `${repoRoot}server`;
const requireFromServer = createRequire(`${serverDir}/package.json`);

interface PgClient {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

export interface ServerControl {
  /** `http://127.0.0.1:<port>` of the current server (stable across stop/start within a worker). */
  readonly baseURL: string;
  readonly dbName: string;
  /** SIGTERM the server and wait until it has exited (releases the DB server lock). */
  stopServer(): Promise<void>;
  /** Start the server (migrates, loads the fixture if empty) and wait for `/api/healthz`. */
  startServer(): Promise<void>;
  /** Stop -> `server reset` CLI -> start: back to the seed fixture. Reset refuses while a server runs. */
  resetDb(): Promise<void>;
}

function loadEnvFile(): void {
  const path = `${repoRoot}.env`;
  if (existsSync(path)) process.loadEnvFile(path);
}

function dbBase(): string {
  loadEnvFile();
  return process.env['DATABASE_URL_TEST_BASE'] ?? 'postgres://agent_ops:agent_ops@127.0.0.1:5432';
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function admin<T>(run: (client: PgClient) => Promise<T>): Promise<T> {
  const pg = requireFromServer('pg') as {
    Client: new (options: { connectionString: string }) => PgClient;
  };
  const client = new pg.Client({ connectionString: `${dbBase()}/postgres` });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function recreateDb(name: string): Promise<void> {
  await admin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}"`);
  });
}

async function dropDb(name: string): Promise<void> {
  await admin((client) => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
}

async function waitForHealthy(
  baseURL: string,
  child: ChildProcess,
  output: () => string,
): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`server exited early (${child.exitCode})\n${output()}`);
    try {
      const response = await fetch(`${baseURL}/api/healthz`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`server did not become healthy\n${output()}`);
}

function createControl(port: number, dbName: string): ServerControl {
  const baseURL = `http://127.0.0.1:${port}`;
  const databaseUrl = `${dbBase()}/${dbName}`;
  let child: ChildProcess | null = null;

  const stopServer = async (): Promise<void> => {
    const running = child;
    child = null;
    if (running === null || running.exitCode !== null || running.pid === undefined) return;
    const exited = new Promise<void>((resolve) => running.once('exit', () => resolve()));
    // pnpm -> tsx -> node: signal the whole process group so the lock-holding node process shuts down.
    process.kill(-running.pid, 'SIGTERM');
    const killTimer = setTimeout(() => {
      if (running.pid !== undefined && running.exitCode === null)
        process.kill(-running.pid, 'SIGKILL');
    }, 10_000);
    await exited;
    clearTimeout(killTimer);
  };

  const startServer = async (): Promise<void> => {
    if (child !== null) throw new Error('server is already running');
    let log = '';
    const spawned = spawn('pnpm', ['--filter', '@agent-ops/server', 'start'], {
      cwd: repoRoot,
      detached: true,
      env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    spawned.stdout?.on('data', (chunk: Buffer) => (log += chunk.toString()));
    spawned.stderr?.on('data', (chunk: Buffer) => (log += chunk.toString()));
    child = spawned;
    try {
      await waitForHealthy(baseURL, spawned, () => log);
    } catch (err) {
      await stopServer();
      throw err;
    }
  };

  const resetDb = async (): Promise<void> => {
    await stopServer();
    const result = spawnSync('pnpm', ['--filter', '@agent-ops/server', 'reset'], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`reset failed\n${result.stdout}\n${result.stderr}`);
    await startServer();
  };

  return { baseURL, dbName, stopServer, startServer, resetDb };
}

export const test = base.extend<{ serverFreshPerFile: void }, { server: ServerControl }>({
  // One server + one `agent_ops_e2e_<suffix>` database per worker; created fresh, dropped at teardown.
  server: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern as the first parameter
    async ({}, provide) => {
      const suffix = process.env['AGENT_OPS_TEST_DB_SUFFIX'] ?? 'default';
      const dbName = `agent_ops_e2e_${suffix}`;
      await recreateDb(dbName);
      const control = createControl(await freePort(), dbName);
      await control.startServer();
      try {
        await provide(control);
      } finally {
        await control.stopServer();
        await dropDb(dbName);
      }
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  baseURL: async ({ server }, provide) => {
    await provide(server.baseURL);
  },
  // Each spec file starts from the seed fixture: reset when the worker moves on to another file.
  serverFreshPerFile: [
    async ({ server }, provide, testInfo) => {
      if (lastFile !== undefined && lastFile !== testInfo.file) await server.resetDb();
      lastFile = testInfo.file;
      await provide();
    },
    { auto: true },
  ],
});

let lastFile: string | undefined;

export { expect };
