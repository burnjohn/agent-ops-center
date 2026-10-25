import {
  AgentListResponse,
  AgentPageResponse,
  TicketListResponse,
  TicketDetailResponse,
} from '@agent-ops/shared';
import { describe, expect, it } from 'vitest';
import type { AgentState, SessionState, TicketState } from '../../domain/index.js';
import { createTestPorts } from '../testing/index.js';
import { getAgent } from './get-agent.js';
import { getAgentPage } from './get-agent-page.js';
import { getTicket } from './get-ticket.js';
import { listAgents } from './list-agents.js';
import { listTickets } from './list-tickets.js';

const NOW = '2026-10-24T14:32:00.000Z';
const ago = (sec: number) => new Date(Date.parse(NOW) - sec * 1000).toISOString();

function agent(id: string, over: Partial<AgentState> = {}): AgentState {
  return {
    id,
    name: id,
    kind: 'real',
    model: 'm',
    stage: 'implementing',
    lastSeenAt: ago(5),
    currentTicketId: null,
    currentSessionId: null,
    lastSessionId: null,
    currentTool: null,
    lastTool: null,
    pausedAfterRelease: false,
    ...over,
  } as AgentState;
}

function ticket(n: number, over: Partial<TicketState> = {}): TicketState {
  return {
    id: `T-${n}`,
    number: n,
    title: `t${n}`,
    description: '',
    acceptanceCriteria: [],
    priority: 'medium',
    status: 'backlog',
    assigneeId: null,
    blockedQuestion: null,
    answer: null,
    reviewSummary: null,
    resultLink: null,
    reviewComment: null,
    lastUpdate: null,
    createdAt: ago(10_000 - n),
    updatedAt: ago(10_000 - n),
    ...over,
  };
}

function session(n: number, over: Partial<SessionState> = {}): SessionState {
  return {
    id: `S-${String(n).padStart(4, '0')}`,
    number: n,
    agentId: 'a1',
    ticketId: 'T-1',
    model: 'm',
    startedAt: ago(5000 - n * 100),
    endedAt: null,
    status: 'running',
    entryCount: 0,
    ...over,
  };
}

function fixture() {
  const ports = createTestPorts();
  const s = ports.store;
  s.seedPrice({
    model: 'm',
    inputPerM: 3,
    outputPerM: 15,
    cacheReadPerM: 0.3,
    cacheWritePerM: 3.75,
  });
  // online 4/6: a1..a4 fresh; a5 stale (60 s); a6 offline (300 s)
  s.seedAgent(agent('a1', { currentTicketId: 'T-1', currentSessionId: 'S-0002' }));
  s.seedAgent(agent('a2', { currentTicketId: 'T-2' }));
  s.seedAgent(agent('a3'));
  s.seedAgent(agent('a4'));
  s.seedAgent(agent('a5', { lastSeenAt: ago(60) }));
  s.seedAgent(agent('a6', { lastSeenAt: ago(300) }));
  s.seedTicket(ticket(1, { status: 'in_progress', assigneeId: 'a1', priority: 'low' }));
  s.seedTicket(
    ticket(2, { status: 'in_progress', assigneeId: 'a2', blockedQuestion: 'which db?' }),
  );
  s.seedTicket(ticket(3, { status: 'review' }));
  s.seedTicket(ticket(4, { status: 'review' }));
  s.seedTicket(ticket(5, { status: 'ready', priority: 'low' }));
  s.seedTicket(ticket(6, { status: 'ready', priority: 'high' }));
  s.seedTicket(ticket(7, { status: 'done', updatedAt: ago(100) }));
  s.seedTicket(ticket(8, { status: 'done', updatedAt: ago(50) }));
  s.seedSession(session(1, { status: 'completed', endedAt: ago(4000) }));
  s.seedSession(session(2));
  return ports;
}

describe('listAgents', () => {
  it('derives health, step and cost; online 4/6, blocked 1, review 2', async () => {
    const ports = fixture();
    const { data } = await listAgents(ports.snapshots);
    AgentListResponse.parse(data);
    expect(data.filter((a) => a.health === 'online')).toHaveLength(4);
    expect(data.map((a) => a.health).slice(4)).toEqual(['stale', 'offline']);
    const a2 = data.find((a) => a.id === 'a2');
    expect(a2?.step).toEqual({ available: false, reason: 'Blocked — answer above to continue' });
    const tickets = (await listTickets(ports.snapshots)).data;
    expect(tickets.filter((t) => t.blockedQuestion !== null)).toHaveLength(1);
    expect(tickets.filter((t) => t.status === 'review')).toHaveLength(2);
  });

  it('idle agent with a queued script action has step available (API-AC-45)', async () => {
    const ports = fixture();
    ports.store.data.simState.set('a1', {
      agentId: 'a1',
      scenario: 'default',
      script: {
        version: 1,
        queue: [{ kind: 'think' }] as never,
        askedTicketIds: [],
        prngState: 1,
      } as never,
      silent: false,
      pendingRefusalTicketId: null,
      cooldownSteps: 0,
    } as never);
    const { data } = await getAgent(ports.snapshots, 'a1');
    expect(data?.currentTool).toBeNull();
    expect(data?.step).toEqual({ available: true, reason: null });
  });

  it('a running tool older than 600 s lets health fall back to last-seen', async () => {
    const ports = fixture();
    ports.store.seedAgent(
      agent('a1', {
        lastSeenAt: ago(300),
        currentTool: { name: 'Bash', arg: '', startedAt: ago(700) },
      }),
    );
    expect((await getAgent(ports.snapshots, 'a1')).data?.health).toBe('offline');
    ports.store.seedAgent(
      agent('a1', {
        lastSeenAt: ago(300),
        currentTool: { name: 'Bash', arg: '', startedAt: ago(30) },
      }),
    );
    expect((await getAgent(ports.snapshots, 'a1')).data?.health).toBe('online');
  });

  it('unknown agent / ticket -> data null', async () => {
    const ports = fixture();
    expect((await getAgent(ports.snapshots, 'nope')).data).toBeNull();
    expect((await getAgentPage(ports.snapshots, 'nope')).data).toBeNull();
    expect((await getTicket(ports.snapshots, 'T-99')).data).toBeNull();
  });

  it('agent page and ticket detail parse; sessions newest first', async () => {
    const ports = fixture();
    const page = (await getAgentPage(ports.snapshots, 'a1')).data;
    AgentPageResponse.parse(page);
    expect(page?.sessionsTotal).toBe(2);
    const detail = (await getTicket(ports.snapshots, 'T-1')).data;
    TicketDetailResponse.parse(detail);
    expect(detail?.sessions.map((x) => x.id)).toEqual(['S-0002', 'S-0001']);
    expect(detail?.sessions.map((x) => x.costIsFinal)).toEqual([false, true]);
  });
});

describe('listTickets order (AC-23)', () => {
  it('status, priority then age; Done by updatedAt newest first', async () => {
    const { data } = await listTickets(fixture().snapshots);
    TicketListResponse.parse(data);
    expect(data.map((t) => t.id)).toEqual(['T-6', 'T-5', 'T-2', 'T-1', 'T-3', 'T-4', 'T-8', 'T-7']);
    const ready = data.filter((t) => t.status === 'ready').map((t) => t.id);
    expect(ready).toEqual(['T-6', 'T-5']);
    expect(data.filter((t) => t.status === 'done').map((t) => t.id)).toEqual(['T-8', 'T-7']);
  });
});
