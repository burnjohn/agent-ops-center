import { operatorTransition, type Priority, type TicketStatus } from '@agent-ops/shared';
import { secondsBetween, type TimeInput } from '../../lib/format';
import { STATUS_LABEL, STATUS_NUMBER } from '../../lib/labels';

/** A ticket is "just updated" while its last change is at most 7 s of Simulation Clock old (UI-AC-33). */
export const JUST_UPDATED_SEC = 7;

export function isJustUpdated(updatedAt: TimeInput, now: TimeInput | undefined): boolean {
  if (now === undefined) return false;
  return secondsBetween(updatedAt, now) <= JUST_UPDATED_SEC;
}

export const PRIORITY_BARS: Record<Priority, string> = { high: '▮▮▮', medium: '▮▮', low: '▮' };

export const statusBadge = (status: TicketStatus): string =>
  `${STATUS_NUMBER[status]} ${STATUS_LABEL[status].toUpperCase()}`;

export const MOVE_TARGETS: readonly TicketStatus[] = [
  'backlog',
  'ready',
  'in_progress',
  'review',
  'done',
];

/** `Move to In Progress…` asks for an agent; from Review it sends the ticket back without the ellipsis (UI-AC-71). */
export function moveLabel(from: TicketStatus, to: TicketStatus): string {
  const base = `Move to ${STATUS_LABEL[to]}`;
  return to === 'in_progress' && from !== 'review' ? `${base}…` : base;
}

/** Refusal reason of the Operator transition table, or undefined when the move is allowed. */
export function moveRefusal(from: TicketStatus, to: TicketStatus): string | undefined {
  const t = operatorTransition(from, to);
  return t.kind === 'refused' ? (t.reason ?? 'Not allowed') : undefined;
}

export const MOVE_NOTE =
  'In Progress asks which agent takes the ticket. Work leaves an agent only by releasing it to Ready, with confirmation. Only the agent submits for review.';

export const NO_ASSIGNEE_TEXT: Partial<Record<TicketStatus, string>> = {
  backlog: 'Nobody yet. Move it to Ready so an agent can pick it up.',
  ready: 'Waiting for the next free agent — agents take Ready tickets by priority, then age.',
  done: 'Finished.',
};

export const MAX_SESSION_ROWS = 6;
