/**
 * Event catalogue (SPEC-server-api §C5) and the `Event` contract (§C2).
 *
 * Every payload carries `summary: string` — the English display line. Fixture events keep the
 * prototype's text verbatim as their `summary` (e.g. `agent.heartbeat` reads "Checked review status").
 */
import { z } from 'zod';
import {
  AgentHealth,
  AgentStage,
  EventCategory,
  EventSource,
  SessionStatus,
  StepMode,
  TicketStatus,
} from './enums.js';
import { AgentId, IsoTimestamp, NonNegativeInt, SessionId, TicketId } from './primitives.js';
import { LogEntry, Ticket } from './resources.js';

export const EVENT_TYPES = [
  'ticket.created',
  'ticket.moved',
  'ticket.assigned',
  'ticket.released',
  'ticket.reopened',
  'ticket.approved',
  'ticket.changes_requested',
  'ticket.unblocked',
  'ticket.updated',
  'ticket.blocked',
  'ticket.answer_read',
  'ticket.comment_read',
  'ticket.submitted',
  'agent.stage_changed',
  'agent.refused',
  'agent.connected',
  'agent.heartbeat',
  'agent.health_changed',
  'tool.started',
  'tool.finished',
  'tool.failed',
  'session.started',
  'session.ended',
  'log.appended',
  'simulation.stepped',
  'simulation.play_changed',
] as const;
export const EventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventType>;

/** `never`/`always`, or a rule evaluated on the payload (see `isWarnEvent`). */
export type WarnRule = 'never' | 'always' | 'unless_online' | 'if_failed';

export interface EventCatalogueEntry {
  /** Allowed sources. `ticket.assigned` has two variants: operator (claim:false) / agent_report (claim:true). */
  source: readonly EventSource[];
  category: EventCategory;
  warn: WarnRule;
  /** Shown in feeds (Event Log, ticket activity, Said vs did, Events/min). Journal-only types go through the stream only. */
  feed: boolean;
}

const e = (
  source: EventSource | readonly EventSource[],
  category: EventCategory,
  warn: WarnRule,
  feed: boolean,
): EventCatalogueEntry => ({
  source: typeof source === 'string' ? [source] : source,
  category,
  warn,
  feed,
});

// `simulation.*` use category `agent`: the journal's category set is fixed to ticket/agent/tool.
export const EVENT_CATALOGUE: Record<EventType, EventCatalogueEntry> = {
  'ticket.created': e('operator', 'ticket', 'never', true),
  'ticket.moved': e('operator', 'ticket', 'never', true),
  'ticket.assigned': e(['operator', 'agent_report'], 'ticket', 'never', true),
  'ticket.released': e('operator', 'ticket', 'never', true),
  'ticket.reopened': e('operator', 'ticket', 'never', true),
  'ticket.approved': e('operator', 'ticket', 'never', true),
  'ticket.changes_requested': e('operator', 'ticket', 'never', true),
  'ticket.unblocked': e('operator', 'ticket', 'never', true),
  'ticket.updated': e('agent_report', 'ticket', 'never', true),
  'ticket.blocked': e('agent_report', 'ticket', 'always', true),
  'ticket.answer_read': e('agent_report', 'ticket', 'never', true),
  'ticket.comment_read': e('agent_report', 'ticket', 'never', true),
  'ticket.submitted': e('agent_report', 'ticket', 'never', true),
  'agent.stage_changed': e('agent_report', 'agent', 'never', true),
  'agent.refused': e('agent_report', 'agent', 'always', true),
  'agent.connected': e('agent_report', 'agent', 'never', true),
  'agent.heartbeat': e('agent_report', 'agent', 'never', false),
  'agent.health_changed': e('system', 'agent', 'unless_online', false),
  'tool.started': e('agent_telemetry', 'tool', 'never', true),
  'tool.finished': e('agent_telemetry', 'tool', 'never', true),
  'tool.failed': e('agent_telemetry', 'tool', 'always', true),
  'session.started': e('system', 'agent', 'never', false),
  'session.ended': e('system', 'agent', 'if_failed', false),
  'log.appended': e('system', 'agent', 'never', false),
  'simulation.stepped': e('system', 'agent', 'never', false),
  'simulation.play_changed': e('operator', 'agent', 'never', false),
};

const summary = z.string();
const toolPayload = {
  summary,
  tool: z.string(),
  arg: z.string(),
  durationSec: z.number().min(0),
  result: z.string(),
};

/** Payload schema per event type (always includes `summary`). */
export const EVENT_PAYLOADS = {
  'ticket.created': z.object({ summary, ticket: Ticket }).strict(),
  'ticket.moved': z.object({ summary, from: TicketStatus, to: TicketStatus }).strict(),
  'ticket.assigned': z.union([
    z
      .object({
        summary,
        from: TicketStatus,
        agentId: AgentId,
        sessionId: SessionId,
        claim: z.literal(false),
      })
      .strict(),
    z
      .object({
        summary,
        from: z.literal('ready'),
        agentId: AgentId,
        sessionId: SessionId,
        claim: z.literal(true),
      })
      .strict(),
  ]),
  'ticket.released': z.object({ summary, agentId: AgentId }).strict(),
  'ticket.reopened': z.object({ summary, to: TicketStatus }).strict(),
  'ticket.approved': z.object({ summary, agentId: AgentId }).strict(),
  'ticket.changes_requested': z
    .object({ summary, comment: z.string(), agentId: AgentId, sessionId: SessionId })
    .strict(),
  'ticket.unblocked': z.object({ summary, answer: z.string(), agentId: AgentId }).strict(),
  'ticket.updated': z
    .object({ summary, text: z.string(), progress: z.number().int().min(0).max(100) })
    .strict(),
  'ticket.blocked': z.object({ summary, question: z.string() }).strict(),
  'ticket.answer_read': z.object({ summary }).strict(),
  'ticket.comment_read': z.object({ summary }).strict(),
  'ticket.submitted': z
    .object({ summary, reviewSummary: z.string(), resultLink: z.string() })
    .strict(),
  'agent.stage_changed': z.object({ summary, from: AgentStage, to: AgentStage }).strict(),
  'agent.refused': z.object({ summary, reason: z.string() }).strict(),
  'agent.connected': z.object({ summary }).strict(),
  'agent.heartbeat': z.object({ summary }).strict(),
  'agent.health_changed': z.object({ summary, from: AgentHealth, to: AgentHealth }).strict(),
  'tool.started': z.object({ summary, tool: z.string(), arg: z.string() }).strict(),
  'tool.finished': z.object(toolPayload).strict(),
  'tool.failed': z.object(toolPayload).strict(),
  'session.started': z.object({ summary, model: z.string() }).strict(),
  'session.ended': z.object({ summary, status: SessionStatus }).strict(),
  'log.appended': z.object({ summary, entry: LogEntry }).strict(),
  'simulation.stepped': z
    .object({
      summary,
      mode: z.union([StepMode, z.enum(['step_all', 'play'])]),
      clock: IsoTimestamp,
      actedAgentIds: z.array(AgentId),
    })
    .strict(),
  'simulation.play_changed': z.object({ summary, playing: z.boolean() }).strict(),
} as const satisfies Record<EventType, z.ZodType>;

const eventBase = {
  seq: NonNegativeInt,
  at: IsoTimestamp,
  realAt: IsoTimestamp,
  source: EventSource,
  category: EventCategory,
  agentId: AgentId.nullable(),
  ticketId: TicketId.nullable(),
  sessionId: SessionId.nullable(),
  warn: z.boolean(),
};

function member<T extends EventType>(type: T) {
  return z.object({ ...eventBase, type: z.literal(type), payload: EVENT_PAYLOADS[type] }).strict();
}

/** Discriminated on `type`. */
export const Event = z.discriminatedUnion('type', [
  member('ticket.created'),
  member('ticket.moved'),
  member('ticket.assigned'),
  member('ticket.released'),
  member('ticket.reopened'),
  member('ticket.approved'),
  member('ticket.changes_requested'),
  member('ticket.unblocked'),
  member('ticket.updated'),
  member('ticket.blocked'),
  member('ticket.answer_read'),
  member('ticket.comment_read'),
  member('ticket.submitted'),
  member('agent.stage_changed'),
  member('agent.refused'),
  member('agent.connected'),
  member('agent.heartbeat'),
  member('agent.health_changed'),
  member('tool.started'),
  member('tool.finished'),
  member('tool.failed'),
  member('session.started'),
  member('session.ended'),
  member('log.appended'),
  member('simulation.stepped'),
  member('simulation.play_changed'),
]);
export type Event = z.infer<typeof Event>;

/** True when the event type is shown in feeds (§C5 `feed` column). */
export function isFeedEvent(event: { type: EventType }): boolean {
  return EVENT_CATALOGUE[event.type].feed;
}

/** Catalogue warn rule applied to a concrete event. */
export function isWarnEvent(event: { type: EventType; payload: unknown }): boolean {
  const rule = EVENT_CATALOGUE[event.type].warn;
  const p = event.payload as { to?: unknown; status?: unknown };
  if (rule === 'always') return true;
  if (rule === 'unless_online') return p.to !== 'online';
  if (rule === 'if_failed') return p.status === 'failed';
  return false;
}
