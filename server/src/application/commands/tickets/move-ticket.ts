import {
  needsInputReason,
  operatorTransition,
  type MoveTicketBody,
  type TicketStatus,
} from '@agent-ops/shared';
import {
  DomainRefusal,
  STATUS_LABEL,
  eventBuilders,
  ticket as ticketRules,
  type AgentState,
  type EventDraft,
  type SessionState,
  type TicketState,
} from '../../../domain/index.js';
import type { TxContext, UnitOfWork } from '../../ports/unit-of-work.js';
import {
  commitEvents,
  endOpenSession,
  freeAgent,
  type CommandOutcome,
} from '../../services/ticket-work.js';

export interface MoveTicketDeps {
  uow: UnitOfWork;
}

/** Cooldown (in agent steps) after a release before the agent may claim again (API-AC-13). */
export const RELEASE_COOLDOWN_STEPS = 4;

const RELEASE_SYSTEM_TEXT = 'Ticket released by Operator';

/**
 * Operator move (API-AC-9…16). The outcome is decided only by the shared transition table (AC-10):
 * `move`, `release`, `reopen`, `mark_done`, `approve` are applied here; `assign` / `request_changes`
 * answer `needs_input`; refused cells answer `transition_refused` with the table's reason.
 */
export async function moveTicket(
  deps: MoveTicketDeps,
  ticketId: string,
  body: MoveTicketBody,
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

    const cell = operatorTransition(current.status, body.to);
    if (cell.kind === 'refused') {
      throw new DomainRefusal('transition_refused', cell.reason ?? 'Move refused.', {
        ...(cell.reason ? { reason: cell.reason } : {}),
      });
    }
    const needsInput = needsInputReason(current.status, body.to);
    if (needsInput !== null) {
      throw new DomainRefusal('needs_input', needsInput, { reason: needsInput });
    }
    if (cell.confirm && body.confirmed !== true) {
      throw new DomainRefusal(
        'confirmation_required',
        `Confirm to ${cell.kind.replace('_', ' ')} ${current.id}.`,
      );
    }

    const events: EventDraft[] = [];
    const result = await apply(tx, cell.kind, current, body.to, events);
    const seq = await commitEvents(tx, events);
    return { seq, ...result };
  });
}

interface Applied {
  ticket: TicketState;
  agent?: AgentState;
  session?: SessionState;
}

async function apply(
  tx: TxContext,
  kind: string,
  current: TicketState,
  to: TicketStatus,
  events: EventDraft[],
): Promise<Applied> {
  const now = tx.clock.now();
  const refs = { at: now, ticketId: current.id };
  switch (kind) {
    case 'move': {
      const moved = ticketRules.setStatus(current, to, now);
      await tx.tickets.update(moved);
      events.push(eventBuilders.ticketMoved(refs, current.status, to));
      return { ticket: moved };
    }
    case 'release':
      return release(tx, current, events);
    case 'reopen': {
      const target = to === 'backlog' ? 'backlog' : 'ready';
      const reopened = ticketRules.reopen(current, target, now);
      await tx.tickets.update(reopened);
      events.push(eventBuilders.ticketReopened(refs, target));
      return { ticket: reopened };
    }
    case 'mark_done':
      return markDone(tx, current, events);
    case 'approve':
      return approve(tx, current, events);
    default:
      throw new DomainRefusal('internal', `Unhandled transition kind: ${kind}.`);
  }
}

async function holder(tx: TxContext, t: TicketState): Promise<AgentState | null> {
  return t.assigneeId ? tx.agents.get(t.assigneeId) : null;
}

/** API-AC-13 */
async function release(
  tx: TxContext,
  current: TicketState,
  events: EventDraft[],
): Promise<Applied> {
  const now = tx.clock.now();
  const released = ticketRules.release(current, now);
  await tx.tickets.update(released);
  const agent = await holder(tx, current);
  const refs = { at: now, ticketId: current.id, agentId: agent?.id ?? null };
  events.push(eventBuilders.ticketReleased(refs, current.assigneeId ?? 'agent'));
  if (!agent) return { ticket: released };

  const session = await endOpenSession(tx, agent, 'completed', events, {
    systemText: RELEASE_SYSTEM_TEXT,
    ticketId: current.id,
  });
  const idle = await freeAgent(tx, agent, events, {
    pausedAfterRelease: true,
    emitStageChange: false,
  });
  const simState = await tx.simState.get(agent.id);
  if (simState) {
    await tx.simState.save({
      ...simState,
      pendingRefusalTicketId: current.id,
      cooldownSteps: RELEASE_COOLDOWN_STEPS,
    });
  }
  return { ticket: released, agent: idle, ...(session ? { session } : {}) };
}

/** API-AC-15 */
async function markDone(
  tx: TxContext,
  current: TicketState,
  events: EventDraft[],
): Promise<Applied> {
  const now = tx.clock.now();
  const done = ticketRules.markDone(current, now);
  await tx.tickets.update(done);
  events.push(eventBuilders.ticketMoved({ at: now, ticketId: current.id }, current.status, 'done'));
  return { ticket: done, ...(await finishHolder(tx, current, events)) };
}

/** API-AC-16 */
async function approve(
  tx: TxContext,
  current: TicketState,
  events: EventDraft[],
): Promise<Applied> {
  const now = tx.clock.now();
  const approved = ticketRules.approve(current, now);
  await tx.tickets.update(approved);
  events.push(
    eventBuilders.ticketApproved(
      { at: now, ticketId: current.id, agentId: current.assigneeId },
      current.assigneeId ?? 'agent',
    ),
  );
  return { ticket: approved, ...(await finishHolder(tx, current, events)) };
}

/** Ends the holder's open session on the ticket as completed and sets the holder idle (stage event). */
async function finishHolder(
  tx: TxContext,
  current: TicketState,
  events: EventDraft[],
): Promise<{ agent?: AgentState; session?: SessionState }> {
  const agent = await holder(tx, current);
  if (!agent || agent.currentTicketId !== current.id) return {};
  const session = await endOpenSession(tx, agent, 'completed', events, { ticketId: current.id });
  const idle = await freeAgent(tx, agent, events);
  return { agent: idle, ...(session ? { session } : {}) };
}
