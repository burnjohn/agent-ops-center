import { describe, expect, it } from 'vitest';
import { session as sessionRules, type AgentState } from '../../domain/index.js';
import { createTestPorts } from '../testing/index.js';
import { advanceClock } from './clock-advance.js';

const T0 = '2026-10-24T14:32:00.000Z';

const agent = (id: string, over: Partial<AgentState> = {}): AgentState =>
  ({
    id,
    name: id,
    kind: 'simulated',
    model: 'm',
    stage: 'idle',
    lastSeenAt: T0,
    currentTicketId: null,
    currentSessionId: null,
    lastSessionId: null,
    currentTool: null,
    lastTool: null,
    pausedAfterRelease: false,
    ...over,
  }) as AgentState;

const simState = (agentId: string, silent = false) => ({
  agentId,
  scenario: 's',
  script: { version: 1 as const, queue: [], askedTicketIds: [], prngState: 1 },
  silent,
  pendingRefusalTicketId: null,
  cooldownSteps: 0,
});

async function step(p: ReturnType<typeof createTestPorts>, acted: string[] = []) {
  return p.uow.run(async (tx) => {
    const drafts = await advanceClock(tx, { actedAgentIds: new Set(acted) });
    await tx.appendEvents(drafts);
    return drafts;
  });
}

describe('advanceClock', () => {
  it('advances 6 s and keeps a responsive agent online with one heartbeat per step', async () => {
    const p = createTestPorts();
    p.store.seedAgent(agent('sim-1'));
    p.store.data.simState.set('sim-1', simState('sim-1'));
    for (let i = 0; i < 20; i++) await step(p);
    expect(p.clock.now()).toBe('2026-10-24T14:34:00.000Z');
    const types = p.store.events.map((e) => e.type);
    expect(types.filter((t) => t === 'agent.heartbeat')).toHaveLength(20);
    expect(types).not.toContain('agent.health_changed');
  });

  it('skips heartbeats for agents that acted', async () => {
    const p = createTestPorts();
    p.store.seedAgent(agent('sim-1'));
    const drafts = await step(p, ['sim-1']);
    expect(drafts).toHaveLength(0);
  });

  it('never refreshes a silent agent; it goes stale then offline with one change each', async () => {
    const p = createTestPorts();
    p.store.seedAgent(agent('sim-3'));
    p.store.data.simState.set('sim-3', simState('sim-3', true));
    for (let i = 0; i < 25; i++) await step(p);
    const changes = p.store.events.filter((e) => e.type === 'agent.health_changed');
    expect(changes.map((e) => [e.payload.from, e.payload.to])).toEqual([
      ['online', 'stale'],
      ['stale', 'offline'],
    ]);
    expect(p.store.events.some((e) => e.type === 'agent.heartbeat')).toBe(false);
  });

  it('turns a stale agent offline exactly once after lastSeen + 120 s', async () => {
    const p = createTestPorts();
    p.store.seedAgent(agent('sim-2', { lastSeenAt: '2026-10-24T14:31:15.000Z' }));
    for (let i = 0; i < 13; i++) await step(p);
    const changes = p.store.events.filter((e) => e.type === 'agent.health_changed');
    expect(changes).toHaveLength(1);
    expect(changes[0]?.payload).toMatchObject({ from: 'stale', to: 'offline' });
    expect(p.store.events.some((e) => e.type === 'agent.heartbeat')).toBe(false);
  });

  it('fails a running session when its agent goes offline', async () => {
    const p = createTestPorts();
    p.store.seedAgent(agent('sim-3', { currentSessionId: 'S-0001', stage: 'implementing' }));
    p.store.data.simState.set('sim-3', simState('sim-3', true));
    p.store.seedSession(
      sessionRules.startSession({
        number: 1,
        agentId: 'sim-3',
        ticketId: null,
        model: 'm',
        now: T0,
      }),
    );
    for (let i = 0; i < 25; i++) await step(p);
    const s = [...p.store.data.sessions.values()][0];
    expect(s?.status).toBe('failed');
    const entries = [...p.store.data.entries.values()][0] ?? [];
    expect(entries.map((e) => e.text)).toContain('Session interrupted — agent went Offline');
    expect(p.store.events.filter((e) => e.type === 'session.ended')).toHaveLength(1);
  });
});
