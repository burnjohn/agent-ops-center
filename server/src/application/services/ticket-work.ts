import type {
  AgentScript,
  AgentStage,
  SessionStatus,
  TicketStatus,
  TokenUsage,
} from '@agent-ops/shared';
import { entryCostUsd, tokenActivityOf } from '@agent-ops/shared';
import {
  agent as agentRules,
  ctxTok,
  eventBuilders,
  session as sessionRules,
  ticket as ticketRules,
  type AgentState,
  type EventDraft,
  type SessionState,
  type TicketState,
} from '../../domain/index.js';
import type { StoredLogEntry } from '../ports/repositories.js';
import type { TxContext } from '../ports/unit-of-work.js';

/**
 * Queues scripted agent actions. Declared here (T21); implemented by the simulation engine (T24) and
 * wired in the composition root. Commands never write script content themselves.
 */
export interface SimScripts {
  /** The Planning script for a freshly assigned / claimed ticket. */
  queuePlanning(script: AgentScript, ticket: TicketState): AgentScript;
  /** "Read the review comment, then report `implementing`" after request changes. */
  queueReadComment(script: AgentScript, ticket: TicketState): AgentScript;
  /** "Read the answer" after the Operator answers a Blocked ticket. */
  queueReadAnswer(script: AgentScript, ticket: TicketState): AgentScript;
}

/** What a command returns; presentation maps it to the shared `CommandResult`. */
export interface CommandOutcome {
  /** Last `seq` written by the command. */
  seq: number;
  ticket?: TicketState;
  agent?: AgentState;
  session?: SessionState;
}

/** Appends the drafts in order and returns the last `seq` (0 when there were none). */
export async function commitEvents(tx: TxContext, drafts: readonly EventDraft[]): Promise<number> {
  const events = await tx.appendEvents(drafts);
  return events.reduce((max, e) => Math.max(max, e.seq), 0);
}

/**
 * Builds the `log.appended` event for an entry just written to `session` (SPEC-database §4.5: written
 * only by live commands and steps). Cost = `entryCostUsd` at the session model's price; `null` when the
 * entry has no tokens or the model has no price row.
 */
export async function logAppendedEvent(
  tx: TxContext,
  session: SessionState,
  entry: StoredLogEntry,
): Promise<EventDraft> {
  const price = entry.tokens ? await tx.modelPrices.get(session.model) : null;
  return eventBuilders.logAppended(
    {
      at: entry.at,
      agentId: session.agentId,
      ticketId: session.ticketId,
      sessionId: session.id,
    },
    {
      index: entry.index,
      at: entry.at,
      type: entry.type,
      text: entry.text,
      stage: entry.stage,
      tool: entry.tool,
      tokens: entry.tokens,
      costUsd: entry.tokens && price ? entryCostUsd(entry.tokens, price) : null,
      activity: entry.activity,
    },
  );
}

/** Appends a `system` log entry to a running session, persists both and records `log.appended`. */
export async function appendSystemEntry(
  tx: TxContext,
  session: SessionState,
  text: string,
  events: EventDraft[],
  tokens: TokenUsage | null = null,
): Promise<SessionState> {
  const { session: next, entry } = sessionRules.appendEntry(session, {
    at: tx.clock.now(),
    type: 'system',
    text,
    tokens,
  });
  const stored: StoredLogEntry = {
    ...entry,
    activity: tokens ? tokenActivityOf({ type: 'system', text }) : null,
  };
  await tx.sessions.appendEntry(session.id, stored);
  await tx.sessions.update(next);
  events.push(await logAppendedEvent(tx, next, stored));
  return next;
}

export interface EndSessionOptions {
  /** `system` entry written before the session ends. */
  systemText?: string;
  /**
   * Only end the open session when it belongs to this ticket (`null` = ticket-less). When omitted the
   * agent's open session is ended whatever it is on.
   */
  ticketId?: string | null;
}

/** Ends the agent's open session (if it matches) and records `session.ended`. Returns it, or null. */
export async function endOpenSession(
  tx: TxContext,
  agent: AgentState,
  status: Exclude<SessionStatus, 'running'>,
  events: EventDraft[],
  options: EndSessionOptions = {},
): Promise<SessionState | null> {
  const open = await tx.sessions.runningFor(agent.id);
  if (!open) return null;
  if (options.ticketId !== undefined && open.ticketId !== options.ticketId) return null;
  const current =
    options.systemText === undefined
      ? open
      : await appendSystemEntry(tx, open, options.systemText, events);
  const ended = sessionRules.endSession(current, status, tx.clock.now());
  await tx.sessions.update(ended);
  events.push(
    eventBuilders.sessionEnded(
      {
        at: ended.endedAt ?? tx.clock.now(),
        agentId: agent.id,
        ticketId: ended.ticketId,
        sessionId: ended.id,
      },
      status,
    ),
  );
  return ended;
}

export interface FreeAgentOptions {
  /** Release: the agent will refuse once it acts again (shown as "Paused after release"). */
  pausedAfterRelease?: boolean;
  /** Emit `agent.stage_changed` to idle (default true). */
  emitStageChange?: boolean;
}

/** Sets the agent idle with no ticket or tool, persists it, optionally emits the stage change. */
export async function freeAgent(
  tx: TxContext,
  agent: AgentState,
  events: EventDraft[],
  options: FreeAgentOptions = {},
): Promise<AgentState> {
  const idle = agentRules.goIdle(agent, {
    pausedAfterRelease: options.pausedAfterRelease ?? false,
  });
  await tx.agents.update(idle);
  if ((options.emitStageChange ?? true) && agent.stage !== 'idle') {
    events.push(
      eventBuilders.stageChanged(
        { at: tx.clock.now(), agentId: agent.id, ticketId: agent.currentTicketId },
        agent.stage,
        'idle',
      ),
    );
  }
  return idle;
}

export type WorkSource = 'operator' | 'claim';

export interface StartWorkInput {
  ticket: TicketState;
  agent: AgentState;
  /** `operator`: assignment (`claim:false`); `claim`: agent self-claim (`agent_report`, `claim:true`). */
  source: WorkSource;
  /** The ticket's status before it moves to In Progress. */
  from: TicketStatus;
}

export interface StartedWork {
  ticket: TicketState;
  agent: AgentState;
  session: SessionState;
}

const PLANNING: AgentStage = 'planning';

/**
 * Puts `agent` on `ticket` (API-AC-19, AC-51): ends a ticket-less open session, opens a new running
 * session with the "Session started · <model>" entry, sets stage `planning` with the Planning script
 * queued, refreshes last-seen unless the agent is unresponsive, and records the events.
 * The caller has already checked that the agent is free.
 */
export async function startWork(
  tx: TxContext,
  scripts: SimScripts,
  input: StartWorkInput,
  events: EventDraft[],
): Promise<StartedWork> {
  const now = tx.clock.now();
  const base = await freeTicketlessSession(tx, input.agent, events);

  const assigned = ticketRules.assignTo(input.ticket, base.id, now);
  await tx.tickets.update(assigned);

  const number = await tx.nextNumber('session');
  const started = sessionRules.startSession({
    number,
    agentId: base.id,
    ticketId: assigned.id,
    model: base.model,
    now,
  });
  const text = `Session started · ${base.model}`;
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

  const simState = await tx.simState.get(base.id);
  let agent = agentRules.takeTicket(base, assigned.id, session.id);
  if (!simState?.silent) agent = agentRules.markSeen(agent, now);
  await tx.agents.update(agent);
  if (simState) {
    await tx.simState.save({
      ...simState,
      script: scripts.queuePlanning(simState.script, assigned),
    });
  }

  const refs = { at: now, agentId: agent.id, ticketId: assigned.id, sessionId: session.id };
  events.push(
    input.source === 'operator'
      ? eventBuilders.ticketAssigned(refs, input.from)
      : eventBuilders.ticketClaimed(refs),
    eventBuilders.stageChanged(refs, base.stage, PLANNING),
    eventBuilders.sessionStarted(refs, base.model),
    await logAppendedEvent(tx, session, startEntry),
  );
  return { ticket: assigned, agent, session };
}

/** AC-19: a ticket-less open session is ended as completed before the new one starts. */
async function freeTicketlessSession(
  tx: TxContext,
  agent: AgentState,
  events: EventDraft[],
): Promise<AgentState> {
  const ended = await endOpenSession(tx, agent, 'completed', events, { ticketId: null });
  return ended ? agentRules.goIdle(agent) : agent;
}
