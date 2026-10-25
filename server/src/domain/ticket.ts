import type { Priority, Ticket, TicketStatus } from '@agent-ops/shared';
import { DomainRefusal } from './errors.js';
import { formatTicketId } from './ids.js';

export type TicketState = Ticket;

export interface NewTicketInput {
  number: number;
  title: string;
  description?: string | undefined;
  acceptanceCriteria?: readonly string[] | undefined;
  priority?: Priority | undefined;
  now: string;
}

const touch = (t: TicketState, now: string, patch: Partial<TicketState>): TicketState => ({
  ...t,
  ...patch,
  updatedAt: now,
});

/** API-AC-7/8: trimmed non-empty title, criteria are non-empty trimmed lines, status Backlog. */
export function createTicket(input: NewTicketInput): TicketState {
  const title = input.title.trim();
  if (title === '') {
    throw new DomainRefusal('validation_failed', 'Title is required.', { path: 'title' });
  }
  return {
    id: formatTicketId(input.number),
    number: input.number,
    title,
    description: (input.description ?? '').trim(),
    acceptanceCriteria: (input.acceptanceCriteria ?? [])
      .map((l) => l.trim())
      .filter((l) => l !== ''),
    priority: input.priority ?? 'medium',
    status: 'backlog',
    assigneeId: null,
    blockedQuestion: null,
    answer: null,
    reviewSummary: null,
    resultLink: null,
    reviewComment: null,
    lastUpdate: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** Plain status change (Backlog <-> Ready). */
export function setStatus(t: TicketState, status: TicketStatus, now: string): TicketState {
  return touch(t, now, { status });
}

/** API-AC-19: In Progress for `agentId`; Blocked question and review comment cleared. */
export function assignTo(t: TicketState, agentId: string, now: string): TicketState {
  return touch(t, now, {
    status: 'in_progress',
    assigneeId: agentId,
    blockedQuestion: null,
    reviewComment: null,
  });
}

/** API-AC-13: back to Ready, no assignee, no Blocked question. */
export function release(t: TicketState, now: string): TicketState {
  return touch(t, now, { status: 'ready', assigneeId: null, blockedQuestion: null });
}

/** API-AC-14: Done -> Backlog | Ready, assignee cleared. */
export function reopen(t: TicketState, to: 'backlog' | 'ready', now: string): TicketState {
  return touch(t, now, { status: to, assigneeId: null });
}

/** API-AC-15: Done, Blocked question cleared (assignee kept as history). */
export function markDone(t: TicketState, now: string): TicketState {
  return touch(t, now, { status: 'done', blockedQuestion: null });
}

/** API-AC-16: Review -> Done. */
export function approve(t: TicketState, now: string): TicketState {
  return touch(t, now, { status: 'done' });
}

/** API-AC-17/18: Review -> In Progress for the same agent with the trimmed comment stored. */
export function requestChanges(t: TicketState, comment: string, now: string): TicketState {
  const text = comment.trim();
  if (text === '') {
    throw new DomainRefusal(
      'validation_failed',
      'A comment is required — tell the agent what to change.',
      {
        path: 'comment',
      },
    );
  }
  return touch(t, now, { status: 'in_progress', reviewComment: text });
}

/** API-AC-21: stores the trimmed answer and clears the Blocked question. */
export function answer(t: TicketState, text: string, now: string): TicketState {
  if (t.blockedQuestion === null) {
    throw new DomainRefusal('not_blocked', `${t.id} is not blocked.`);
  }
  const trimmed = text.trim();
  if (trimmed === '') {
    throw new DomainRefusal('validation_failed', 'Write an answer before unblocking.', {
      path: 'answer',
    });
  }
  return touch(t, now, { blockedQuestion: null, answer: trimmed });
}

/** Agent reports a Blocked question. */
export function block(t: TicketState, question: string, now: string): TicketState {
  return touch(t, now, { blockedQuestion: question });
}

/** Agent submits for review (API-AC-50): Review with summary and link, review comment cleared. */
export function submit(
  t: TicketState,
  reviewSummary: string,
  resultLink: string,
  now: string,
): TicketState {
  return touch(t, now, { status: 'review', reviewSummary, resultLink, reviewComment: null });
}

/** Agent progress update. */
export function update(t: TicketState, text: string, now: string): TicketState {
  return touch(t, now, { lastUpdate: { text, at: now } });
}
