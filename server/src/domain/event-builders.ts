import type * as S from '@agent-ops/shared';
import { STAGE_LABEL, STATUS_LABEL } from './labels.js';

/** An event before the database assigns `seq` and `realAt` (SPEC-server-api §C5). */
export interface EventDraft {
  type: S.EventType;
  source: S.EventSource;
  category: S.EventCategory;
  at: string;
  agentId: string | null;
  ticketId: string | null;
  sessionId: string | null;
  warn: boolean;
  payload: Record<string, unknown> & { summary: string };
}

interface Refs {
  at: string;
  agentId?: string | null;
  ticketId?: string | null;
  sessionId?: string | null;
}

function draft(
  type: S.EventType,
  source: S.EventSource,
  category: S.EventCategory,
  refs: Refs,
  payload: Record<string, unknown> & { summary: string },
  warn = false,
): EventDraft {
  return {
    type,
    source,
    category,
    at: refs.at,
    agentId: refs.agentId ?? null,
    ticketId: refs.ticketId ?? null,
    sessionId: refs.sessionId ?? null,
    warn,
    payload,
  };
}

const quote = (s: string): string => `“${s}”`;

// ---- ticket (operator) ----

export const ticketCreated = (r: Refs, ticket: S.Ticket): EventDraft =>
  draft('ticket.created', 'operator', 'ticket', r, { summary: `Created ${ticket.id}`, ticket });

export const ticketMoved = (r: Refs, from: S.TicketStatus, to: S.TicketStatus): EventDraft =>
  draft('ticket.moved', 'operator', 'ticket', r, {
    summary: `Moved ${STATUS_LABEL[from]} → ${STATUS_LABEL[to]}`,
    from,
    to,
  });

/** Operator assignment (`claim: false`). */
export const ticketAssigned = (
  r: Refs & { agentId: string; sessionId: string },
  from: S.TicketStatus,
): EventDraft =>
  draft('ticket.assigned', 'operator', 'ticket', r, {
    summary: `Moved ${STATUS_LABEL[from]} → In Progress · assigned to ${r.agentId}`,
    from,
    agentId: r.agentId,
    sessionId: r.sessionId,
    claim: false,
  });

/** Agent self-claim (`claim: true`, source agent_report). */
export const ticketClaimed = (
  r: Refs & { agentId: string; sessionId: string; ticketId: string },
): EventDraft =>
  draft('ticket.assigned', 'agent_report', 'ticket', r, {
    summary: `Claimed ${r.ticketId}`,
    from: 'ready',
    agentId: r.agentId,
    sessionId: r.sessionId,
    claim: true,
  });

export const ticketReleased = (r: Refs, agentId: string): EventDraft =>
  draft('ticket.released', 'operator', 'ticket', r, {
    summary: `Moved In Progress → Ready · released ${agentId}`,
    agentId,
  });

export const ticketReopened = (r: Refs, to: S.TicketStatus): EventDraft =>
  draft('ticket.reopened', 'operator', 'ticket', r, {
    summary: `Moved Done → ${STATUS_LABEL[to]}`,
    to,
  });

export const ticketApproved = (r: Refs & { ticketId: string }, agentId: string): EventDraft =>
  draft('ticket.approved', 'operator', 'ticket', r, { summary: `Approved ${r.ticketId}`, agentId });

export const ticketChangesRequested = (
  r: Refs & { sessionId: string },
  comment: string,
  agentId: string,
): EventDraft =>
  draft('ticket.changes_requested', 'operator', 'ticket', r, {
    summary: `Requested changes · ${quote(comment)}`,
    comment,
    agentId,
    sessionId: r.sessionId,
  });

export const ticketUnblocked = (r: Refs, answer: string, agentId: string): EventDraft =>
  draft('ticket.unblocked', 'operator', 'ticket', r, {
    summary: `Answered ${agentId} · ${quote(answer)}`,
    answer,
    agentId,
  });

// ---- ticket (agent report) ----

export const ticketUpdated = (r: Refs, text: string, progress: number): EventDraft =>
  draft('ticket.updated', 'agent_report', 'ticket', r, {
    summary: `Update · ${text} · ${progress}%`,
    text,
    progress,
  });

export const ticketBlocked = (r: Refs, question: string): EventDraft =>
  draft(
    'ticket.blocked',
    'agent_report',
    'ticket',
    r,
    { summary: `Blocked · ${question}`, question },
    true,
  );

export const ticketAnswerRead = (r: Refs): EventDraft =>
  draft('ticket.answer_read', 'agent_report', 'ticket', r, { summary: 'Read Operator answer' });

export const ticketCommentRead = (r: Refs): EventDraft =>
  draft('ticket.comment_read', 'agent_report', 'ticket', r, { summary: 'Read review comment' });

export const ticketSubmitted = (r: Refs, reviewSummary: string, resultLink: string): EventDraft =>
  draft('ticket.submitted', 'agent_report', 'ticket', r, {
    summary: `Submitted for review · ${resultLink}`,
    reviewSummary,
    resultLink,
  });

// ---- agent ----

export const stageChanged = (r: Refs, from: S.AgentStage, to: S.AgentStage): EventDraft =>
  draft('agent.stage_changed', 'agent_report', 'agent', r, {
    summary: `Stage → ${STAGE_LABEL[to]}`,
    from,
    to,
  });

export const agentRefused = (r: Refs, reason: string): EventDraft =>
  draft('agent.refused', 'agent_report', 'agent', r, { summary: reason, reason }, true);

export const agentConnected = (r: Refs): EventDraft =>
  draft('agent.connected', 'agent_report', 'agent', r, { summary: 'Connected' });

export const agentHeartbeat = (r: Refs, summary = 'Heartbeat'): EventDraft =>
  draft('agent.heartbeat', 'agent_report', 'agent', r, { summary });

export const healthChanged = (
  r: Refs & { agentId: string },
  from: S.AgentHealth,
  to: S.AgentHealth,
): EventDraft =>
  draft(
    'agent.health_changed',
    'system',
    'agent',
    r,
    { summary: `${r.agentId} is ${to.charAt(0).toUpperCase()}${to.slice(1)}`, from, to },
    to !== 'online',
  );

// ---- tool ----

export const toolStarted = (r: Refs, tool: string, arg: string): EventDraft =>
  draft('tool.started', 'agent_telemetry', 'tool', r, {
    summary: `${tool} started · ${arg}`,
    tool,
    arg,
  });

export const toolFinished = (
  r: Refs,
  tool: string,
  arg: string,
  durationSec: number,
  result: string,
): EventDraft =>
  draft('tool.finished', 'agent_telemetry', 'tool', r, {
    summary: `${tool} ok · ${arg}`,
    tool,
    arg,
    durationSec,
    result,
  });

export const toolFailed = (
  r: Refs,
  tool: string,
  arg: string,
  durationSec: number,
  result: string,
): EventDraft =>
  draft(
    'tool.failed',
    'agent_telemetry',
    'tool',
    r,
    { summary: `${tool} failed · ${arg} · ${result}`, tool, arg, durationSec, result },
    true,
  );

// ---- session / simulation (system; journal-only) ----

export const sessionStarted = (r: Refs & { sessionId: string }, model: string): EventDraft =>
  draft('session.started', 'system', 'agent', r, {
    summary: `Session ${r.sessionId} started`,
    model,
  });

export const sessionEnded = (
  r: Refs & { sessionId: string },
  status: Exclude<S.SessionStatus, 'running'>,
): EventDraft =>
  draft(
    'session.ended',
    'system',
    'agent',
    r,
    { summary: `Session ${r.sessionId} ${status}`, status },
    status === 'failed',
  );

export const logAppended = (r: Refs, entry: S.LogEntry): EventDraft =>
  draft('log.appended', 'system', 'agent', r, {
    summary: entry.text ?? entry.tool?.name ?? 'Log entry',
    entry,
  });

export const simulationStepped = (
  r: Refs,
  mode: 'step' | 'to_next_stage' | 'step_all' | 'play',
  clock: string,
  actedAgentIds: readonly string[],
): EventDraft =>
  draft('simulation.stepped', 'system', 'agent', r, {
    summary: `Simulation ${mode === 'play' ? 'played' : 'stepped'}`,
    mode,
    clock,
    actedAgentIds: [...actedAgentIds],
  });

export const simulationPlayChanged = (r: Refs, playing: boolean): EventDraft =>
  draft('simulation.play_changed', 'operator', 'agent', r, {
    summary: playing ? 'Play on' : 'Play off',
    playing,
  });
