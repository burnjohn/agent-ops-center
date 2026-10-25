import { describe, expect, it } from 'vitest';
import { TICKET_STATUSES, type TicketStatus } from './enums.js';
import { needsInputReason, operatorTransition } from './transitions.js';

const R = (reason: string) => ({ kind: 'refused', confirm: false, reason });
const T = (kind: string, confirm = false) => ({ kind, confirm, reason: null });
const here = R('Already here');
const notStarted = R('Nobody worked on it yet — move it to In Progress first');
const pending = R('Approve it or request changes');

const expected: Record<TicketStatus, Record<TicketStatus, unknown>> = {
  backlog: {
    backlog: here,
    ready: T('move'),
    in_progress: T('assign'),
    review: notStarted,
    done: T('mark_done'),
  },
  ready: {
    backlog: T('move'),
    ready: here,
    in_progress: T('assign'),
    review: notStarted,
    done: T('mark_done'),
  },
  in_progress: {
    backlog: R('Release it to Ready first'),
    ready: T('release', true),
    in_progress: here,
    review: R('Only the agent submits work for review'),
    done: T('mark_done', true),
  },
  review: {
    backlog: pending,
    ready: pending,
    in_progress: T('request_changes'),
    review: here,
    done: T('approve'),
  },
  done: {
    backlog: T('reopen', true),
    ready: T('reopen', true),
    in_progress: T('assign'),
    review: R('Reopen it first — only an agent submits for review'),
    done: here,
  },
};

describe('operatorTransition', () => {
  const cells = TICKET_STATUSES.flatMap((f) => TICKET_STATUSES.map((t) => [f, t] as const));
  it('covers 25 cells', () => expect(cells).toHaveLength(25));
  it.each(cells)('%s -> %s', (from, to) => {
    expect(operatorTransition(from, to)).toEqual(expected[from][to]);
  });

  it('returns a copy, not the shared table row', () => {
    const t = operatorTransition('backlog', 'ready');
    t.confirm = true;
    expect(operatorTransition('backlog', 'ready').confirm).toBe(false);
  });
});

describe('needsInputReason', () => {
  it('assign targets', () => {
    for (const f of ['backlog', 'ready', 'done'] as const)
      expect(needsInputReason(f, 'in_progress')).toBe('Pick an agent — use assign.');
  });
  it('review -> in_progress', () =>
    expect(needsInputReason('review', 'in_progress')).toBe(
      'A comment is required — use request changes.',
    ));
  it('other pairs', () => expect(needsInputReason('backlog', 'ready')).toBeNull());
});
