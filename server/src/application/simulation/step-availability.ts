import type { AgentSimState } from '../ports/repositories.js';
import type { AgentState, TicketState } from '../../domain/index.js';

export interface StepAvailability {
  available: boolean;
  reason: string | null;
}

export interface StepAvailabilityInput {
  agent: Pick<AgentState, 'id' | 'currentTicketId' | 'currentTool'>;
  /** The ticket the Operator named; defaults to the agent's own ticket (Agent query). */
  ticketId?: string | null;
  /** The agent's own ticket (when it has one). */
  ticket: TicketState | null;
  sim: Pick<AgentSimState, 'silent' | 'script'> | null;
}

/** API-AC-45: why Next step / Run to next stage is (not) available for an agent on a ticket. */
export function stepAvailability(input: StepAvailabilityInput): StepAvailability {
  const { agent, ticket, sim } = input;
  const named = input.ticketId ?? agent.currentTicketId;
  if (named === null) return { available: false, reason: null };
  if (agent.currentTicketId !== named || !ticket || ticket.id !== named) {
    return { available: false, reason: `${agent.id} is no longer on ${named}.` };
  }
  if (ticket.status === 'review') {
    return { available: false, reason: 'Waiting for your review' };
  }
  if (ticket.status !== 'in_progress') {
    return { available: false, reason: `${named} is not In Progress.` };
  }
  if (ticket.blockedQuestion !== null) {
    return { available: false, reason: 'Blocked — answer above to continue' };
  }
  if (sim?.silent) return { available: false, reason: `${agent.id} is not responding.` };
  const hasWork = (sim?.script.queue.length ?? 0) > 0 || agent.currentTool !== null;
  if (!hasWork)
    return { available: false, reason: `${agent.id} has nothing left to do on ${named}.` };
  return { available: true, reason: null };
}
