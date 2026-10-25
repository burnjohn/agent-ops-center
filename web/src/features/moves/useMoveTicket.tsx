import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Ticket, TicketStatus } from '@agent-ops/shared';
import {
  useAssignTicket,
  useMoveTicket as useMoveCommand,
  useRequestChanges,
} from '../../api/commands';
import { useAgents, useTickets } from '../../api/queries';
import { STATUS_LABEL } from '../../lib/labels';
import { useToast } from '../../ui/overlay';
import { useSimulationHold } from '../simulation';
import { AssignModal } from './AssignModal';
import { commandErrorText, fieldErrors } from './commandError';
import { MarkDoneConfirm, ReleaseConfirm, ReopenConfirm } from './Confirmations';
import { moveReaction, refusedToast, type MoveReaction } from './moveReaction';
import { RequestChangesModal } from './RequestChangesModal';

/** The part of a ticket the orchestrator needs; `status` is the status the Operator was looking at. */
export type MovableTicket = Pick<
  Ticket,
  'id' | 'title' | 'status' | 'assigneeId' | 'blockedQuestion'
>;

type DialogReaction = Exclude<MoveReaction, { type: 'command' } | { type: 'refused' }>;

interface OpenDialog {
  ticket: MovableTicket;
  to: TicketStatus;
  reaction: DialogReaction;
  serverError?: string | undefined;
}

export interface MoveTicketApi {
  /** Drag drop and `Move` buttons both call this (UI-AC-45). Same column is a no-op (UI-AC-49). */
  requestMove: (ticket: MovableTicket, to: TicketStatus) => void;
  /** A command is in flight: disable the control that sent it (UI-AC-22). */
  isPending: boolean;
  /** Render once next to the consumer; null while no modal is open. */
  dialog: ReactNode;
}

/**
 * One orchestrator for every Operator move (UI-AC-18…22, 45, 48, 51…53): table-driven reaction,
 * never a request for a refused cell, `expectedStatus` = the shown status, `confirmed: true` only
 * from a confirm button, simulation held while a modal is open.
 */
export function useMoveTicket(): MoveTicketApi {
  const { showToast } = useToast();
  const move = useMoveCommand();
  const assign = useAssignTicket();
  const requestChanges = useRequestChanges();
  const { data: agents } = useAgents();
  const { data: tickets } = useTickets();
  const [open, setOpen] = useState<OpenDialog | null>(null);
  const isPending = move.isPending || assign.isPending || requestChanges.isPending;

  useSimulationHold(open !== null);

  // UI-AC-53: the ticket changed status under an open modal.
  const liveStatus = open ? tickets?.find((t) => t.id === open.ticket.id)?.status : undefined;
  const staleId = open?.ticket.id;
  const shownStatus = open?.ticket.status;
  useEffect(() => {
    if (isPending || liveStatus === undefined || liveStatus === shownStatus) return;
    setOpen(null);
    showToast(`${staleId} changed in the meantime — check its new state.`);
  }, [isPending, liveStatus, shownStatus, staleId, showToast]);

  const agentName = (id: string | null): string => {
    if (!id) return 'The agent';
    return agents?.find((a) => a.id === id)?.name ?? id;
  };

  const close = useCallback(() => setOpen(null), []);

  const fail = (error: unknown, ticket: MovableTicket, to: TicketStatus, keepOpen: boolean) => {
    const fields = fieldErrors(error);
    const text = commandErrorText(error);
    showToast(refusedToast(ticket.id, to, text));
    if (!keepOpen) {
      setOpen(null);
    } else {
      setOpen((prev) => (prev ? { ...prev, serverError: fields.comment ?? undefined } : prev));
    }
  };

  const sendMove = (
    ticket: MovableTicket,
    to: TicketStatus,
    confirmed: boolean,
    successToast: string,
    keepOpenOnError = false,
  ) => {
    move.mutate(
      {
        id: ticket.id,
        to,
        expectedStatus: ticket.status,
        ...(confirmed ? { confirmed: true } : {}),
      },
      {
        onSuccess: () => {
          showToast(successToast);
          setOpen(null);
        },
        onError: (error) => fail(error, ticket, to, keepOpenOnError),
      },
    );
  };

  const requestMove = (ticket: MovableTicket, to: TicketStatus) => {
    if (isPending || ticket.status === to) return;
    const reaction = moveReaction(ticket.status, to);
    switch (reaction.type) {
      case 'refused':
        showToast(refusedToast(ticket.id, to, reaction.reason));
        return;
      case 'command': {
        const label = STATUS_LABEL[to];
        const text =
          reaction.toast === 'approved'
            ? `${ticket.id} approved — moved to Done`
            : reaction.toast === 'done'
              ? `${ticket.id} moved to Done`
              : `${ticket.id} moved to ${label}`;
        sendMove(ticket, to, false, text);
        return;
      }
      default:
        setOpen({ ticket, to, reaction });
    }
  };

  let dialog: ReactNode = null;
  if (open) {
    const { ticket, to, reaction } = open;
    const pending = isPending;
    switch (reaction.type) {
      case 'assignModal':
        dialog = (
          <AssignModal
            ticketId={ticket.id}
            ticketTitle={ticket.title}
            pending={pending}
            onCancel={close}
            onPick={(agent) =>
              assign.mutate(
                { id: ticket.id, agentId: agent.id, expectedStatus: ticket.status },
                {
                  onSuccess: () => {
                    showToast(`${ticket.id} is In Progress — ${agent.name} starts with Planning`);
                    setOpen(null);
                  },
                  onError: (error) => fail(error, ticket, 'in_progress', false),
                },
              )
            }
          />
        );
        break;
      case 'releaseConfirm':
        dialog = (
          <ReleaseConfirm
            ticketId={ticket.id}
            agentName={agentName(ticket.assigneeId)}
            pending={pending}
            onCancel={close}
            onConfirm={() =>
              sendMove(
                ticket,
                'ready',
                true,
                `${ticket.id} moved to Ready — the agent is free again`,
              )
            }
          />
        );
        break;
      case 'markDoneConfirm':
        dialog = (
          <MarkDoneConfirm
            ticketId={ticket.id}
            agentName={agentName(ticket.assigneeId)}
            blocked={ticket.blockedQuestion !== null}
            pending={pending}
            onCancel={close}
            onConfirm={() => sendMove(ticket, 'done', true, `${ticket.id} moved to Done`)}
          />
        );
        break;
      case 'reopenConfirm':
        dialog = (
          <ReopenConfirm
            ticketId={ticket.id}
            to={to}
            pending={pending}
            onCancel={close}
            onConfirm={() =>
              sendMove(ticket, to, true, `${ticket.id} reopened in ${STATUS_LABEL[to]}`)
            }
          />
        );
        break;
      case 'requestChangesModal':
        dialog = (
          <RequestChangesModal
            ticketId={ticket.id}
            agentName={agentName(ticket.assigneeId)}
            pending={pending}
            serverError={open.serverError}
            onCancel={close}
            onSend={(comment) =>
              requestChanges.mutate(
                { id: ticket.id, comment, expectedStatus: ticket.status },
                {
                  onSuccess: () => {
                    showToast(`${ticket.id} sent back to In Progress`);
                    setOpen(null);
                  },
                  onError: (error) => fail(error, ticket, 'in_progress', true),
                },
              )
            }
          />
        );
        break;
    }
  }

  return { requestMove, isPending, dialog };
}
