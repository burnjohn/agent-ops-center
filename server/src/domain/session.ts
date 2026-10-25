import type * as S from '@agent-ops/shared';
import { DomainRefusal } from './errors.js';
import { formatSessionId } from './ids.js';

export interface SessionState {
  id: string;
  number: number;
  agentId: string;
  ticketId: string | null;
  model: string;
  startedAt: string;
  endedAt: string | null;
  status: S.SessionStatus;
  /** Next per-session ordinal (= number of entries so far). */
  entryCount: number;
}

/** A log entry before cost and activity are derived. `index` is the per-session ordinal. */
export type LogEntryDraft = Omit<S.LogEntry, 'costUsd' | 'activity'>;

export interface NewEntry {
  at: string;
  type: S.LogEntryType;
  text?: string | null;
  stage?: S.AgentStage | null;
  tool?: S.LogEntry['tool'];
  tokens?: S.TokenUsage | null;
}

export function startSession(input: {
  number: number;
  agentId: string;
  ticketId: string | null;
  model: string;
  now: string;
}): SessionState {
  return {
    id: formatSessionId(input.number),
    number: input.number,
    agentId: input.agentId,
    ticketId: input.ticketId,
    model: input.model,
    startedAt: input.now,
    endedAt: null,
    status: 'running',
    entryCount: 0,
  };
}

/** Appends an entry; the ordinal is assigned here so write order is the read order. */
export function appendEntry(
  s: SessionState,
  entry: NewEntry,
): { session: SessionState; entry: LogEntryDraft } {
  if (s.status !== 'running') {
    throw new DomainRefusal('internal', `${s.id} has ended; cannot append entries.`);
  }
  return {
    session: { ...s, entryCount: s.entryCount + 1 },
    entry: {
      index: s.entryCount,
      at: entry.at,
      type: entry.type,
      text: entry.text ?? null,
      stage: entry.stage ?? null,
      tool: entry.tool ?? null,
      tokens: entry.tokens ?? null,
    },
  };
}

export function endSession(
  s: SessionState,
  status: Exclude<S.SessionStatus, 'running'>,
  now: string,
): SessionState {
  if (s.status !== 'running') {
    throw new DomainRefusal('internal', `${s.id} has already ended.`);
  }
  return { ...s, status, endedAt: now };
}
