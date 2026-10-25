import { operatorTransition, tokenActivityOf, type RequestChangesBody } from '@agent-ops/shared';
import {
  DomainRefusal,
  STATUS_LABEL,
  agent as agentRules,
  ctxTok,
  eventBuilders,
  session as sessionRules,
  ticket as ticketRules,
  type EventDraft,
} from '../../../domain/index.js';
import type { StoredLogEntry } from '../../ports/repositories.js';
import type { UnitOfWork } from '../../ports/unit-of-work.js';
import {
  commitEvents,
  endOpenSession,
  logAppendedEvent,
  type CommandOutcome,
  type SimScripts,
} from '../../services/ticket-work.js';

export interface RequestChangesDeps {
  uow: UnitOfWork;
  scripts: SimScripts;
}

/**
 * Operator requests changes on a Review ticket (API-AC-17, AC-18): same agent, ticket back to In
 * Progress with the comment stored, a NEW running session (D-12), read-comment script queued.
 */
export async function requestChanges(
  deps: RequestChangesDeps,
  ticketId: string,
  body: RequestChangesBody,
): Promise<CommandOutcome> {
  return deps.uow.run(async (tx) => {
    const current = await tx.tickets.get(ticketId);
    if (!current) throw new DomainRefusal('not_found', `Ticket ${ticketId} not found.`);
    if (body.expectedStatus !== undefined && current.status !== body.expectedStatus) {
      throw new DomainRefusal(
        'stale_state',
        `${current.id} is now in ${STATUS_LABEL[current.status]}.`,
      );
    }
    const cell = operatorTransition(current.status, 'in_progress');
    if (cell.kind !== 'request_changes') {
      throw new DomainRefusal(
        'transition_refused',
        cell.reason ?? `${current.id} is not in Review.`,
        { ...(cell.reason ? { reason: cell.reason } : {}) },
      );
    }
    const agent = current.assigneeId ? await tx.agents.get(current.assigneeId) : null;
    if (!agent) throw new DomainRefusal('not_found', `${current.id} has no agent to ask.`);

    const now = tx.clock.now();
    const events: EventDraft[] = [];
    // Older data: a previous session still open is completed first.
    await endOpenSession(tx, agent, 'completed', events);

    const updated = ticketRules.requestChanges(current, body.comment, now);
    await tx.tickets.update(updated);

    const started = sessionRules.startSession({
      number: await tx.nextNumber('session'),
      agentId: agent.id,
      ticketId: updated.id,
      model: agent.model,
      now,
    });
    const text = `Session started · ${agent.model}`;
    const { session, entry } = sessionRules.appendEntry(started, {
      at: now,
      type: 'system',
      text,
      tokens: ctxTok({ type: 'system', text, t: now }),
    });
    await tx.sessions.insert(session);
    const startEntry: StoredLogEntry = {
      ...entry,
      activity: tokenActivityOf({ type: 'system', text }),
    };
    await tx.sessions.appendEntry(session.id, startEntry);

    const next = {
      ...agentRules.resumeInSession(agent, session.id),
      currentTicketId: updated.id,
    };
    await tx.agents.update(next);
    const simState = await tx.simState.get(agent.id);
    if (simState) {
      await tx.simState.save({
        ...simState,
        script: deps.scripts.queueReadComment(simState.script, updated),
      });
    }

    const refs = { at: now, agentId: agent.id, ticketId: updated.id, sessionId: session.id };
    events.push(
      eventBuilders.ticketChangesRequested(refs, updated.reviewComment ?? body.comment, agent.id),
      eventBuilders.sessionStarted(refs, agent.model),
      await logAppendedEvent(tx, session, startEntry),
    );
    const seq = await commitEvents(tx, events);
    return { seq, ticket: updated, agent: next, session };
  });
}
