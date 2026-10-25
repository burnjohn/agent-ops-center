import {
  entryCostUsd,
  type ModelPrice,
  type Period,
  type SessionSummary,
  type SessionsPageResponse,
  type SessionsQuery,
  type TokenPrice,
} from '@agent-ops/shared';
import type { SessionRow, SessionSort, SnapshotReader } from '../ports/read-queries.js';
import { utcDay } from '../../domain/index.js';

const DAY_MS = 86_400_000;
const ZERO_PRICE: TokenPrice = { inputPerM: 0, outputPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0 };

export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** API-AC-35: inclusive UTC-day range of a period; "today" is the day of the Simulation Clock. */
export function periodRange(period: Period, clockAt: string): { fromDay: string; toDay: string } {
  const today = utcDay(clockAt);
  switch (period) {
    case 'today':
      return { fromDay: today, toDay: today };
    case '7d':
      return { fromDay: shiftDay(today, -6), toDay: today };
    case '30d':
      return { fromDay: shiftDay(today, -29), toDay: today };
    case 'all':
      return { fromDay: '0000-01-01', toDay: '9999-12-31' };
  }
}

export function priceMap(prices: readonly ModelPrice[]): Map<string, ModelPrice> {
  return new Map(prices.map((p) => [p.model, p]));
}

/** Models without a price cost 0 rather than failing a read. */
export function priceOf(prices: Map<string, ModelPrice>, model: string): TokenPrice {
  return prices.get(model) ?? ZERO_PRICE;
}

export function toSummary(
  row: SessionRow,
  prices: Map<string, ModelPrice>,
  entryCount?: number,
  costUsd?: number,
): SessionSummary {
  const s = row.session;
  return {
    id: s.id,
    agentId: s.agentId,
    ticketId: s.ticketId,
    model: s.model,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    status: s.status,
    tokens: row.tokens,
    costUsd: costUsd ?? entryCostUsd(row.tokens, priceOf(prices, s.model)),
    costIsFinal: s.status !== 'running',
    entryCount: entryCount ?? s.entryCount,
  };
}

const SORT_MAP: Record<SessionsQuery['sort'], SessionSort> = {
  start: 'startedAt',
  input: 'input',
  output: 'output',
  cacheRead: 'cacheRead',
  cacheWrite: 'cacheWrite',
  cost: 'cost',
};

/** API-AC-36: filtered, sorted, paged session list (newest first, other sorts descending). */
export function listSessions(snapshots: SnapshotReader, query: SessionsQuery) {
  return snapshots.read(async (q): Promise<SessionsPageResponse> => {
    const [sim, prices] = await Promise.all([q.simulation(), q.modelPrices()]);
    const range = periodRange(query.period, sim.clockAt);
    const page = await q.listSessions({
      ...range,
      agentId: query.agentId,
      model: query.model,
      sort: SORT_MAP[query.sort],
      order: 'desc',
      limit: query.limit,
      offset: query.offset,
    });
    const priceByModel = priceMap(prices);
    return {
      items: page.rows.map((r) => toSummary(r, priceByModel)),
      total: page.total,
      limit: query.limit,
      offset: query.offset,
      sort: query.sort,
      dataSource: 'mock',
    };
  });
}
