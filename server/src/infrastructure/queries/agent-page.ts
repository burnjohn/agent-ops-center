import { and, asc, count, desc, eq, gte, lt, or, sql } from 'drizzle-orm';
import type { AgentPageRaw } from '../../application/ports/read-queries.js';
import { events, sessionLogEntries, sessions, tickets } from '../db/schema.js';
import type { Tx } from '../fixture/load-fixture.js';
import { ticketToDomain } from '../repositories/mappers.js';
import { getAgent, readClock, utcDayRange } from './agents.js';
import { loadSessionRows, sumByModel } from './ticket-detail.js';

const WEEK_MS = 7 * 86_400_000;

/**
 * Raw agent-page reads. "Last 7 days" = `started_at` in `[clock - 7 d, clock]`; "today" = UTC day of the
 * simulation clock (never the wall clock). `recentSessions` are the 10 newest (`started_at` desc, `number`
 * desc), `sessionTotal` counts all of the agent's sessions.
 */
export async function agentPage(q: Tx, agentId: string): Promise<AgentPageRaw | null> {
  const row = await getAgent(q, agentId);
  if (row === null) return null;
  const clock = await readClock(q);
  const { start, end } = utcDayRange(clock);
  const weekStart = new Date(clock.getTime() - WEEK_MS);
  const mine = eq(sessions.agentId, agentId);
  const newestFirst = [desc(sessions.startedAt), desc(sessions.number)];

  const sessions7d = await loadSessionRows(
    q,
    and(mine, gte(sessions.startedAt, weekStart), sql`${sessions.startedAt} <= ${clock}`),
    newestFirst,
  );
  const recentSessions = await loadSessionRows(q, mine, newestFirst, 10);

  const [{ n: sessionTotal = 0 } = {}] = await q.select({ n: count() }).from(sessions).where(mine);
  const [{ n: doneTicketCount = 0 } = {}] = await q
    .select({ n: count() })
    .from(tickets)
    .where(and(eq(tickets.assigneeId, agentId), eq(tickets.status, 'done')));
  const [{ n: toolCallsToday = 0 } = {}] = await q
    .select({ n: count() })
    .from(sessionLogEntries)
    .innerJoin(sessions, eq(sessions.id, sessionLogEntries.sessionId))
    .where(
      and(
        mine,
        gte(sessions.startedAt, start),
        lt(sessions.startedAt, end),
        eq(sessionLogEntries.kind, 'tool'),
      ),
    );

  const ticketRows = await q
    .select()
    .from(tickets)
    .where(
      or(
        eq(tickets.assigneeId, agentId),
        sql`exists (select 1 from ${events} where ${events.agentId} = ${agentId} and ${events.ticketId} = "tickets"."id")`,
      ),
    )
    .orderBy(asc(tickets.number));

  return {
    row,
    sessions7d,
    doneTicketCount,
    toolCallsToday,
    tokens7d: sumByModel(sessions7d),
    recentSessions,
    sessionTotal,
    tickets: ticketRows.map(ticketToDomain),
  };
}
