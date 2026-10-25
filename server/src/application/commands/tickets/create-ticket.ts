import type { CreateTicketBody } from '@agent-ops/shared';
import { eventBuilders, ticket as ticketRules } from '../../../domain/index.js';
import type { UnitOfWork } from '../../ports/unit-of-work.js';
import { commitEvents, type CommandOutcome } from '../../services/ticket-work.js';

export interface CreateTicketDeps {
  uow: UnitOfWork;
}

/** API-AC-7/8: a Backlog ticket with the next `T-<n>` id; one transaction, one `ticket.created`. */
export async function createTicket(
  deps: CreateTicketDeps,
  input: CreateTicketBody,
): Promise<CommandOutcome> {
  return deps.uow.run(async (tx) => {
    const now = tx.clock.now();
    const number = await tx.nextNumber('ticket');
    const created = ticketRules.createTicket({
      number,
      title: input.title,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria,
      priority: input.priority,
      now,
    });
    await tx.tickets.insert(created);
    const seq = await commitEvents(tx, [
      eventBuilders.ticketCreated({ at: now, ticketId: created.id }, created),
    ]);
    return { seq, ticket: created };
  });
}
