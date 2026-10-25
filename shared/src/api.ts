import { z } from 'zod';
import { Event } from './events.js';
import {
  Period,
  Priority,
  EventCategory,
  EventSource,
  StepMode,
  StepStop,
  TicketStatus,
} from './enums.js';
import { AgentId, IsoTimestamp, Money, NonNegativeInt, SessionId, TicketId } from './primitives.js';
import { Agent, CommandResult, ModelPrice, SessionSummary, Ticket } from './resources.js';

/** Response header carrying the highest journal `seq` included in a GET snapshot (AC-71). */
export const AS_OF_SEQ_HEADER = 'X-As-Of-Seq';

// ---- Text limits (C6) -------------------------------------------------------------------------
export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 10_000;
export const CRITERIA_MAX_COUNT = 50;
export const CRITERION_MAX = 500;
export const ANSWER_MAX = 4_000;
export const COMMENT_MAX = 4_000;
export const BODY_MAX_BYTES = 64 * 1024;

export const EVENTS_LIMIT_DEFAULT = 40;
export const EVENTS_LIMIT_MAX = 200;
export const SESSIONS_LIMIT_DEFAULT = 12;
export const SESSIONS_LIMIT_MAX = 100;
export const TICKET_ACTIVITY_MAX = 30;
export const AGENT_SESSIONS_MAX = 10;

// ---- Validation messages ----------------------------------------------------------------------
export const MSG_TITLE_REQUIRED = 'Title is required.';
export const MSG_COMMENT_REQUIRED = 'A comment is required — tell the agent what to change.';
export const MSG_ANSWER_REQUIRED = 'Write an answer before unblocking.';

const tooLong = (what: string, max: number): string => `${what} must be at most ${max} characters.`;

// ---- Request schemas (all strict: unknown fields -> validation_failed) ------------------------
export const TicketIdParams = z.object({ id: TicketId }).strict();
export const SessionIdParams = z.object({ id: SessionId }).strict();
export const AgentIdParams = z.object({ id: AgentId }).strict();
export const AgentStepParams = z.object({ agentId: AgentId }).strict();

export const EmptyBody = z.object({}).strict();

export const HoldBody = z.object({ clientId: z.uuid(), held: z.boolean() }).strict();
export type HoldBody = z.infer<typeof HoldBody>;

export const AgentStepBody = z.object({ ticketId: TicketId, mode: StepMode }).strict();
export type AgentStepBody = z.infer<typeof AgentStepBody>;

export const CreateTicketBody = z
  .object({
    title: z.string().trim().min(1, MSG_TITLE_REQUIRED).max(TITLE_MAX, tooLong('Title', TITLE_MAX)),
    description: z
      .string()
      .max(DESCRIPTION_MAX, tooLong('Description', DESCRIPTION_MAX))
      .optional(),
    acceptanceCriteria: z
      .array(z.string().max(CRITERION_MAX, tooLong('A criterion', CRITERION_MAX)))
      .max(CRITERIA_MAX_COUNT, `At most ${CRITERIA_MAX_COUNT} criteria.`)
      .optional(),
    priority: Priority.optional(),
  })
  .strict();
export type CreateTicketBody = z.infer<typeof CreateTicketBody>;

export const MoveTicketBody = z
  .object({ to: TicketStatus, expectedStatus: TicketStatus, confirmed: z.boolean().optional() })
  .strict();
export type MoveTicketBody = z.infer<typeof MoveTicketBody>;

export const AssignTicketBody = z
  .object({ agentId: AgentId, expectedStatus: TicketStatus })
  .strict();
export type AssignTicketBody = z.infer<typeof AssignTicketBody>;

export const RequestChangesBody = z
  .object({
    comment: z
      .string()
      .trim()
      .min(1, MSG_COMMENT_REQUIRED)
      .max(COMMENT_MAX, tooLong('Comment', COMMENT_MAX)),
    expectedStatus: TicketStatus.optional(),
  })
  .strict();
export type RequestChangesBody = z.infer<typeof RequestChangesBody>;

export const AnswerBody = z
  .object({
    answer: z
      .string()
      .trim()
      .min(1, MSG_ANSWER_REQUIRED)
      .max(ANSWER_MAX, tooLong('Answer', ANSWER_MAX)),
  })
  .strict();
export type AnswerBody = z.infer<typeof AnswerBody>;

const limitQuery = (def: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(def);

export const EventsQuery = z
  .object({
    limit: limitQuery(EVENTS_LIMIT_DEFAULT, EVENTS_LIMIT_MAX),
    beforeSeq: z.coerce.number().int().min(1).optional(),
    source: EventSource.optional(),
    category: EventCategory.optional(),
    agentId: AgentId.optional(),
    ticketId: TicketId.optional(),
  })
  .strict();
export type EventsQuery = z.infer<typeof EventsQuery>;

export const SESSION_SORTS = [
  'start',
  'input',
  'output',
  'cacheRead',
  'cacheWrite',
  'cost',
] as const;
export const SessionSort = z.enum(SESSION_SORTS);
export type SessionSort = z.infer<typeof SessionSort>;

export const SessionsQuery = z
  .object({
    period: Period.default('30d'),
    agentId: AgentId.optional(),
    model: z.string().min(1).optional(),
    sort: SessionSort.default('start'),
    limit: limitQuery(SESSIONS_LIMIT_DEFAULT, SESSIONS_LIMIT_MAX),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type SessionsQuery = z.infer<typeof SessionsQuery>;

export const UsageQuery = z.object({ period: Period.default('30d') }).strict();
export type UsageQuery = z.infer<typeof UsageQuery>;

export const StreamQuery = z.object({ since: z.coerce.number().int().min(0).optional() }).strict();
export type StreamQuery = z.infer<typeof StreamQuery>;

// ---- Response schemas -------------------------------------------------------------------------
const DataSource = z.literal('mock');

export const HealthResponse = z.object({ ok: z.boolean(), db: z.enum(['up', 'down']) }).strict();
export type HealthResponse = z.infer<typeof HealthResponse>;

export const HoldResponse = z
  .object({ held: z.boolean(), expiresAt: IsoTimestamp.nullable() })
  .strict();
export type HoldResponse = z.infer<typeof HoldResponse>;

export const StepResult = CommandResult.extend({ steps: z.literal(1) }).strict();
export type StepResult = z.infer<typeof StepResult>;

export const AgentStepResult = CommandResult.extend({
  steps: NonNegativeInt,
  stoppedBecause: StepStop,
}).strict();
export type AgentStepResult = z.infer<typeof AgentStepResult>;

export const TicketListResponse = z.array(Ticket);

export const TicketDetailResponse = z
  .object({
    ticket: Ticket,
    activity: z.array(Event).max(TICKET_ACTIVITY_MAX),
    sessions: z.array(SessionSummary),
    dataSource: DataSource,
  })
  .strict();
export type TicketDetailResponse = z.infer<typeof TicketDetailResponse>;

export const AgentListResponse = z.array(Agent);

export const SaidVsDidRow = z
  .object({
    seq: NonNegativeInt,
    at: IsoTimestamp,
    said: z.string().nullable(),
    did: z.string().nullable(),
    mismatch: z.boolean(),
  })
  .strict();
export type SaidVsDidRow = z.infer<typeof SaidVsDidRow>;

export const SaidVsDid = z
  .object({
    rows: z.array(SaidVsDidRow),
    mismatchCount: NonNegativeInt,
    notes: z.array(z.object({ from: IsoTimestamp, to: IsoTimestamp, text: z.string() }).strict()),
  })
  .strict();
export type SaidVsDid = z.infer<typeof SaidVsDid>;

export const AgentPageResponse = z
  .object({
    agent: Agent,
    kpis: z
      .object({
        sessions7d: NonNegativeInt,
        ticketsDone: NonNegativeInt,
        toolCallsToday: NonNegativeInt,
        cost7dUsd: Money,
      })
      .strict(),
    saidVsDid: SaidVsDid,
    sessions: z.array(SessionSummary).max(AGENT_SESSIONS_MAX),
    sessionsTotal: NonNegativeInt,
    tickets: z.array(z.object({ id: TicketId, title: z.string(), status: TicketStatus }).strict()),
    dataSource: DataSource,
  })
  .strict();
export type AgentPageResponse = z.infer<typeof AgentPageResponse>;

export const OverviewResponse = z
  .object({
    agentsOnline: NonNegativeInt,
    agentsTotal: NonNegativeInt,
    blockedTickets: NonNegativeInt,
    reviewTickets: NonNegativeInt,
    eventsPerMinute: z.array(NonNegativeInt).length(12),
    clock: IsoTimestamp,
  })
  .strict();
export type OverviewResponse = z.infer<typeof OverviewResponse>;

export const EventsPageResponse = z
  .object({ items: z.array(Event), nextBeforeSeq: NonNegativeInt.nullable() })
  .strict();
export type EventsPageResponse = z.infer<typeof EventsPageResponse>;

export const SessionsPageResponse = z
  .object({
    items: z.array(SessionSummary),
    total: NonNegativeInt,
    limit: z.number().int().min(1),
    offset: NonNegativeInt,
    sort: SessionSort,
    dataSource: DataSource,
  })
  .strict();
export type SessionsPageResponse = z.infer<typeof SessionsPageResponse>;

const BreakdownItem = z
  .object({ key: z.string().nullable(), costUsd: Money, share: z.number().min(0).max(1) })
  .strict();
export type BreakdownItem = z.infer<typeof BreakdownItem>;

export const USAGE_DAYS = 30;

export const UsageResponse = z
  .object({
    period: Period,
    dataSource: DataSource,
    kpis: z
      .object({
        totalCostUsd: Money,
        tokens: NonNegativeInt,
        cacheReadShare: z.number().min(0).max(1),
        sessions: NonNegativeInt,
        runningNow: NonNegativeInt,
        avgCostUsd: Money,
        medianCostUsd: Money,
      })
      .strict(),
    costPerDay: z
      .array(
        z
          .object({
            date: z.iso.date(),
            inPeriod: z.boolean(),
            isToday: z.boolean(),
            costUsd: Money,
          })
          .strict(),
      )
      .length(USAGE_DAYS),
    peakUsd: Money,
    breakdowns: z
      .object({
        byAgent: z.array(BreakdownItem),
        byTicket: z.array(BreakdownItem),
        byModel: z.array(BreakdownItem),
        byActivity: z.array(BreakdownItem),
      })
      .strict(),
  })
  .strict();
export type UsageResponse = z.infer<typeof UsageResponse>;

export const ModelPricesResponse = z
  .object({ items: z.array(ModelPrice), dataSource: DataSource })
  .strict();
export type ModelPricesResponse = z.infer<typeof ModelPricesResponse>;
