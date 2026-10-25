import { asc, eq } from 'drizzle-orm';
import type { TicketRepository } from '../../application/ports/repositories.js';
import type { TicketState } from '../../domain/index.js';
import type { Db } from '../db/client.js';
import { tickets } from '../db/schema.js';
import type { Tx } from '../fixture/load-fixture.js';
import { ticketToDomain, ticketToPatch, ticketToRow } from './mappers.js';

/** Tickets as stored; no delete path exists (DB-AC-41). Built per transaction with that tx handle. */
export class TicketsRepository implements TicketRepository {
  constructor(private readonly q: Db | Tx) {}

  async get(id: string): Promise<TicketState | null> {
    const [row] = await this.q.select().from(tickets).where(eq(tickets.id, id)).limit(1);
    return row === undefined ? null : ticketToDomain(row);
  }

  async list(): Promise<TicketState[]> {
    const rows = await this.q.select().from(tickets).orderBy(asc(tickets.number));
    return rows.map(ticketToDomain);
  }

  async insert(ticket: TicketState): Promise<void> {
    await this.q.insert(tickets).values(ticketToRow(ticket));
  }

  async update(ticket: TicketState): Promise<void> {
    await this.q.update(tickets).set(ticketToPatch(ticket)).where(eq(tickets.id, ticket.id));
  }
}

export const createTicketRepository = (q: Db | Tx): TicketRepository => new TicketsRepository(q);
