import {
  EventsPageResponse,
  OverviewResponse,
  SimulationState,
  type Event,
} from '@agent-ops/shared';
import { describe, expect, it } from 'vitest';
import { createTestPorts } from '../testing/index.js';
import { getOverview } from './get-overview.js';
import { getSimulationState } from './get-simulation-state.js';
import { listEvents } from './list-events.js';

function ev(seq: number, type: string, at: string, source = 'agent_report'): Event {
  return {
    seq,
    at,
    realAt: at,
    source,
    category: 'agent',
    type,
    agentId: 'a1',
    ticketId: null,
    sessionId: null,
    warn: false,
    payload: { summary: type },
  } as unknown as Event;
}

function setup() {
  const ports = createTestPorts();
  ports.store.events.push(
    ev(1, 'agent.connected', '2026-10-24T14:32:10.000Z'),
    ev(2, 'agent.heartbeat', '2026-10-24T14:32:11.000Z'), // journal-only
    ev(3, 'agent.connected', '2026-10-24T14:31:59.000Z'),
    ev(4, 'agent.connected', '2026-10-24T14:21:00.000Z'), // 12th minute back
    ev(5, 'agent.connected', '2026-10-24T14:20:59.000Z'), // outside
  );
  return ports;
}

describe('getOverview', () => {
  it('returns 12 per-minute feed counts ending at the current minute', async () => {
    const { data } = await getOverview(setup().snapshots);
    OverviewResponse.parse(data);
    expect(data.eventsPerMinute).toHaveLength(12);
    expect(data.eventsPerMinute.at(-1)).toBe(1);
    expect(data.eventsPerMinute.at(-2)).toBe(1);
    expect(data.eventsPerMinute[0]).toBe(1);
    expect(data.eventsPerMinute.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe('listEvents', () => {
  it('feed only, newest first, keyset paging', async () => {
    const ports = setup();
    const first = (await listEvents(ports.snapshots, { limit: 2 })).data;
    EventsPageResponse.parse(first);
    expect(first.items.map((e) => e.seq)).toEqual([5, 4]);
    expect(first.nextBeforeSeq).toBe(4);
    const second = (await listEvents(ports.snapshots, { limit: 2, beforeSeq: 4 })).data;
    expect(second.items.map((e) => e.seq)).toEqual([3, 1]);
    expect(second.nextBeforeSeq).toBeNull();
  });
});

describe('getSimulationState', () => {
  it('reports clock, flags, seqs, next ticket id and thresholds', async () => {
    const ports = setup();
    const { data, asOfSeq } = await getSimulationState(ports.snapshots, {
      playing: false,
      held: true,
    });
    SimulationState.parse(data);
    expect(asOfSeq).toBe(5);
    expect(data).toMatchObject({ playing: false, held: true, lastSeq: 5, nextTicketId: 'T-1' });
  });
});
