import pg from 'pg';
import { SERVER_LOCK_KEY } from './locks.js';

export interface ServerLock {
  release(): Promise<void>;
}

export interface ServerLockOptions {
  /**
   * Called once when the lock was lost and another process holds it now. The safe behaviour is to stop serving
   * (the default in main.ts exits), because two servers on one database break the seq/commit-order guarantee.
   */
  onTaken?: () => void;
  log?: (message: string) => void;
  /** Reconnect backoff, ms (doubles up to maxMs). */
  backoff?: { initialMs: number; maxMs: number };
}

async function tryLock(client: pg.Client): Promise<boolean> {
  const res = await client.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [
    SERVER_LOCK_KEY,
  ]);
  return res.rows[0]?.ok === true;
}

/**
 * Takes the session-level server lock on a dedicated connection (not a pooled one, so it lives as long as the
 * process). Returns null when another server already holds it.
 *
 * A session lock dies with its connection. When the connection drops (DB outage/restart) the lock is re-acquired on
 * a fresh connection with backoff. If another process grabbed it meanwhile, `onTaken` fires (once) and no further
 * reconnects happen.
 */
export async function acquireServerLock(
  databaseUrl: string,
  opts: ServerLockOptions = {},
): Promise<ServerLock | null> {
  const log = opts.log ?? ((m: string) => console.error(m));
  const { initialMs, maxMs } = opts.backoff ?? { initialMs: 200, maxMs: 5000 };
  let closed = false;
  let current: pg.Client | null = null;
  let reconnecting = false;

  const open = async (): Promise<pg.Client | null> => {
    const client = new pg.Client({ connectionString: databaseUrl });
    client.on('error', () => handleLoss(client));
    client.on('end', () => handleLoss(client));
    await client.connect();
    if (!(await tryLock(client))) {
      client.removeAllListeners('end');
      await client.end().catch(() => undefined);
      return null;
    }
    return client;
  };

  const handleLoss = (client: pg.Client): void => {
    if (closed || client !== current || reconnecting) return;
    reconnecting = true;
    current = null;
    void reconnect();
  };

  const reconnect = async (): Promise<void> => {
    let delay = initialMs;
    log('server lock: database connection lost, re-acquiring the lock');
    while (!closed) {
      try {
        const client = await open();
        if (closed) {
          await client?.end().catch(() => undefined);
          return;
        }
        if (client === null) {
          log(
            'server lock: LOST - another process holds the server lock now; this server must stop',
          );
          reconnecting = false;
          opts.onTaken?.();
          return;
        }
        current = client;
        reconnecting = false;
        log('server lock: re-acquired');
        return;
      } catch {
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, maxMs);
      }
    }
  };

  const first = new pg.Client({ connectionString: databaseUrl });
  first.on('error', () => handleLoss(first));
  first.on('end', () => handleLoss(first));
  await first.connect();
  if (!(await tryLock(first))) {
    first.removeAllListeners('end');
    await first.end();
    return null;
  }
  current = first;
  return {
    release: async () => {
      closed = true;
      const client = current;
      current = null;
      if (client === null) return;
      await client.query('select pg_advisory_unlock($1)', [SERVER_LOCK_KEY]).catch(() => undefined);
      await client.end().catch(() => undefined);
    },
  };
}

/** Probe for reset: true when some server process currently holds the server lock. */
export async function isServerRunning(databaseUrl: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: databaseUrl });
  client.on('error', () => undefined);
  await client.connect();
  try {
    const res = await client.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [
      SERVER_LOCK_KEY,
    ]);
    if (res.rows[0]?.ok === true) {
      await client.query('select pg_advisory_unlock($1)', [SERVER_LOCK_KEY]);
      return false;
    }
    return true;
  } finally {
    await client.end();
  }
}
