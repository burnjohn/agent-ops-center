import type {
  AgentHealth,
  AgentKind,
  AgentStage,
  EventSource,
  Priority,
  SessionStatus,
  TicketStatus,
  TokenActivity,
} from '@agent-ops/shared';

export const STATUS_LABEL: Record<TicketStatus, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

/** Board column numbers `01`…`05`. */
export const STATUS_NUMBER: Record<TicketStatus, string> = {
  backlog: '01',
  ready: '02',
  in_progress: '03',
  review: '04',
  done: '05',
};

export const STAGE_LABEL: Record<AgentStage, string> = {
  idle: 'Idle',
  planning: 'Planning',
  implementing: 'Implementing',
  testing: 'Testing',
  awaiting_review: 'Awaiting Review',
};

/** Stage badges `00`…`04`. */
export const STAGE_BADGE: Record<AgentStage, string> = {
  idle: '00',
  planning: '01',
  implementing: '02',
  testing: '03',
  awaiting_review: '04',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

export const HEALTH_LABEL: Record<AgentHealth, { glyph: string; word: string }> = {
  online: { glyph: '■', word: 'ONLINE' },
  stale: { glyph: '◐', word: 'STALE' },
  offline: { glyph: '□', word: 'OFFLINE' },
};

export const KIND_LABEL: Record<AgentKind, string> = {
  real: 'REAL · CLAUDE CODE',
  simulated: 'SIMULATED',
};

export const SOURCE_LABEL: Record<EventSource, { glyph: string; name: string }> = {
  operator: { glyph: '●', name: 'Operator' },
  agent_report: { glyph: '■', name: 'Agent Report' },
  agent_telemetry: { glyph: '◆', name: 'Agent Telemetry' },
  system: { glyph: '—', name: 'System' },
};

export const SESSION_STATUS_LABEL: Record<SessionStatus, { glyph: string; word: string }> = {
  running: { glyph: '●', word: 'RUNNING' },
  completed: { glyph: '■', word: 'DONE' },
  failed: { glyph: '▲', word: 'FAILED' },
};

export const ACTIVITY_LABEL: Record<TokenActivity, string> = {
  reasoning_replies: 'Reasoning & replies',
  reading_code: 'Reading code',
  editing_code: 'Editing code',
  running_commands: 'Running commands',
  agent_ops: 'Agent Ops (MCP calls)',
  session_context: 'Session context',
  other: 'Other',
};
