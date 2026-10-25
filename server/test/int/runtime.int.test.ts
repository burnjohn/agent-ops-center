import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isServerRunning } from '../../src/infrastructure/db/server-lock.js';
import { adminDatabaseUrl, testDatabaseName } from './env.js';
import { createTcpProxy, type TcpProxy } from './tcp-proxy.js';

const SERVER_DIR = fileURLToPath(new URL('../..', import.meta.url));
const WEB_INDEX = fileURLToPath(new URL('../../../web/dist/index.html', import.meta.url));
const PASSWORD = 's3cr3tpw'; // distinctive password injected into unreachable-DB URLs; must never be echoed

const baseName = `${testDatabaseName()}_rt`;
const admin = new URL(adminDatabaseUrl());
const PG_HOST = admin.hostname;
const PG_PORT = Number(admin.port === '' ? '5432' : admin.port);

function urlFor(db: string, port = PG_PORT, password?: string): string {
  const u = new URL(adminDatabaseUrl());
  if (password !== undefined) u.password = password;
  u.port = String(port);
  u.pathname = `/${db}`;
  return u.toString();
}

async function adminQuery(sql: string): Promise<void> {
  const c = new pg.Client({ connectionString: adminDatabaseUrl() });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

interface Proc {
  readonly child: ChildProcess;
  output(): string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

const running = new Set<ChildProcess>();

function run(script: string, env: Record<string, string>): Proc {
  const child = spawn(process.execPath, ['--import', 'tsx', script], {
    cwd: SERVER_DIR,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.add(child);
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString()));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('exit', (code, signal) => {
      running.delete(child);
      resolve({ code, signal });
    });
  });
  return { child, output: () => out, exited };
}

async function waitFor(
  cond: () => boolean | Promise<boolean>,
  what: string,
  ms = 30000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

interface Server extends Proc {
  readonly port: number;
  get(path: string): Promise<Response>;
  post(path: string, body?: unknown): Promise<Response>;
  stop(signal?: NodeJS.Signals): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

async function startServer(databaseUrl: string): Promise<Server> {
  const port = await freePort();
  const proc = run('src/main.ts', { DATABASE_URL: databaseUrl, PORT: String(port) });
  await Promise.race([
    waitFor(() => proc.output().includes('listening on'), 'server to listen'),
    proc.exited.then((e) => {
      throw new Error(`server exited early (${String(e.code)}): ${proc.output()}`);
    }),
  ]);
  const base = `http://127.0.0.1:${port}`;
  return {
    ...proc,
    port,
    get: (path) => fetch(base + path),
    post: (path, body) =>
      fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }),
    stop: async (signal = 'SIGTERM') => {
      proc.child.kill(signal);
      return proc.exited;
    },
  };
}

/** Drops volatile fields so a reset database can be compared with a clean start (API-AC-65). */
function normalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalise);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([k]) =>
            !['seq', 'realAt', 'asOfSeq', 'lastEventSeq', 'lastSeq', 'journalFloorSeq'].includes(k),
        )
        .map(([k, v]) => [k, normalise(v)]),
    );
  }
  return value;
}

async function snapshot(s: Server): Promise<unknown> {
  const out: Record<string, unknown> = {};
  for (const path of [
    '/api/tickets',
    '/api/agents',
    '/api/overview',
    '/api/simulation',
    '/api/model-prices',
  ]) {
    const res = await s.get(path);
    expect(res.status, path).toBe(200);
    out[path] = normalise(await res.json());
  }
  return out;
}

async function listLen(s: Server, path: string): Promise<number> {
  const body = (await (await s.get(path)).json()) as unknown[];
  return body.length;
}

let seq = 0;
let dbName = '';
const proxies: TcpProxy[] = [];

beforeAll(async () => {
  expect(baseName).not.toBe('agent_ops');
});

beforeEach(async () => {
  dbName = `${baseName}${seq++}`;
  await adminQuery(`drop database if exists "${dbName}" with (force)`);
  await adminQuery(`create database "${dbName}"`);
});

afterEach(async () => {
  for (const child of [...running]) child.kill('SIGKILL');
  await Promise.all([...running].map((c) => new Promise((r) => c.once('exit', r))));
  for (const p of proxies.splice(0)) await p.stop();
  await adminQuery(`drop database if exists "${dbName}" with (force)`);
});

afterAll(async () => {
  for (const child of running) child.kill('SIGKILL');
});

describe('startup (API-AC-63/64, DB-AC-6/7/37/38)', () => {
  it('applies migrations on an empty database and loads the fixture; restart keeps data and Play off', async () => {
    // contract: empty DB -> migrations + fixture (6 agents, 16 tickets); a restart keeps created
    // tickets, duplicates nothing and does not persist Play
    const url = urlFor(dbName);
    const first = await startServer(url);
    expect(await listLen(first, '/api/agents')).toBe(6);
    expect(await listLen(first, '/api/tickets')).toBe(16);

    const created = await first.post('/api/tickets', { title: 'Survives restart' });
    expect(created.status).toBe(201);
    expect((await first.post('/api/simulation/play')).status).toBe(200);
    const before = normalise(await (await first.get('/api/tickets')).json());

    // contract: SIGTERM is a graceful stop (exit 0)
    expect((await first.stop()).code).toBe(0);

    const second = await startServer(url);
    expect(await listLen(second, '/api/agents')).toBe(6);
    expect(await listLen(second, '/api/tickets')).toBe(17);
    expect(normalise(await (await second.get('/api/tickets')).json())).toEqual(before);
    const sim = (await (await second.get('/api/simulation')).json()) as { playing: boolean };
    expect(sim.playing).toBe(false);
  });

  it('holds the server lock while running and refuses a second server on the same database', async () => {
    // contract: only one server per database; the loser exits non-zero without listening
    const url = urlFor(dbName);
    const first = await startServer(url);
    expect(await isServerRunning(url)).toBe(true);

    const port = await freePort();
    const second = run('src/main.ts', { DATABASE_URL: url, PORT: String(port) });
    const exit = await second.exited;
    expect(exit.code).toBe(1);
    expect(second.output()).toMatch(/already running/i);
    await expect(fetch(`http://127.0.0.1:${port}/api/healthz`)).rejects.toThrow();
    expect((await first.get('/api/healthz')).status).toBe(200);
  });

  it.each(['SIGTERM', 'SIGINT'] as const)(
    '%s shuts down gracefully and releases the lock',
    async (signal) => {
      // contract: graceful shutdown exits 0 and frees the server lock so reset/start can proceed
      const url = urlFor(dbName);
      const s = await startServer(url);
      expect(await isServerRunning(url)).toBe(true);
      const exit = await s.stop(signal);
      expect(exit.code).toBe(0);
      expect(await isServerRunning(url)).toBe(false);
    },
  );
});

describe('start failures (API-AC-73, DB-AC-5)', () => {
  it('exits 1 naming the problem when DATABASE_URL is missing', async () => {
    // contract: missing DATABASE_URL -> non-zero exit, message names the variable, nothing listens
    const port = await freePort();
    const p = run('src/main.ts', { DATABASE_URL: '', PORT: String(port) });
    expect((await p.exited).code).toBe(1);
    expect(p.output()).toContain('DATABASE_URL');
    await expect(fetch(`http://127.0.0.1:${port}/api/healthz`)).rejects.toThrow();
  });

  it('exits 1 naming host:port/db and no password when the database is unreachable', async () => {
    // contract: unreachable DB -> non-zero exit, message has host:port/db, never the password
    const dead = await freePort(); // nothing listens here
    const port = await freePort();
    const p = run('src/main.ts', {
      DATABASE_URL: urlFor(dbName, dead, PASSWORD),
      PORT: String(port),
    });
    expect((await p.exited).code).toBe(1);
    expect(p.output()).toContain(`127.0.0.1:${dead}/${dbName}`);
    expect(p.output()).not.toContain(PASSWORD);
    await expect(fetch(`http://127.0.0.1:${port}/api/healthz`)).rejects.toThrow();
  });
});

describe('database outage (API-AC-69/70)', () => {
  it('answers 503 envelopes while the database is gone and recovers without restart', async () => {
    // contract: outage -> reads/commands 503 db_unavailable, healthz 503 {ok:false,db:"down"};
    // once the database is back the same process serves 200 again
    const proxy = await createTcpProxy({ host: PG_HOST, port: PG_PORT });
    proxies.push(proxy);
    const s = await startServer(urlFor(dbName, proxy.port));
    expect(await (await s.get('/api/healthz')).json()).toEqual({ ok: true, db: 'up' });

    await proxy.stop();

    const read = await s.get('/api/tickets');
    expect(read.status).toBe(503);
    expect(await read.json()).toMatchObject({
      error: { code: 'db_unavailable', message: expect.any(String) },
    });
    const cmd = await s.post('/api/tickets', { title: 'during outage' });
    expect(cmd.status).toBe(503);
    expect(await cmd.json()).toMatchObject({ error: { code: 'db_unavailable' } });
    const health = await s.get('/api/healthz');
    expect(health.status).toBe(503);
    expect(await health.json()).toEqual({ ok: false, db: 'down' });

    await proxy.start();

    await waitFor(
      async () => (await s.get('/api/healthz')).status === 200,
      'healthz to recover',
      10000,
    );
    expect(await listLen(s, '/api/tickets')).toBe(16);
    expect((await s.post('/api/tickets', { title: 'after outage' })).status).toBe(201);
    expect(s.child.exitCode).toBeNull();
  });

  // contract: the server lock must still be held after the database connection came back, otherwise a
  // reset could run against a live server (API-AC-66).
  it('still holds the server lock after a database outage', async () => {
    const proxy = await createTcpProxy({ host: PG_HOST, port: PG_PORT });
    proxies.push(proxy);
    const s = await startServer(urlFor(dbName, proxy.port));
    await proxy.stop();
    await proxy.start();
    await waitFor(
      async () => (await s.get('/api/healthz')).status === 200,
      'healthz to recover',
      10000,
    );
    expect(await isServerRunning(urlFor(dbName))).toBe(true);
  });
});

describe('reset command (API-AC-65/66, DB-AC-40)', () => {
  it('refuses while the server runs, then restores the clean-start state after stop', async () => {
    // contract: running server -> exit 1 "Stop the server first", data unchanged;
    // stopped -> reset makes every read equal the clean start modulo seq/realAt
    const url = urlFor(dbName);
    const s1 = await startServer(url);
    const clean = await snapshot(s1);
    expect((await s1.post('/api/tickets', { title: 'Dirty' })).status).toBe(201);
    const dirty = await snapshot(s1);
    expect(dirty).not.toEqual(clean);

    const refused = run('src/cli/reset.ts', { DATABASE_URL: url });
    expect((await refused.exited).code).toBe(1);
    expect(refused.output()).toContain('Stop the server first');
    expect(await snapshot(s1)).toEqual(dirty);

    await s1.stop();
    const ok = run('src/cli/reset.ts', { DATABASE_URL: url });
    expect((await ok.exited).code).toBe(0);

    const s2 = await startServer(url);
    expect(await snapshot(s2)).toEqual(clean);
  });
});

describe('network and static serving (API-AC-68)', () => {
  it('binds to loopback only', async () => {
    // contract: reachable on 127.0.0.1, refused on any other local interface address
    const s = await startServer(urlFor(dbName));
    expect(s.output()).toContain(`http://127.0.0.1:${s.port}`);
    expect((await s.get('/api/healthz')).status).toBe(200);
    const external = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i !== undefined && i.family === 'IPv4' && !i.internal);
    if (external !== undefined) {
      await expect(fetch(`http://${external.address}:${s.port}/api/healthz`)).rejects.toThrow();
    }
  });

  it('unknown /api routes answer a 404 envelope', async () => {
    // contract: unknown /api/* -> 404 error envelope, never the SPA shell
    const s = await startServer(urlFor(dbName));
    const res = await s.get('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it.skipIf(!existsSync(WEB_INDEX))(
    'serves web/dist with an SPA fallback for non-API GET paths',
    async () => {
      // contract: unknown client route -> index.html (HTML), /api stays JSON
      const s = await startServer(urlFor(dbName));
      const res = await s.get('/tickets/T-1');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toContain('<div id="root"');
    },
  );
});
