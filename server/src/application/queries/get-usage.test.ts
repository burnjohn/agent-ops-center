import { UsageResponse } from '@agent-ops/shared';
import { describe, expect, it } from 'vitest';
import type { SessionState } from '../../domain/index.js';
import { createTestPorts } from '../testing/index.js';
import { getUsage } from './get-usage.js';

const PRICE = { model: 'm', inputPerM: 1, outputPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0 };
const T0 = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function seed(
  ports: ReturnType<typeof createTestPorts>,
  n: number,
  startedAt: string,
  millions: number,
  status: SessionState['status'] = 'completed',
  agentId = 'alpha',
) {
  const id = `S-${String(n).padStart(4, '0')}`;
  ports.store.seedSession({
    id,
    number: n,
    agentId,
    ticketId: n % 2 ? null : 'T-1',
    model: 'm',
    startedAt,
    endedAt: null,
    status,
    entryCount: 1,
  });
  ports.store.data.entries.set(id, [
    {
      index: 0,
      at: startedAt,
      type: 'tool',
      text: null,
      stage: null,
      tool: null,
      tokens: { ...T0, input: millions * 1_000_000 },
      activity: 'reading_code',
    },
  ]);
}

describe('getUsage', () => {
  it('empty period returns zeros and 30 points', async () => {
    const ports = createTestPorts();
    ports.store.seedPrice(PRICE);
    const { data } = await getUsage(ports.snapshots, 'today');
    const u = UsageResponse.parse(data);
    expect(u.costPerDay).toHaveLength(30);
    expect(u.costPerDay.every((d) => d.costUsd === 0)).toBe(true);
    expect(u.costPerDay.at(-1)).toMatchObject({
      date: '2026-10-24',
      isToday: true,
      inPeriod: true,
    });
    expect(u.kpis).toMatchObject({
      totalCostUsd: 0,
      sessions: 0,
      medianCostUsd: 0,
      avgCostUsd: 0,
      cacheReadShare: 0,
    });
    expect(u.breakdowns.byAgent).toEqual([]);
    expect(u.dataSource).toBe('mock');
  });

  it('median of [1,2,3,4] is 3; period flags and breakdowns', async () => {
    const ports = createTestPorts();
    ports.store.seedPrice(PRICE);
    seed(ports, 1, '2026-10-24T01:00:00.000Z', 1, 'running');
    seed(ports, 2, '2026-10-24T02:00:00.000Z', 2);
    seed(ports, 3, '2026-10-23T02:00:00.000Z', 3, 'completed', 'beta');
    seed(ports, 4, '2026-10-23T03:00:00.000Z', 4);
    seed(ports, 5, '2026-09-01T03:00:00.000Z', 100);
    const { data } = await getUsage(ports.snapshots, '7d');
    const u = UsageResponse.parse(data);
    expect(u.kpis.sessions).toBe(4);
    expect(u.kpis.medianCostUsd).toBe(3);
    expect(u.kpis.avgCostUsd).toBe(2.5);
    expect(u.kpis.totalCostUsd).toBe(10);
    expect(u.kpis.runningNow).toBe(1);
    expect(u.peakUsd).toBe(7);
    expect(u.costPerDay.filter((d) => d.inPeriod)).toHaveLength(7);
    expect(u.breakdowns.byAgent.map((b) => b.key)).toEqual(['alpha', 'beta']);
    expect(u.breakdowns.byAgent[0]?.share).toBeCloseTo(0.7);
    expect(u.breakdowns.byTicket.map((b) => b.key)).toContain(null);
    expect(u.breakdowns.byActivity).toHaveLength(1);
  });
});
