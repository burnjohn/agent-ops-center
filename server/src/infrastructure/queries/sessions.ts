import { and, asc, desc, eq, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type {
  SessionListQuery,
  SessionListRaw,
  SessionRow,
  SessionSort,
} from '../../application/ports/read-queries.js';
import { modelPrices, sessionLogEntries, sessions } from '../db/schema.js';
import type { Tx } from '../fixture/load-fixture.js';
import { loadSessionRows } from './ticket-detail.js';

const MIN_DAY = '0001-01-01';
const MAX_DAY = '9999-12-31';

/** `started_at` within the inclusive UTC days; the `all` sentinels are clamped to valid PG dates. */
export function dayRangeWhere(fromDay: string, toDay: string): SQL {
  const from = fromDay < MIN_DAY ? MIN_DAY : fromDay;
  const to = toDay > MAX_DAY ? MAX_DAY : toDay;
  return sql`(${sessions.startedAt} >= (${from}::timestamp at time zone 'UTC')
    and ${sessions.startedAt} < ((${to}::date + 1)::timestamp at time zone 'UTC'))`;
}

const s = (col: AnyColumn) => sql`coalesce(sum(${col}), 0)`;

/** Sort key per `SessionSort`; `cost` multiplies the token sums by the model price (numeric, per 1M). */
function sortKey(sort: SessionSort): SQL {
  const e = sessionLogEntries;
  const m = modelPrices;
  switch (sort) {
    case 'startedAt':
      return sql`${sessions.startedAt}`;
    case 'input':
      return s(e.inputTokens);
    case 'output':
      return s(e.outputTokens);
    case 'cacheRead':
      return s(e.cacheReadTokens);
    case 'cacheWrite':
      return s(e.cacheWriteTokens);
    case 'cost':
      return sql`(${s(e.inputTokens)} * ${m.inputPerM} + ${s(e.outputTokens)} * ${m.outputPerM}
        + ${s(e.cacheReadTokens)} * ${m.cacheReadPerM} + ${s(e.cacheWriteTokens)} * ${m.cacheWritePerM}) / 1000000`;
  }
}

/**
 * Sessions started in the UTC-day range, filtered by agent/model, sorted and paged; `total` ignores paging.
 * Ties break by session `number` ascending. Page ids are selected first (with the price join for `cost`),
 * then the rows are loaded with `loadSessionRows` and put back in page order.
 */
export async function listSessions(q: Tx, query: SessionListQuery): Promise<SessionListRaw> {
  const where = and(
    dayRangeWhere(query.fromDay, query.toDay),
    query.agentId === undefined ? undefined : eq(sessions.agentId, query.agentId),
    query.model === undefined ? undefined : eq(sessions.model, query.model),
  );
  const [totalRow] = await q
    .select({ n: sql<string>`count(*)` })
    .from(sessions)
    .where(where);
  const dir = query.order === 'asc' ? asc : desc;
  const key = sortKey(query.sort);
  const ids = await q
    .select({ id: sessions.id })
    .from(sessions)
    .innerJoin(modelPrices, eq(modelPrices.model, sessions.model))
    .leftJoin(sessionLogEntries, eq(sessionLogEntries.sessionId, sessions.id))
    .where(where)
    .groupBy(sessions.id, modelPrices.model)
    .orderBy(dir(key), asc(sessions.number))
    .limit(query.limit)
    .offset(query.offset);
  const order = ids.map((r) => r.id);
  if (order.length === 0) return { rows: [], total: Number(totalRow?.n ?? 0) };
  const rows = await loadSessionRows(q, inArray(sessions.id, order), [asc(sessions.number)]);
  const byId = new Map<string, SessionRow>(rows.map((r) => [r.session.id, r]));
  return {
    rows: order.flatMap((id) => {
      const r = byId.get(id);
      return r === undefined ? [] : [r];
    }),
    total: Number(totalRow?.n ?? 0),
  };
}
