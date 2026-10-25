import { z } from 'zod';
import {
  AgentHealth,
  AgentKind,
  AgentStage,
  LogEntryType,
  Priority,
  SessionStatus,
  TicketStatus,
  TokenActivity,
} from './enums.js';
import { AgentId, IsoTimestamp, Money, NonNegativeInt, SessionId, TicketId } from './primitives.js';

export const TokenUsage = z
  .object({
    input: NonNegativeInt,
    output: NonNegativeInt,
    cacheRead: NonNegativeInt,
    cacheWrite: NonNegativeInt,
  })
  .strict();
export type TokenUsage = z.infer<typeof TokenUsage>;

export const Ticket = z
  .object({
    id: TicketId,
    number: z.number().int().min(1),
    title: z.string(),
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
    lastUpdate: z.object({ text: z.string(), at: IsoTimestamp }).strict().nullable(),
    createdAt: IsoTimestamp,
    updatedAt: IsoTimestamp,
  })
  .strict();
export type Ticket = z.infer<typeof Ticket>;

export const ToolRef = z
  .object({ name: z.string(), arg: z.string(), startedAt: IsoTimestamp })
  .strict();
export type ToolRef = z.infer<typeof ToolRef>;

export const LastTool = z
  .object({ name: z.string(), arg: z.string(), ok: z.boolean(), at: IsoTimestamp })
  .strict();
export type LastTool = z.infer<typeof LastTool>;

export const Agent = z
  .object({
    id: AgentId,
    name: z.string(),
    kind: AgentKind,
    model: z.string(),
    stage: AgentStage,
    health: AgentHealth,
    lastSeenAt: IsoTimestamp,
    currentTicketId: TicketId.nullable(),
    currentSessionId: SessionId.nullable(),
    lastSessionId: SessionId.nullable(),
    currentTool: ToolRef.nullable(),
    lastTool: LastTool.nullable(),
    pausedAfterRelease: z.boolean(),
    costTodayUsd: Money,
    step: z.object({ available: z.boolean(), reason: z.string().nullable() }).strict(),
  })
  .strict();
export type Agent = z.infer<typeof Agent>;

export const SessionSummary = z
  .object({
    id: SessionId,
    agentId: AgentId,
    ticketId: TicketId.nullable(),
    model: z.string(),
    startedAt: IsoTimestamp,
    endedAt: IsoTimestamp.nullable(),
    status: SessionStatus,
    tokens: TokenUsage,
    costUsd: Money,
    costIsFinal: z.boolean(),
    entryCount: NonNegativeInt,
  })
  .strict();
export type SessionSummary = z.infer<typeof SessionSummary>;

export const LogEntry = z
  .object({
    index: NonNegativeInt,
    at: IsoTimestamp,
    type: LogEntryType,
    text: z.string().nullable(),
    stage: AgentStage.nullable(),
    tool: z
      .object({
        name: z.string(),
        arg: z.string(),
        ok: z.boolean(),
        result: z.string(),
        durationSec: NonNegativeInt,
        output: z.string().nullable(),
      })
      .strict()
      .nullable(),
    tokens: TokenUsage.nullable(),
    costUsd: Money.nullable(),
    activity: TokenActivity.nullable(),
  })
  .strict();
export type LogEntry = z.infer<typeof LogEntry>;

export const SessionDetail = SessionSummary.extend({
  dataSource: z.literal('mock'),
  entries: z.array(LogEntry),
  costByType: z
    .object({ input: Money, output: Money, cacheRead: Money, cacheWrite: Money })
    .strict(),
  tokenActivity: z.array(
    z
      .object({
        activity: TokenActivity,
        steps: NonNegativeInt,
        tokens: TokenUsage,
        costUsd: Money,
        share: z.number().min(0),
      })
      .strict(),
  ),
  topSteps: z
    .array(
      z
        .object({ index: NonNegativeInt, at: IsoTimestamp, label: z.string(), costUsd: Money })
        .strict(),
    )
    .max(5),
  stages: z.array(
    z.object({ stage: AgentStage, from: IsoTimestamp, to: IsoTimestamp.nullable() }).strict(),
  ),
}).strict();
export type SessionDetail = z.infer<typeof SessionDetail>;

export const ModelPrice = z
  .object({
    model: z.string(),
    inputPerM: Money,
    outputPerM: Money,
    cacheReadPerM: Money,
    cacheWritePerM: Money,
  })
  .strict();
export type ModelPrice = z.infer<typeof ModelPrice>;

export const SimulationState = z
  .object({
    clock: IsoTimestamp,
    playing: z.boolean(),
    held: z.boolean(),
    lastSeq: NonNegativeInt,
    journalFloorSeq: NonNegativeInt,
    stepSeconds: z.literal(6),
    playIntervalMs: z.literal(1600),
    nextTicketId: TicketId,
    healthThresholds: z
      .object({
        staleAfterSec: z.literal(30),
        offlineAfterSec: z.literal(120),
        toolGraceSec: z.literal(600),
      })
      .strict(),
  })
  .strict();
export type SimulationState = z.infer<typeof SimulationState>;

export const CommandResult = z
  .object({
    seq: NonNegativeInt,
    ticket: Ticket.optional(),
    agent: Agent.optional(),
    session: SessionSummary.optional(),
  })
  .strict();
export type CommandResult = z.infer<typeof CommandResult>;
