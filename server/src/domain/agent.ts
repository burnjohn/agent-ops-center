import type { AgentKind, AgentStage, LastTool, ToolRef } from '@agent-ops/shared';

/** Stored agent state; health, cost and the step object are derived by the application layer. */
export interface AgentState {
  id: string;
  name: string;
  kind: AgentKind;
  model: string;
  stage: AgentStage;
  lastSeenAt: string;
  currentTicketId: string | null;
  currentSessionId: string | null;
  lastSessionId: string | null;
  currentTool: ToolRef | null;
  lastTool: LastTool | null;
  pausedAfterRelease: boolean;
}

export function setStage(a: AgentState, stage: AgentStage): AgentState {
  return { ...a, stage };
}

export function markSeen(a: AgentState, now: string): AgentState {
  return { ...a, lastSeenAt: now };
}

/** Takes a ticket and its new running session; stage starts at `planning`. */
export function takeTicket(a: AgentState, ticketId: string, sessionId: string): AgentState {
  return {
    ...a,
    stage: 'planning',
    currentTicketId: ticketId,
    currentSessionId: sessionId,
    lastSessionId: sessionId,
    currentTool: null,
    pausedAfterRelease: false,
  };
}

/** Goes idle: no ticket, no running tool. `lastSessionId` keeps pointing at the finished session. */
export function goIdle(a: AgentState, options: { pausedAfterRelease?: boolean } = {}): AgentState {
  return {
    ...a,
    stage: 'idle',
    currentTicketId: null,
    currentSessionId: null,
    currentTool: null,
    pausedAfterRelease: options.pausedAfterRelease ?? false,
  };
}

/** A new session on the same ticket (request changes). */
export function resumeInSession(a: AgentState, sessionId: string): AgentState {
  return { ...a, currentSessionId: sessionId, lastSessionId: sessionId, currentTool: null };
}

export function startTool(a: AgentState, name: string, arg: string, now: string): AgentState {
  return { ...a, currentTool: { name, arg, startedAt: now } };
}

/** Clears the running tool and records it as the last tool. */
export function finishTool(a: AgentState, ok: boolean, now: string): AgentState {
  const tool = a.currentTool;
  return {
    ...a,
    currentTool: null,
    lastTool: tool ? { name: tool.name, arg: tool.arg, ok, at: now } : a.lastTool,
  };
}
