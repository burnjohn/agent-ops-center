import type { LastTool, ModelPrice, Priority, TicketStatus, ToolRef } from '@agent-ops/shared';
import type { AgentState, SessionState, TicketState } from '../../domain/index.js';
import type { StoredLogEntry } from '../../application/ports/repositories.js';
import type { agents, modelPrices, sessionLogEntries, sessions, tickets } from '../db/schema.js';

type TicketRow = typeof tickets.$inferSelect;
type AgentRow = typeof agents.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;
type EntryRow = typeof sessionLogEntries.$inferSelect;
type PriceRow = typeof modelPrices.$inferSelect;

const iso = (d: Date): string => d.toISOString();
const isoOrNull = (d: Date | null): string | null => (d === null ? null : d.toISOString());
const dateOrNull = (s: string | null): Date | null => (s === null ? null : new Date(s));

// ---- tickets ----------------------------------------------------------------------------------

export function ticketToDomain(r: TicketRow): TicketState {
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    description: r.description,
    acceptanceCriteria: r.acceptanceCriteria,
    priority: r.priority as Priority,
    status: r.status as TicketStatus,
    assigneeId: r.assigneeId,
    blockedQuestion: r.blockedQuestion,
    answer: r.answer,
    reviewSummary: r.reviewSummary,
    resultLink: r.resultLink,
    reviewComment: r.reviewComment,
    lastUpdate:
      r.lastUpdateText !== null && r.lastUpdateAt !== null
        ? { text: r.lastUpdateText, at: iso(r.lastUpdateAt) }
        : null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export function ticketToRow(t: TicketState): TicketRow {
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    description: t.description,
    acceptanceCriteria: [...t.acceptanceCriteria],
    priority: t.priority,
    status: t.status,
    assigneeId: t.assigneeId,
    blockedQuestion: t.blockedQuestion,
    answer: t.answer,
    reviewSummary: t.reviewSummary,
    resultLink: t.resultLink,
    reviewComment: t.reviewComment,
    lastUpdateText: t.lastUpdate?.text ?? null,
    lastUpdateAt: dateOrNull(t.lastUpdate?.at ?? null),
    createdAt: new Date(t.createdAt),
    updatedAt: new Date(t.updatedAt),
  };
}

/** Mutable ticket columns (`id`, `number`, `createdAt` never change). */
export function ticketToPatch(t: TicketState): Omit<TicketRow, 'id' | 'number' | 'createdAt'> {
  const r = ticketToRow(t);
  return {
    title: r.title,
    description: r.description,
    acceptanceCriteria: r.acceptanceCriteria,
    priority: r.priority,
    status: r.status,
    assigneeId: r.assigneeId,
    blockedQuestion: r.blockedQuestion,
    answer: r.answer,
    reviewSummary: r.reviewSummary,
    resultLink: r.resultLink,
    reviewComment: r.reviewComment,
    lastUpdateText: r.lastUpdateText,
    lastUpdateAt: r.lastUpdateAt,
    updatedAt: r.updatedAt,
  };
}

// ---- agents -----------------------------------------------------------------------------------

/** `lastSessionId` and `pausedAfterRelease` have no agents column: the repository derives them. */
export interface AgentDerived {
  lastSessionId: string | null;
  pausedAfterRelease: boolean;
}

export function agentToDomain(r: AgentRow, derived: AgentDerived): AgentState {
  const currentTool: ToolRef | null =
    r.currentToolName !== null && r.currentToolArg !== null && r.currentToolStartedAt !== null
      ? { name: r.currentToolName, arg: r.currentToolArg, startedAt: iso(r.currentToolStartedAt) }
      : null;
  const lastTool: LastTool | null =
    r.lastToolName !== null &&
    r.lastToolArg !== null &&
    r.lastToolOk !== null &&
    r.lastToolAt !== null
      ? { name: r.lastToolName, arg: r.lastToolArg, ok: r.lastToolOk, at: iso(r.lastToolAt) }
      : null;
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as AgentState['kind'],
    model: r.model,
    stage: r.stage as AgentState['stage'],
    lastSeenAt: iso(r.lastSeenAt),
    currentTicketId: r.currentTicketId,
    currentSessionId: r.currentSessionId,
    lastSessionId: derived.lastSessionId ?? r.currentSessionId,
    currentTool,
    lastTool,
    pausedAfterRelease: derived.pausedAfterRelease,
  };
}

/** Mutable columns only (id, createdAt are immutable); derived fields are not stored here. */
export function agentToUpdate(a: AgentState): Omit<AgentRow, 'id' | 'createdAt'> {
  return {
    name: a.name,
    kind: a.kind,
    model: a.model,
    stage: a.stage,
    currentTicketId: a.currentTicketId,
    currentSessionId: a.currentSessionId,
    currentToolName: a.currentTool?.name ?? null,
    currentToolArg: a.currentTool?.arg ?? null,
    currentToolStartedAt: dateOrNull(a.currentTool?.startedAt ?? null),
    lastToolName: a.lastTool?.name ?? null,
    lastToolArg: a.lastTool?.arg ?? null,
    lastToolOk: a.lastTool?.ok ?? null,
    lastToolAt: dateOrNull(a.lastTool?.at ?? null),
    lastSeenAt: new Date(a.lastSeenAt),
  };
}

// ---- sessions ---------------------------------------------------------------------------------

export function sessionToDomain(r: SessionRow, entryCount: number): SessionState {
  return {
    id: r.id,
    number: r.number,
    agentId: r.agentId,
    ticketId: r.ticketId,
    model: r.model,
    status: r.status as SessionState['status'],
    startedAt: iso(r.startedAt),
    endedAt: isoOrNull(r.endedAt),
    entryCount,
  };
}

export function sessionToRow(s: SessionState): SessionRow {
  return {
    id: s.id,
    number: s.number,
    agentId: s.agentId,
    ticketId: s.ticketId,
    model: s.model,
    status: s.status,
    startedAt: new Date(s.startedAt),
    endedAt: dateOrNull(s.endedAt),
  };
}

/** Mutable session columns (`id`, `number`, `agentId` never change). */
export function sessionToPatch(s: SessionState): Omit<SessionRow, 'id' | 'number' | 'agentId'> {
  return {
    ticketId: s.ticketId,
    model: s.model,
    status: s.status,
    startedAt: new Date(s.startedAt),
    endedAt: dateOrNull(s.endedAt),
  };
}

export function entryToDomain(r: EntryRow): StoredLogEntry {
  return {
    index: r.ordinal,
    at: iso(r.at),
    type: r.kind as StoredLogEntry['type'],
    text: r.text,
    stage: r.stage as StoredLogEntry['stage'],
    tool:
      r.toolName !== null
        ? {
            name: r.toolName,
            arg: r.toolArg ?? '',
            ok: r.toolOk ?? false,
            result: r.toolResult ?? '',
            durationSec: r.toolDurationSec ?? 0,
            output: r.toolOutput,
          }
        : null,
    tokens:
      r.inputTokens !== null
        ? {
            input: r.inputTokens,
            output: r.outputTokens ?? 0,
            cacheRead: r.cacheReadTokens ?? 0,
            cacheWrite: r.cacheWriteTokens ?? 0,
          }
        : null,
    activity: r.tokenActivity as StoredLogEntry['activity'],
  };
}

export function entryToRow(sessionId: string, e: StoredLogEntry): Omit<EntryRow, 'id'> {
  return {
    sessionId,
    ordinal: e.index,
    at: new Date(e.at),
    kind: e.type,
    text: e.text,
    stage: e.stage,
    toolName: e.tool?.name ?? null,
    toolArg: e.tool?.arg ?? null,
    toolOk: e.tool?.ok ?? null,
    toolResult: e.tool?.result ?? null,
    toolDurationSec: e.tool?.durationSec ?? null,
    toolOutput: e.tool?.output ?? null,
    inputTokens: e.tokens?.input ?? null,
    outputTokens: e.tokens?.output ?? null,
    cacheReadTokens: e.tokens?.cacheRead ?? null,
    cacheWriteTokens: e.tokens?.cacheWrite ?? null,
    tokenActivity: e.tokens === null ? null : e.activity,
  };
}

// ---- prices -----------------------------------------------------------------------------------

export function priceToDomain(r: PriceRow): ModelPrice {
  return {
    model: r.model,
    inputPerM: Number(r.inputPerM),
    outputPerM: Number(r.outputPerM),
    cacheReadPerM: Number(r.cacheReadPerM),
    cacheWritePerM: Number(r.cacheWritePerM),
  };
}
