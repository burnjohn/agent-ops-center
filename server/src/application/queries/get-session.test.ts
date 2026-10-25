import {
  ModelPricesResponse,
  SessionDetail,
  SessionsPageResponse,
  SessionsQuery,
} from '@agent-ops/shared';
import { describe, expect, it } from 'vitest';
import type { SessionState } from '../../domain/index.js';
import type { StoredLogEntry } from '../ports/repositories.js';
import { createTestPorts } from '../testing/index.js';
import { getSession } from './get-session.js';
import { listModelPrices } from './list-model-prices.js';
import { listSessions } from './list-sessions.js';

const PRICE = {
  model: 'm',
  inputPerM: 3,
  outputPerM: 15,
  cacheReadPerM: 0.3,
  cacheWritePerM: 3.75,
};
const T0 = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function session(over: Partial<SessionState> = {}): SessionState {
  return {
    id: 'S-0001',
    number: 1,
    agentId: 'alpha',
    ticketId: 'T-1',
    model: 'm',
    startedAt: '2026-10-24T10:00:00.000Z',
    endedAt: null,
    status: 'running',
    entryCount: 0,
    ...over,
  };
}

function entry(index: number, over: Partial<StoredLogEntry>): StoredLogEntry {
  return {
    index,
    at: `2026-10-24T10:0${index}:00.000Z`,
    type: 'system',
    text: null,
    stage: null,
    tool: null,
    tokens: null,
    activity: null,
    ...over,
  };
}

function setup() {
  const ports = createTestPorts();
  ports.store.seedPrice(PRICE);
  return ports;
}

describe('getSession', () => {
  it('sums entries, computes cost parts, top steps and stages', async () => {
    const { store, snapshots } = setup();
    store.seedSession(session());
    store.data.entries.set('S-0001', [
      entry(0, {
        text: 'Session started · m',
        tokens: { ...T0, input: 1_000_000 },
        activity: 'session_context',
      }),
      entry(1, { type: 'stage', stage: 'planning' }),
      entry(2, {
        type: 'tool',
        tool: {
          name: 'Read',
          arg: 'a.ts',
          ok: true,
          result: 'ok',
          durationSec: 1,
          output: 'line1\n  line2',
        },
        tokens: { ...T0, output: 100_000 },
        activity: 'reading_code',
      }),
      entry(3, { type: 'stage', stage: 'implementing' }),
    ]);
    const { data } = await getSession(snapshots, 'S-0001');
    const parsed = SessionDetail.parse(data);
    expect(parsed.costUsd).toBeCloseTo(3 + 1.5);
    expect(parsed.costIsFinal).toBe(false);
    expect(parsed.entryCount).toBe(4);
    expect(parsed.costByType.input).toBe(3);
    expect(parsed.entries[2]?.tool?.output).toBe('line1\n  line2');
    expect(parsed.tokenActivity.map((r) => r.activity)).toEqual([
      'session_context',
      'reading_code',
    ]);
    expect(parsed.tokenActivity[0]?.share).toBeCloseTo(3 / 4.5);
    expect(parsed.topSteps.map((s) => s.label)).toEqual(['Session context loaded', 'Read a.ts']);
    expect(parsed.stages).toEqual([
      { stage: 'planning', from: '2026-10-24T10:01:00.000Z', to: '2026-10-24T10:03:00.000Z' },
      { stage: 'implementing', from: '2026-10-24T10:03:00.000Z', to: null },
    ]);
  });

  it('session without costly entries has cost 0 and no top steps; unknown id is null', async () => {
    const { store, snapshots } = setup();
    store.seedSession(session({ status: 'completed', endedAt: '2026-10-24T11:00:00.000Z' }));
    store.data.entries.set('S-0001', [entry(0, { text: 'hello' })]);
    const { data } = await getSession(snapshots, 'S-0001');
    expect(data?.costUsd).toBe(0);
    expect(data?.topSteps).toEqual([]);
    expect(data?.stages).toEqual([]);
    expect(data?.costIsFinal).toBe(true);
    expect((await getSession(snapshots, 'S-9999')).data).toBeNull();
  });
});

describe('listSessions / listModelPrices', () => {
  it('filters by period, pages and marks mock', async () => {
    const { store, snapshots } = setup();
    store.seedSession(session({ id: 'S-0001', number: 1 }));
    store.seedSession(session({ id: 'S-0002', number: 2, startedAt: '2026-10-01T10:00:00.000Z' }));
    store.data.entries.set('S-0001', [entry(0, { tokens: { ...T0, input: 1_000_000 } })]);
    const today = await listSessions(snapshots, SessionsQuery.parse({ period: 'today' }));
    const page = SessionsPageResponse.parse(today.data);
    expect(page.total).toBe(1);
    expect(page.items[0]?.costUsd).toBe(3);
    const all = await listSessions(snapshots, SessionsQuery.parse({ period: 'all', limit: '1' }));
    expect(all.data.total).toBe(2);
    expect(all.data.items).toHaveLength(1);
    expect(all.data.dataSource).toBe('mock');
  });

  it('returns prices as mock', async () => {
    const { snapshots } = setup();
    const { data } = await listModelPrices(snapshots);
    expect(ModelPricesResponse.parse(data).items).toEqual([PRICE]);
  });
});
