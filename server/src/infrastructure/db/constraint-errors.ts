import { ConstraintRace, type ConstraintRaceKind } from '../../application/ports/errors.js';

/** The fields of a `pg` DatabaseError that decide the mapping. */
interface PgErrorInfo {
  code: string;
  constraint: string | undefined;
}

// Constraint names come from schema.ts (T12). Mapping: SPEC-server-api §C3 "Constraint mapping".
const AGENT_BUSY = new Set(['tickets_assignee_active_uq', 'sessions_agent_running_uq']);
const COUNTER_COLLISION = new Set([
  'tickets_number_uq',
  'sessions_number_uq',
  'tickets_pkey',
  'sessions_pkey',
]);
const EMPTY_TITLE = new Set(['tickets_title_nonblank_ck']);

/** Lock/serialization failures: serialization_failure, deadlock_detected, lock_not_available, query_canceled. */
const STALE_CODES = new Set(['40001', '40P01', '55P03', '57014']);

/** Walks `cause` / AggregateError chains (drizzle wraps the driver error) and returns the pg error, if any. */
function findPgError(err: unknown, depth = 0): PgErrorInfo | null {
  if (err === null || typeof err !== 'object' || depth > 5) return null;
  const e = err as { code?: unknown; constraint?: unknown; cause?: unknown };
  if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) {
    return {
      code: e.code,
      constraint: typeof e.constraint === 'string' ? e.constraint : undefined,
    };
  }
  return findPgError(e.cause, depth + 1);
}

/** Classifies a database failure; `null` when it is not a constraint/lock failure (rethrow it as is). */
export function classifyConstraintError(err: unknown): ConstraintRaceKind | null {
  const pg = findPgError(err);
  if (pg === null) return null;
  if (STALE_CODES.has(pg.code)) return 'stale_state';
  const name = pg.constraint;
  if (pg.code === '23505') {
    if (name !== undefined && AGENT_BUSY.has(name)) return 'agent_busy';
    if (name !== undefined && COUNTER_COLLISION.has(name)) return 'counter_collision';
    return 'internal';
  }
  if (pg.code === '23514' && name !== undefined && EMPTY_TITLE.has(name)) return 'empty_title';
  // Other integrity violations (class 22 data, 23 integrity incl. FK/not-null/check, P0001 append-only trigger).
  if (pg.code.startsWith('22') || pg.code.startsWith('23') || pg.code === 'P0001')
    return 'internal';
  return null;
}

/** Returns a `ConstraintRace` for constraint/lock failures, otherwise `null`. */
export function toConstraintRace(err: unknown): ConstraintRace | null {
  if (err instanceof ConstraintRace) return err;
  const kind = classifyConstraintError(err);
  return kind === null ? null : new ConstraintRace(kind, undefined, { cause: err });
}
