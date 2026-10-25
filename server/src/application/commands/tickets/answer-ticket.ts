import type { AnswerBody } from '@agent-ops/shared';
import {
  DomainRefusal,
  eventBuilders,
  ticket as ticketRules,
  type EventDraft,
} from '../../../domain/index.js';
import type { UnitOfWork } from '../../ports/unit-of-work.js';
import { commitEvents, type CommandOutcome, type SimScripts } from '../../services/ticket-work.js';

export interface AnswerTicketDeps {
  uow: UnitOfWork;
  scripts: SimScripts;
}

/**
 * Operator answers a Blocked ticket (API-AC-21): clears the question, stores the answer, queues
 * "read the answer" for the holding agent and emits `ticket.unblocked`.
 */
export async function answerTicket(
  deps: AnswerTicketDeps,
  ticketId: string,
  body: AnswerBody,
): Promise<CommandOutcome> {
  return deps.uow.run(async (tx) => {
    const current = await tx.tickets.get(ticketId);
    if (!current) throw new DomainRefusal('not_found', `Ticket ${ticketId} not found.`);

    const now = tx.clock.now();
    // Domain: not_blocked (409) before empty answer (400).
    const updated = ticketRules.answer(current, body.answer, now);
    await tx.tickets.update(updated);

    const agent = current.assigneeId ? await tx.agents.get(current.assigneeId) : null;
    if (agent) {
      const simState = await tx.simState.get(agent.id);
      if (simState) {
        await tx.simState.save({
          ...simState,
          script: deps.scripts.queueReadAnswer(simState.script, updated),
        });
      }
    }

    const events: EventDraft[] = [
      eventBuilders.ticketUnblocked(
        { at: now, agentId: agent?.id ?? null, ticketId: updated.id },
        updated.answer ?? body.answer,
        agent?.id ?? 'agent',
      ),
    ];
    const seq = await commitEvents(tx, events);
    return { seq, ticket: updated, ...(agent ? { agent } : {}) };
  });
}
