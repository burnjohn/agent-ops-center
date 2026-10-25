import { describe, expect, it } from 'vitest';
import {
  Agent,
  CommandResult,
  SessionDetail,
  SimulationState,
  Ticket,
  TokenUsage,
} from './resources.js';

const at = '2026-10-24T10:00:00.000Z';
const tokens = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 };

const ticket = {
  id: 'T-1',
  number: 1,
  title: 't',
  description: '',
  acceptanceCriteria: [],
  priority: 'high',
  status: 'backlog',
  assigneeId: null,
  blockedQuestion: null,
  answer: null,
  reviewSummary: null,
  resultLink: null,
  reviewComment: null,
  lastUpdate: null,
  createdAt: at,
  updatedAt: at,
};
const agent = {
  id: 'alpha',
  name: 'Alpha',
  kind: 'real',
  model: 'm',
  stage: 'idle',
  health: 'online',
  lastSeenAt: at,
  currentTicketId: null,
  currentSessionId: null,
  lastSessionId: null,
  currentTool: null,
  lastTool: null,
  pausedAfterRelease: false,
  costTodayUsd: 0.5,
  step: { available: false, reason: 'No ticket' },
};
const summary = {
  id: 'S-0416',
  agentId: 'alpha',
  ticketId: 'T-1',
  model: 'm',
  startedAt: at,
  endedAt: null,
  status: 'running',
  tokens,
  costUsd: 0.1,
  costIsFinal: false,
  entryCount: 0,
};

describe('resources', () => {
  it('parses valid objects', () => {
    expect(Ticket.safeParse(ticket).success).toBe(true);
    expect(Agent.safeParse(agent).success).toBe(true);
    expect(TokenUsage.safeParse(tokens).success).toBe(true);
    expect(CommandResult.safeParse({ seq: 3, ticket, agent }).success).toBe(true);
  });
  it('rejects unknown keys (strict)', () => {
    expect(Ticket.safeParse({ ...ticket, extra: 1 }).success).toBe(false);
    expect(
      Agent.safeParse({ ...agent, step: { available: true, reason: null, x: 1 } }).success,
    ).toBe(false);
  });
  it('rejects bad enum / id values', () => {
    expect(Ticket.safeParse({ ...ticket, id: 'T-01' }).success).toBe(false);
    expect(Ticket.safeParse({ ...ticket, status: 'In Progress' }).success).toBe(false);
  });
  it('SessionDetail extends the summary', () => {
    const detail = {
      ...summary,
      dataSource: 'mock',
      entries: [],
      costByType: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      tokenActivity: [],
      topSteps: [],
      stages: [{ stage: 'planning', from: at, to: null }],
    };
    expect(SessionDetail.safeParse(detail).success).toBe(true);
    expect(SessionDetail.safeParse({ ...detail, dataSource: 'live' }).success).toBe(false);
  });
  it('SimulationState carries thresholds and nextTicketId', () => {
    const s = {
      clock: at,
      playing: false,
      held: false,
      lastSeq: 5,
      journalFloorSeq: 0,
      stepSeconds: 6,
      playIntervalMs: 1600,
      nextTicketId: 'T-9',
      healthThresholds: { staleAfterSec: 30, offlineAfterSec: 120, toolGraceSec: 600 },
    };
    expect(SimulationState.safeParse(s).success).toBe(true);
    expect(SimulationState.safeParse({ ...s, nextTicketId: 'T-09' }).success).toBe(false);
  });
});
