import { TICKET_STATUSES, type TicketStatus } from '@agent-ops/shared';
import { describe, expect, it } from 'vitest';
import { dropHint, moveReaction, refusedToast } from './moveReaction';

type Cell = { from: TicketStatus; to: TicketStatus; type: string; hint: string | null };

const NOT_STARTED = 'Nobody worked on it yet — move it to In Progress first';
const PENDING = 'Approve it or request changes';

// The 20 off-diagonal cells of the SPEC-web-ui "Moves: the Operator transition table" (the source of truth).
const TABLE: Cell[] = [
  { from: 'backlog', to: 'ready', type: 'command', hint: '↓ DROP — READY FOR AGENTS' },
  { from: 'backlog', to: 'in_progress', type: 'assignModal', hint: '↓ DROP — PICK AN AGENT' },
  { from: 'backlog', to: 'review', type: 'refused', hint: `⊘ ${NOT_STARTED.toUpperCase()}` },
  { from: 'backlog', to: 'done', type: 'command', hint: '↓ DROP — MARK DONE' },
  { from: 'ready', to: 'backlog', type: 'command', hint: '↓ DROP — BACK TO BACKLOG' },
  { from: 'ready', to: 'in_progress', type: 'assignModal', hint: '↓ DROP — PICK AN AGENT' },
  { from: 'ready', to: 'review', type: 'refused', hint: `⊘ ${NOT_STARTED.toUpperCase()}` },
  { from: 'ready', to: 'done', type: 'command', hint: '↓ DROP — MARK DONE' },
  { from: 'in_progress', to: 'backlog', type: 'refused', hint: '⊘ RELEASE IT TO READY FIRST' },
  { from: 'in_progress', to: 'ready', type: 'releaseConfirm', hint: '↓ DROP — RELEASE (CONFIRM)' },
  {
    from: 'in_progress',
    to: 'review',
    type: 'refused',
    hint: '⊘ ONLY THE AGENT SUBMITS WORK FOR REVIEW',
  },
  {
    from: 'in_progress',
    to: 'done',
    type: 'markDoneConfirm',
    hint: '↓ DROP — MARK DONE (CONFIRM)',
  },
  { from: 'review', to: 'backlog', type: 'refused', hint: `⊘ ${PENDING.toUpperCase()}` },
  { from: 'review', to: 'ready', type: 'refused', hint: `⊘ ${PENDING.toUpperCase()}` },
  {
    from: 'review',
    to: 'in_progress',
    type: 'requestChangesModal',
    hint: '↓ DROP — SEND BACK WITH COMMENT',
  },
  { from: 'review', to: 'done', type: 'command', hint: '↓ DROP — APPROVE' },
  { from: 'done', to: 'backlog', type: 'reopenConfirm', hint: '↓ DROP — REOPEN (CONFIRM)' },
  { from: 'done', to: 'ready', type: 'reopenConfirm', hint: '↓ DROP — REOPEN (CONFIRM)' },
  { from: 'done', to: 'in_progress', type: 'assignModal', hint: '↓ DROP — PICK AN AGENT' },
  {
    from: 'done',
    to: 'review',
    type: 'refused',
    hint: 'Reopen it first — only an agent submits for review'.toUpperCase().replace(/^/, '⊘ '),
  },
];

describe('moveReaction / dropHint over the Operator transition table (UI-AC-45, UI-AC-46)', () => {
  it('covers every off-diagonal cell', () => {
    expect(TABLE).toHaveLength(TICKET_STATUSES.length * (TICKET_STATUSES.length - 1));
  });

  it.each(TABLE)('$from -> $to reacts with $type and hints "$hint"', ({ from, to, type, hint }) => {
    // Contract: reaction type and drop hint match the spec table for this cell.
    expect(moveReaction(from, to).type).toBe(type);
    expect(dropHint(from, to)?.text).toBe(hint);
    expect(dropHint(from, to)?.accepts).toBe(type !== 'refused');
  });

  it('shows no hint and refuses for the card’s own column', () => {
    for (const s of TICKET_STATUSES) {
      expect(dropHint(s, s)).toBeNull();
      expect(moveReaction(s, s).type).toBe('refused');
    }
  });

  it('labels plain moves, approve and mark-done with the toast kind the orchestrator uses', () => {
    expect(moveReaction('backlog', 'ready')).toEqual({ type: 'command', toast: 'moved' });
    expect(moveReaction('backlog', 'done')).toEqual({ type: 'command', toast: 'done' });
    expect(moveReaction('review', 'done')).toEqual({ type: 'command', toast: 'approved' });
  });

  it('formats the refusal toast with column name and reason (UI-AC-19)', () => {
    expect(refusedToast('T-12', 'backlog', 'Release it to Ready first')).toBe(
      'Can’t move T-12 to Backlog: Release it to Ready first',
    );
  });
});
