import { desc, eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { ModelTokens, SessionRow } from '../../application/ports/read-queries.js';
import { sessionLogEntries, sessions } from '../db/schema.js';
import type { Tx } from '../fixture/load-fixture.js';
import { sessionToDomain } from '../repositories/mappers.js';

/** `sum(bigint)` is `numeric` (a string over the wire); token counts stay far below 2^53. */
export const tokenSum = (col: AnyColumn) => sql<string>`coalesce(sum(${col}), 0)`;

/** Per-session token sums by type and the entry count. Sessions without entries get zeros. */
function sessionAgg(q: Tx) {
  const e = sessionLogEntries;
  return q
    .select({
      sessionId: e.sessionId,
      entryCount: sql<string>`count(*)`.as('entry_count'),
      input: tokenSum(e.inputTokens).as('input_sum'),
      output: tokenSum(e.outputTokens).as('output_sum'),
      cacheRead: tokenSum(e.cacheReadTokens).as('cache_read_sum'),
      cacheWrite: tokenSum(e.cacheWriteTokens).as('cache_write_sum'),
    })
    .from(e)
    .groupBy(e.sessionId)
    .as('agg');
}

/**
 * Sessions matching `where`, in `order`, with token sums and `entryCount`. Shared with agent-page and the
 * T19 session queries. All values are bound parameters.
 */
export async function loadSessionRows(
  q: Tx,
  where: SQL | undefined,
  order: SQL[],
  limit?: number,
): Promise<SessionRow[]> {
  const agg = sessionAgg(q);
  const query = q
    .select({
      s: sessions,
      entryCount: agg.entryCount,
      input: agg.input,
      output: agg.output,
      cacheRead: agg.cacheRead,
      cacheWrite: agg.cacheWrite,
    })
    .from(sessions)
    .leftJoin(agg, eq(agg.sessionId, sessions.id))
    .where(where)
    .orderBy(...order);
  const rows = await (limit === undefined ? query : query.limit(limit));
  return rows.map((r) => ({
    session: sessionToDomain(r.s, Number(r.entryCount ?? 0)),
    tokens: {
      input: Number(r.input ?? 0),
      output: Number(r.output ?? 0),
      cacheRead: Number(r.cacheRead ?? 0),
      cacheWrite: Number(r.cacheWrite ?? 0),
    },
  }));
}

/** Folds session rows into per-model sums (same shape as `ModelTokens`). */
export function sumByModel(rows: SessionRow[]): ModelTokens[] {
  const m = new Map<string, ModelTokens>();
  for (const { session, tokens } of rows) {
    const cur = m.get(session.model);
    if (cur === undefined) m.set(session.model, { model: session.model, tokens: { ...tokens } });
    else {
      cur.tokens.input += tokens.input;
      cur.tokens.output += tokens.output;
      cur.tokens.cacheRead += tokens.cacheRead;
      cur.tokens.cacheWrite += tokens.cacheWrite;
    }
  }
  return [...m.values()];
}

/**
 * All sessions that worked on a ticket, **newest first**: `started_at` desc, `number` desc as tie-break
 * (API-AC-24). Uses `sessions_ticket_started_idx`.
 */
export function ticketSessions(q: Tx, ticketId: string): Promise<SessionRow[]> {
  return loadSessionRows(q, eq(sessions.ticketId, ticketId), [
    desc(sessions.startedAt),
    desc(sessions.number),
  ]);
}
