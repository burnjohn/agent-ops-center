import { operatorTransition, type TicketStatus } from '@agent-ops/shared';
import { STATUS_LABEL } from '../../lib/labels';

/** What the UI does for one (from, to) cell of the Operator transition table (UI-AC-45). */
export type MoveReaction =
  | { type: 'command'; toast: 'moved' | 'done' | 'approved' }
  | { type: 'assignModal' }
  | { type: 'releaseConfirm' }
  | { type: 'markDoneConfirm' }
  | { type: 'reopenConfirm' }
  | { type: 'requestChangesModal' }
  | { type: 'refused'; reason: string };

export function moveReaction(from: TicketStatus, to: TicketStatus): MoveReaction {
  const t = operatorTransition(from, to);
  switch (t.kind) {
    case 'move':
      return { type: 'command', toast: 'moved' };
    case 'approve':
      return { type: 'command', toast: 'approved' };
    case 'mark_done':
      return t.confirm ? { type: 'markDoneConfirm' } : { type: 'command', toast: 'done' };
    case 'assign':
      return { type: 'assignModal' };
    case 'release':
      return { type: 'releaseConfirm' };
    case 'reopen':
      return { type: 'reopenConfirm' };
    case 'request_changes':
      return { type: 'requestChangesModal' };
    case 'refused':
      return { type: 'refused', reason: t.reason ?? 'Not allowed' };
  }
}

/** Drop hint above a column while dragging (UI-AC-46); the card's own column shows none. */
export interface DropHint {
  accepts: boolean;
  text: string;
}

export function dropHint(from: TicketStatus, to: TicketStatus): DropHint | null {
  if (from === to) return null;
  const reaction = moveReaction(from, to);
  switch (reaction.type) {
    case 'refused':
      return { accepts: false, text: `⊘ ${reaction.reason.toUpperCase()}` };
    case 'assignModal':
      return { accepts: true, text: '↓ DROP — PICK AN AGENT' };
    case 'releaseConfirm':
      return { accepts: true, text: '↓ DROP — RELEASE (CONFIRM)' };
    case 'markDoneConfirm':
      return { accepts: true, text: '↓ DROP — MARK DONE (CONFIRM)' };
    case 'reopenConfirm':
      return { accepts: true, text: '↓ DROP — REOPEN (CONFIRM)' };
    case 'requestChangesModal':
      return { accepts: true, text: '↓ DROP — SEND BACK WITH COMMENT' };
    case 'command':
      if (reaction.toast === 'approved') return { accepts: true, text: '↓ DROP — APPROVE' };
      if (reaction.toast === 'done') return { accepts: true, text: '↓ DROP — MARK DONE' };
      return {
        accepts: true,
        text: to === 'ready' ? '↓ DROP — READY FOR AGENTS' : '↓ DROP — BACK TO BACKLOG',
      };
  }
}

/** Refusal toast (UI-AC-19). */
export const refusedToast = (id: string, to: TicketStatus, reason: string): string =>
  `Can’t move ${id} to ${STATUS_LABEL[to]}: ${reason}`;
