import { asc, desc, eq, sql } from 'drizzle-orm';
import type { TicketState } from '../../domain/index.js';
import { tickets } from '../db/schema.js';
import type { Tx } from '../fixture/load-fixture.js';
import { ticketToDomain } from '../repositories/mappers.js';

const STATUS_RANK = sql`case ${tickets.status}
  when 'backlog' then 0 when 'ready' then 1 when 'in_progress' then 2 when 'review' then 3 else 4 end`;
const PRIORITY_RANK = sql`case ${tickets.priority} when 'high' then 0 when 'medium' then 1 else 2 end`;
const NOT_DONE = sql`${tickets.status} <> 'done'`;

/**
 * API-AC-23 order: board status order; within a status priority (high first) then creation order
 * (`created_at`, `number`); `done` by `updated_at` newest first (`number` as tie-break).
 */
export async function listTickets(q: Tx): Promise<TicketState[]> {
  const rows = await q
    .select()
    .from(tickets)
    .orderBy(
      asc(STATUS_RANK),
      asc(sql`case when ${NOT_DONE} then ${PRIORITY_RANK} end`),
      asc(sql`case when ${NOT_DONE} then ${tickets.createdAt} end`),
      asc(sql`case when ${NOT_DONE} then ${tickets.number} end`),
      desc(tickets.updatedAt),
      asc(tickets.number),
    );
  return rows.map(ticketToDomain);
}

export async function getTicket(q: Tx, id: string): Promise<TicketState | null> {
  const [row] = await q.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  return row === undefined ? null : ticketToDomain(row);
}
