import type { TicketStatus } from './enums.js';

/** Which command performs a transition (SPEC-server-api §C4). */
export type TransitionKind =
  | 'move'
  | 'assign'
  | 'release'
  | 'reopen'
  | 'mark_done'
  | 'approve'
  | 'request_changes'
  | 'refused';

export interface Transition {
  kind: TransitionKind;
  confirm: boolean;
  reason: string | null;
}

/** AC-11: a plain move to In Progress / Review -> In Progress needs another command. */
export const NEEDS_INPUT_REASONS = {
  assign: 'Pick an agent — use assign.',
  requestChanges: 'A comment is required — use request changes.',
} as const;

const ALREADY_HERE = 'Already here';
const NOT_STARTED = 'Nobody worked on it yet — move it to In Progress first';
const RELEASE_FIRST = 'Release it to Ready first';
const REVIEW_PENDING = 'Approve it or request changes';
const ONLY_AGENT_SUBMITS = 'Only the agent submits work for review';
const REOPEN_FIRST = 'Reopen it first — only an agent submits for review';

const ok = (kind: Exclude<TransitionKind, 'refused'>, confirm = false): Transition => ({
  kind,
  confirm,
  reason: null,
});
const no = (reason: string): Transition => ({ kind: 'refused', confirm: false, reason });

/** The 5x5 table: TRANSITIONS[from][to]. */
export const TRANSITIONS: Readonly<
  Record<TicketStatus, Readonly<Record<TicketStatus, Transition>>>
> = {
  backlog: {
    backlog: no(ALREADY_HERE),
    ready: ok('move'),
    in_progress: ok('assign'),
    review: no(NOT_STARTED),
    done: ok('mark_done'),
  },
  ready: {
    backlog: ok('move'),
    ready: no(ALREADY_HERE),
    in_progress: ok('assign'),
    review: no(NOT_STARTED),
    done: ok('mark_done'),
  },
  in_progress: {
    backlog: no(RELEASE_FIRST),
    ready: ok('release', true),
    in_progress: no(ALREADY_HERE),
    review: no(ONLY_AGENT_SUBMITS),
    done: ok('mark_done', true),
  },
  review: {
    backlog: no(REVIEW_PENDING),
    ready: no(REVIEW_PENDING),
    in_progress: ok('request_changes'),
    review: no(ALREADY_HERE),
    done: ok('approve'),
  },
  done: {
    backlog: ok('reopen', true),
    ready: ok('reopen', true),
    in_progress: ok('assign'),
    review: no(REOPEN_FIRST),
    done: no(ALREADY_HERE),
  },
};

/** Single source of truth for what the Operator may do with a status pair. */
export function operatorTransition(from: TicketStatus, to: TicketStatus): Transition {
  return { ...TRANSITIONS[from][to] };
}

/**
 * AC-11: reason for a plain move request that needs another command, or null.
 * Targets In Progress (from Backlog, Ready, Done) -> assign; Review -> In Progress -> request changes.
 */
export function needsInputReason(from: TicketStatus, to: TicketStatus): string | null {
  const kind = TRANSITIONS[from][to].kind;
  if (kind === 'assign') return NEEDS_INPUT_REASONS.assign;
  if (kind === 'request_changes') return NEEDS_INPUT_REASONS.requestChanges;
  return null;
}
