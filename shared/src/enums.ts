import { z } from 'zod';

export const TICKET_STATUSES = ['backlog', 'ready', 'in_progress', 'review', 'done'] as const;
export const TicketStatus = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof TicketStatus>;

export const PRIORITIES = ['high', 'medium', 'low'] as const;
export const Priority = z.enum(PRIORITIES);
export type Priority = z.infer<typeof Priority>;

export const AGENT_STAGES = [
  'idle',
  'planning',
  'implementing',
  'testing',
  'awaiting_review',
] as const;
export const AgentStage = z.enum(AGENT_STAGES);
export type AgentStage = z.infer<typeof AgentStage>;

export const AGENT_HEALTHS = ['online', 'stale', 'offline'] as const;
export const AgentHealth = z.enum(AGENT_HEALTHS);
export type AgentHealth = z.infer<typeof AgentHealth>;

export const AGENT_KINDS = ['real', 'simulated'] as const;
export const AgentKind = z.enum(AGENT_KINDS);
export type AgentKind = z.infer<typeof AgentKind>;

export const SESSION_STATUSES = ['running', 'completed', 'failed'] as const;
export const SessionStatus = z.enum(SESSION_STATUSES);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const LOG_ENTRY_TYPES = ['operator', 'agent', 'tool', 'stage', 'system'] as const;
export const LogEntryType = z.enum(LOG_ENTRY_TYPES);
export type LogEntryType = z.infer<typeof LogEntryType>;

export const TOKEN_ACTIVITIES = [
  'reasoning_replies',
  'reading_code',
  'editing_code',
  'running_commands',
  'agent_ops',
  'session_context',
  'other',
] as const;
export const TokenActivity = z.enum(TOKEN_ACTIVITIES);
export type TokenActivity = z.infer<typeof TokenActivity>;

export const EVENT_SOURCES = ['operator', 'agent_report', 'agent_telemetry', 'system'] as const;
export const EventSource = z.enum(EVENT_SOURCES);
export type EventSource = z.infer<typeof EventSource>;

export const EVENT_CATEGORIES = ['ticket', 'agent', 'tool'] as const;
export const EventCategory = z.enum(EVENT_CATEGORIES);
export type EventCategory = z.infer<typeof EventCategory>;

export const PERIODS = ['today', '7d', '30d', 'all'] as const;
export const Period = z.enum(PERIODS);
export type Period = z.infer<typeof Period>;

export const STEP_MODES = ['step', 'to_next_stage'] as const;
export const StepMode = z.enum(STEP_MODES);
export type StepMode = z.infer<typeof StepMode>;

export const STEP_STOPS = ['single', 'stage_changed', 'waiting', 'no_work', 'limit'] as const;
export const StepStop = z.enum(STEP_STOPS);
export type StepStop = z.infer<typeof StepStop>;
