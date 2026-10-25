import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { DbUnavailableError } from '../../application/ports/db-errors.js';
import { describeTarget } from '../config.js';

export type Db = NodePgDatabase;

export interface DbHandle {
  readonly pool: pg.Pool;
  readonly db: Db;
  /** Runs `fn`, converting connection failures into DbUnavailableError. */
  guard<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
]);

/** True for connection-level failures (refused, reset, terminated, admin shutdown, class 08). */
export function isConnectionError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; errors?: unknown; cause?: unknown };
  if (typeof e.code === 'string') {
    if (UNAVAILABLE_CODES.has(e.code)) return true;
    if (e.code.startsWith('08') || e.code === '57P01' || e.code === '57P02' || e.code === '57P03')
      return true;
  }
  if (
    typeof e.message === 'string' &&
    /connection terminated|connection ended|Client has encountered a connection error/i.test(
      e.message,
    )
  ) {
    return true;
  }
  if (Array.isArray(e.errors) && e.errors.some(isConnectionError)) return true; // AggregateError (dual-stack connect)
  return e.cause !== undefined && isConnectionError(e.cause);
}

/** Wraps connection errors into DbUnavailableError (message shows host:port/db only); rethrows anything else. */
export function toDbError(err: unknown, databaseUrl: string): never {
  if (err instanceof DbUnavailableError) throw err;
  if (isConnectionError(err)) {
    throw new DbUnavailableError(`Database unreachable at ${describeTarget(databaseUrl)}`, {
      cause: err,
    });
  }
  throw err;
}

export function createDb(databaseUrl: string): DbHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  // Idle-client errors (e.g. container restart) must not crash the process; the next query reconnects.
  pool.on('error', () => undefined);
  return {
    pool,
    db: drizzle(pool),
    guard: async <T>(fn: (db: Db) => Promise<T>): Promise<T> => {
      try {
        return await fn(drizzle(pool));
      } catch (err) {
        return toDbError(err, databaseUrl);
      }
    },
    close: () => pool.end(),
  };
}
