import type { AgentStage, TicketStatus } from '@agent-ops/shared';

/** Display names used in event summaries. Domain-local: the runtime label map is not in the type-only shared import. */
export const STATUS_LABEL: Record<TicketStatus, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

export const STAGE_LABEL: Record<AgentStage, string> = {
  idle: 'Idle',
  planning: 'Planning',
  implementing: 'Implementing',
  testing: 'Testing',
  awaiting_review: 'Awaiting review',
};
