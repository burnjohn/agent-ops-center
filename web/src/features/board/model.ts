import { TICKET_STATUSES, type Ticket, type TicketStatus } from '@agent-ops/shared';
import { ALL_AGENTS, type BoardFilters } from './filters';

export const BOARD_COLUMNS: readonly TicketStatus[] = TICKET_STATUSES;

/** UI-AC-33: a card is `UPDATED` while its last change is at most 7 s of Simulation Clock old. */
export const UPDATED_WINDOW_MS = 7000;

export const isBlocked = (t: Pick<Ticket, 'status' | 'blockedQuestion'>): boolean =>
  t.status === 'in_progress' && t.blockedQuestion !== null;

export function isJustUpdated(t: Pick<Ticket, 'updatedAt'>, clock: string | undefined): boolean {
  if (!clock) return false;
  const age = Date.parse(clock) - Date.parse(t.updatedAt);
  return age >= 0 && age <= UPDATED_WINDOW_MS;
}

export function matchesFilters(t: Ticket, f: BoardFilters): boolean {
  if (f.agentId !== ALL_AGENTS && t.assigneeId !== f.agentId) return false;
  if (f.blockedOnly && !isBlocked(t)) return false;
  return true;
}

/** Cards per column keep the order the server sent (UI-AC-36). */
export function groupByStatus(tickets: readonly Ticket[]): Record<TicketStatus, Ticket[]> {
  const out: Record<TicketStatus, Ticket[]> = {
    backlog: [],
    ready: [],
    in_progress: [],
    review: [],
    done: [],
  };
  for (const t of tickets) out[t.status].push(t);
  return out;
}

/** UI-AC-37. */
export function emptyText(status: TicketStatus, filtering: boolean): string {
  if (filtering) return 'Nothing matches the filter';
  return status === 'backlog' ? 'Create a ticket to start' : 'Nothing here';
}

export const DRAG_FOOTER =
  'Drag a card to a highlighted column. Moving to In Progress asks which agent takes it; work leaves an agent only by releasing it to Ready, with confirmation. Only the agent submits for review. Without a mouse: open a ticket and use its Move buttons.';
