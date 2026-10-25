import { asc, eq } from 'drizzle-orm';
import type { SessionDetailRaw } from '../../application/ports/read-queries.js';
import { sessionLogEntries, sessions } from '../db/schema.js';
import type { Tx } from '../fixture/load-fixture.js';
import { entryToDomain } from '../repositories/mappers.js';
import { loadSessionRows } from './ticket-detail.js';

/** Session header with token sums plus all entries ordered by `ordinal`, never by `at` (DB-AC-35). */
export async function getSessionDetail(q: Tx, id: string): Promise<SessionDetailRaw | null> {
  const [row] = await loadSessionRows(q, eq(sessions.id, id), [asc(sessions.number)], 1);
  if (row === undefined) return null;
  const entries = await q
    .select()
    .from(sessionLogEntries)
    .where(eq(sessionLogEntries.sessionId, id))
    .orderBy(asc(sessionLogEntries.ordinal));
  return { row, entries: entries.map(entryToDomain) };
}
