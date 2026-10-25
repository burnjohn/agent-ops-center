import type { Agent, SessionSummary, Ticket, TokenUsage } from '@agent-ops/shared';
import { formatMoney, formatTokens } from '../../lib/format';

/** UI-AC-77: the console shows the ticket's 5 newest sessions (the server sends them newest first). */
export const CONSOLE_SESSIONS_MAX = 5;

export const STEP_HINT = 'Agents only move when you step them';
export const BLOCKED_HINT = 'Blocked — answer above to continue';
export const REVIEW_HINT = 'Waiting for your review';
export const EMPTY_TEXT =
  'No agent has worked on this ticket yet. Move it to In Progress and pick an agent — its console appears here.';

type TicketLike = Pick<Ticket, 'id' | 'status' | 'blockedQuestion' | 'assigneeId'>;
type AgentLike = Pick<Agent, 'currentTicketId' | 'currentSessionId' | 'currentTool' | 'step'>;

/** UI-AC-78: the assignee's Running session on this ticket, else the newest one. */
export function defaultSessionId(
  sessions: readonly SessionSummary[],
  assigneeId: string | null,
): string | undefined {
  const running = sessions.find((s) => s.status === 'running' && s.agentId === assigneeId);
  return (running ?? sessions[0])?.id;
}

export const isBlocked = (ticket: TicketLike): boolean =>
  ticket.status === 'in_progress' && ticket.blockedQuestion !== null;

export type StepView =
  { kind: 'buttons'; hint: string } | { kind: 'text'; text: string } | { kind: 'none' };

/** UI-AC-82…84. `step.reason` is shown verbatim, never computed. */
export function stepView(ticket: TicketLike, agent: AgentLike | undefined): StepView {
  if (isBlocked(ticket)) return { kind: 'text', text: BLOCKED_HINT };
  if (ticket.status === 'review') return { kind: 'text', text: REVIEW_HINT };
  if (ticket.status !== 'in_progress' || !agent || agent.currentTicketId !== ticket.id) {
    return { kind: 'none' };
  }
  if (agent.step.available) return { kind: 'buttons', hint: STEP_HINT };
  return agent.step.reason ? { kind: 'text', text: agent.step.reason } : { kind: 'none' };
}

/** UI-AC-81: tail line text for a Running session; null for any other session. */
export function tailText(
  session: Pick<SessionSummary, 'id' | 'status'>,
  ticket: TicketLike,
  agent: AgentLike | undefined,
): string | null {
  if (session.status !== 'running') return null;
  if (!agent || agent.currentSessionId !== session.id || agent.currentTicketId !== ticket.id) {
    return 'session open, agent is on other work';
  }
  if (isBlocked(ticket)) return 'waiting for your answer above';
  if (agent.currentTool) return `${agent.currentTool.name} ${agent.currentTool.arg} … running`;
  if (agent.step.available) return 'waiting for the next step';
  return 'idle';
}

/** `<in> in · <out> out · <cache read> cache · $<step cost>` (UI-AC-80). */
export function tokenLine(tokens: TokenUsage, costUsd: number | null): string {
  const base = `${formatTokens(tokens.input)} in · ${formatTokens(tokens.output)} out · ${formatTokens(tokens.cacheRead)} cache`;
  return costUsd === null ? base : `${base} · ${formatMoney(costUsd)}`;
}
