import { operatorTransition, type AssignTicketBody } from '@agent-ops/shared';
import { DomainRefusal, STATUS_LABEL, type EventDraft } from '../../../domain/index.js';
import type { UnitOfWork } from '../../ports/unit-of-work.js';
import {
  commitEvents,
  startWork,
  type CommandOutcome,
  type SimScripts,
} from '../../services/ticket-work.js';

export interface AssignTicketDeps {
  uow: UnitOfWork;
  scripts: SimScripts;
}

/**
 * Operator assigns a ticket to a free agent (API-AC-19, AC-20). The assignment is an Operator event
 * (`claim:false`), never an agent_report claim (D-5).
 */
export async function assignTicket(
  deps: AssignTicketDeps,
  ticketId: string,
  body: AssignTicketBody,
): Promise<CommandOutcome> {
  return deps.uow.run(async (tx) => {
    const current = await tx.tickets.get(ticketId);
    if (!current) throw new DomainRefusal('not_found', `Ticket ${ticketId} not found.`);
    if (current.status !== body.expectedStatus) {
      throw new DomainRefusal(
        'stale_state',
        `${current.id} is now in ${STATUS_LABEL[current.status]}.`,
      );
    }
    const cell = operatorTransition(current.status, 'in_progress');
    if (cell.kind !== 'assign') {
      throw new DomainRefusal('transition_refused', cell.reason ?? 'Assign refused.', {
        ...(cell.reason ? { reason: cell.reason } : {}),
      });
    }
    const agent = await tx.agents.get(body.agentId);
    if (!agent) throw new DomainRefusal('not_found', `Agent ${body.agentId} not found.`);
    if (agent.currentTicketId !== null) {
      throw new DomainRefusal(
        'agent_busy',
        `${agent.id} is busy with ${agent.currentTicketId} — one ticket per agent.`,
      );
    }

    const events: EventDraft[] = [];
    const started = await startWork(
      tx,
      deps.scripts,
      { ticket: current, agent, source: 'operator', from: current.status },
      events,
    );
    const seq = await commitEvents(tx, events);
    return { seq, ticket: started.ticket, agent: started.agent, session: started.session };
  });
}
