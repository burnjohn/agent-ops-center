/**
 * Seed fixture document (SPEC-database §4). Generated once by `server/scripts/generate-fixture.ts` from the
 * prototype's own generator code and committed as `server/fixture/fixture.json`.
 *
 * The shape mirrors the DB tables in camelCase. Ids/`seq` that the database assigns (event `seq`/`realAt`,
 * log-entry row ids) are absent: events are an ordered array and the loader assigns `seq` in that order.
 * Decimal prices are strings so they reach `numeric` columns without floating point.
 */
import { z } from 'zod';
import {
  AgentKind,
  AgentStage,
  AgentScript,
  EVENT_PAYLOADS,
  EventCategory,
  EventSource,
  EventType,
  IsoTimestamp,
  LogEntryType,
  Priority,
  SessionStatus,
  TicketStatus,
  TokenActivity,
  TokenUsage,
  AgentId,
  SessionId,
  TicketId,
} from '@agent-ops/shared';

const Decimal = z.string().regex(/^\d+(\.\d+)?$/);

export const FixtureModelPrice = z
  .object({
    model: z.string().min(1),
    inputPerM: Decimal,
    outputPerM: Decimal,
    cacheReadPerM: Decimal,
    cacheWritePerM: Decimal,
  })
  .strict();

export const FixtureTicket = z
  .object({
    id: TicketId,
    number: z.number().int().min(1),
    title: z.string().min(1),
    description: z.string(),
    acceptanceCriteria: z.array(z.string()),
    priority: Priority,
    status: TicketStatus,
    assigneeId: AgentId.nullable(),
    blockedQuestion: z.string().nullable(),
    answer: z.string().nullable(),
    reviewSummary: z.string().nullable(),
    resultLink: z.string().nullable(),
    reviewComment: z.string().nullable(),
    lastUpdateText: z.string().nullable(),
    lastUpdateAt: IsoTimestamp.nullable(),
    createdAt: IsoTimestamp,
    updatedAt: IsoTimestamp,
  })
  .strict();

export const FixtureAgent = z
  .object({
    id: AgentId,
    name: z.string().min(1),
    kind: AgentKind,
    model: z.string().min(1),
    stage: AgentStage,
    currentTicketId: TicketId.nullable(),
    currentSessionId: SessionId.nullable(),
    currentToolName: z.string().nullable(),
    currentToolArg: z.string().nullable(),
    currentToolStartedAt: IsoTimestamp.nullable(),
    lastToolName: z.string().nullable(),
    lastToolArg: z.string().nullable(),
    lastToolOk: z.boolean().nullable(),
    lastToolAt: IsoTimestamp.nullable(),
    lastSeenAt: IsoTimestamp,
    createdAt: IsoTimestamp,
  })
  .strict();

export const FixtureAgentSimState = z
  .object({
    agentId: AgentId,
    scenario: z.string().min(1),
    script: AgentScript,
    silent: z.boolean(),
    pendingRefusalTicketId: TicketId.nullable(),
    cooldownSteps: z.number().int().min(0),
  })
  .strict();

export const FixtureLogEntry = z
  .object({
    ordinal: z.number().int().min(0),
    at: IsoTimestamp,
    kind: LogEntryType,
    text: z.string().nullable(),
    stage: AgentStage.nullable(),
    toolName: z.string().nullable(),
    toolArg: z.string().nullable(),
    toolOk: z.boolean().nullable(),
    toolResult: z.string().nullable(),
    toolDurationSec: z.number().int().min(0).nullable(),
    toolOutput: z.string().nullable(),
    tokens: TokenUsage.nullable(),
    tokenActivity: TokenActivity.nullable(),
  })
  .strict();

export const FixtureSession = z
  .object({
    id: SessionId,
    number: z.number().int().min(1),
    agentId: AgentId,
    ticketId: TicketId.nullable(),
    model: z.string().min(1),
    status: SessionStatus,
    startedAt: IsoTimestamp,
    endedAt: IsoTimestamp.nullable(),
    entries: z.array(FixtureLogEntry),
  })
  .strict();

export const FixtureEvent = z
  .object({
    at: IsoTimestamp,
    source: EventSource,
    category: EventCategory,
    type: EventType,
    agentId: AgentId.nullable(),
    ticketId: TicketId.nullable(),
    sessionId: SessionId.nullable(),
    payload: z.record(z.string(), z.unknown()),
    warn: z.boolean(),
  })
  .strict()
  .superRefine((ev, ctx) => {
    const res = EVENT_PAYLOADS[ev.type].safeParse(ev.payload);
    if (!res.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['payload'],
        message: `payload does not match ${ev.type}: ${res.error.message}`,
      });
    }
  });

export const FixtureData = z
  .object({
    version: z.literal(1),
    seed: z.number().int(),
    clockAt: IsoTimestamp,
    nextTicketNumber: z.number().int().min(1),
    nextSessionNumber: z.number().int().min(1),
    modelPrices: z.array(FixtureModelPrice),
    tickets: z.array(FixtureTicket),
    agents: z.array(FixtureAgent),
    agentSimStates: z.array(FixtureAgentSimState),
    sessions: z.array(FixtureSession),
    events: z.array(FixtureEvent),
  })
  .strict();

export type FixtureModelPrice = z.infer<typeof FixtureModelPrice>;
export type FixtureTicket = z.infer<typeof FixtureTicket>;
export type FixtureAgent = z.infer<typeof FixtureAgent>;
export type FixtureAgentSimState = z.infer<typeof FixtureAgentSimState>;
export type FixtureLogEntry = z.infer<typeof FixtureLogEntry>;
export type FixtureSession = z.infer<typeof FixtureSession>;
export type FixtureEvent = z.infer<typeof FixtureEvent>;
export type FixtureData = z.infer<typeof FixtureData>;

/** Parses and validates an untrusted fixture document (throws a `ZodError` on mismatch). */
export function parseFixtureData(json: unknown): FixtureData {
  return FixtureData.parse(json);
}
