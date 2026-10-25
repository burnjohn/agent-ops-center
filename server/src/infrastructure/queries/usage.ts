import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import type {
  ModelTokens,
  UsageQuery,
  UsageRaw,
  UsageTokens,
} from '../../application/ports/read-queries.js';
import type { TokenActivity } from '@agent-ops/shared';
import { sessionLogEntries, sessions } from '../db/schema.js';
import type { Tx } from '../fixture/load-fixture.js';
import { dayRangeWhere } from './sessions.js';
import { loadSessionRows, tokenSum } from './ticket-detail.js';

const e = sessionLogEntries;

function sums() {
  return {
    input: tokenSum(e.inputTokens),
    output: tokenSum(e.outputTokens),
    cacheRead: tokenSum(e.cacheReadTokens),
    cacheWrite: tokenSum(e.cacheWriteTokens),
  };
}

function tokens(r: { input: string; output: string; cacheRead: string; cacheWrite: string }) {
  return {
    input: Number(r.input),
    output: Number(r.output),
    cacheRead: Number(r.cacheRead),
    cacheWrite: Number(r.cacheWrite),
  };
}

/**
 * Usage of sessions started in the UTC-day range: sums by agent / ticket (null = no ticket), each per
 * (model, activity); per-UTC-day sums per model for days inside the range (oldest first); one row per
 * session for mean/median. Only entries that carry tokens are summed. Queries run sequentially.
 */
export async function getUsage(q: Tx, query: UsageQuery): Promise<UsageRaw> {
  const where = and(dayRangeWhere(query.fromDay, query.toDay), isNotNull(e.inputTokens));

  const grouped = async <K extends 'agentId' | 'ticketId'>(key: K) => {
    const col = sessions[key];
    const rows = await q
      .select({ key: col, model: sessions.model, activity: e.tokenActivity, ...sums() })
      .from(sessions)
      .innerJoin(e, eq(e.sessionId, sessions.id))
      .where(where)
      .groupBy(col, sessions.model, e.tokenActivity)
      .orderBy(asc(col), asc(sessions.model), asc(e.tokenActivity));
    const out = new Map<string | null, UsageTokens[]>();
    for (const r of rows) {
      const list = out.get(r.key) ?? [];
      list.push({
        model: r.model,
        activity: r.activity as TokenActivity | null,
        tokens: tokens(r),
      });
      out.set(r.key, list);
    }
    return out;
  };

  const byAgentMap = await grouped('agentId');
  const byTicketMap = await grouped('ticketId');

  const dayExpr = sql<string>`to_char(${sessions.startedAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const dayRows = await q
    .select({ day: dayExpr, model: sessions.model, ...sums() })
    .from(sessions)
    .innerJoin(e, eq(e.sessionId, sessions.id))
    .where(where)
    .groupBy(dayExpr, sessions.model)
    .orderBy(asc(dayExpr), asc(sessions.model));
  const perDay: UsageRaw['perDay'] = [];
  for (const r of dayRows) {
    const m: ModelTokens = { model: r.model, tokens: tokens(r) };
    const last = perDay.at(-1);
    if (last?.day === r.day) last.sums.push(m);
    else perDay.push({ day: r.day, sums: [m] });
  }

  const perSession = await loadSessionRows(q, dayRangeWhere(query.fromDay, query.toDay), [
    asc(sessions.startedAt),
    asc(sessions.number),
  ]);

  return {
    byAgent: [...byAgentMap].flatMap(([agentId, list]) =>
      agentId === null ? [] : [{ agentId, sums: list }],
    ),
    byTicket: [...byTicketMap].map(([ticketId, list]) => ({ ticketId, sums: list })),
    perDay,
    perSession,
  };
}
