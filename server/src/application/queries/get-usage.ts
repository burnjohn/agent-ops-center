import {
  entryCostUsd,
  sumTokens,
  USAGE_DAYS,
  type BreakdownItem,
  type Period,
  type TokenUsage,
  type UsageResponse,
} from '@agent-ops/shared';
import { utcDay } from '../../domain/index.js';
import type { ModelTokens, SnapshotReader } from '../ports/read-queries.js';
import { periodRange, priceMap, priceOf, shiftDay } from './list-sessions.js';

const BREAKDOWN_TOP = 6;

function total(t: TokenUsage): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite;
}

function breakdown(
  costs: Map<string | null, number>,
  periodTotal: number,
  top?: number,
): BreakdownItem[] {
  const items = [...costs]
    .map(([key, costUsd]) => ({ key, costUsd, share: periodTotal > 0 ? costUsd / periodTotal : 0 }))
    .sort((a, b) => b.costUsd - a.costUsd);
  return top === undefined ? items : items.slice(0, top);
}

function add<K>(m: Map<K, number>, key: K, value: number): void {
  m.set(key, (m.get(key) ?? 0) + value);
}

/** API-AC-35: usage & cost KPIs, 30 daily points and breakdowns for a period. */
export function getUsage(snapshots: SnapshotReader, period: Period) {
  return snapshots.read(async (q): Promise<UsageResponse> => {
    const [sim, priceList] = await Promise.all([q.simulation(), q.modelPrices()]);
    const prices = priceMap(priceList);
    const today = utcDay(sim.clockAt);
    const range = periodRange(period, sim.clockAt);
    const window = { fromDay: shiftDay(today, -(USAGE_DAYS - 1)), toDay: today };

    const raw = await q.usage(range);
    // The 30-day chart is independent of the period; fetch its window when the period differs.
    const chart = period === '30d' ? raw : await q.usage(window);

    const cost = (s: ModelTokens): number => entryCostUsd(s.tokens, priceOf(prices, s.model));

    const sessionCosts = raw.perSession.map((r) =>
      entryCostUsd(r.tokens, priceOf(prices, r.session.model)),
    );
    const totalCostUsd = sessionCosts.reduce((a, b) => a + b, 0);
    const allTokens = sumTokens(raw.perSession.map((r) => r.tokens));
    const tokens = total(allTokens);
    const n = sessionCosts.length;
    const sorted = [...sessionCosts].sort((a, b) => a - b);

    const dayCost = new Map<string, number>();
    for (const d of chart.perDay) {
      dayCost.set(
        d.day,
        d.sums.reduce((a, s) => a + cost(s), 0),
      );
    }
    const costPerDay = Array.from({ length: USAGE_DAYS }, (_, i) => {
      const date = shiftDay(window.fromDay, i);
      return {
        date,
        inPeriod: date >= range.fromDay && date <= range.toDay,
        isToday: date === today,
        costUsd: dayCost.get(date) ?? 0,
      };
    });

    const byAgent = new Map<string | null, number>();
    const byModel = new Map<string | null, number>();
    const byActivity = new Map<string | null, number>();
    for (const a of raw.byAgent) {
      for (const s of a.sums) {
        const c = cost(s);
        add(byAgent, a.agentId, c);
        add(byModel, s.model, c);
        if (s.activity) add(byActivity, s.activity, c);
      }
    }
    const byTicket = new Map<string | null, number>();
    for (const t of raw.byTicket) {
      for (const s of t.sums) add(byTicket, t.ticketId, cost(s));
    }

    return {
      period,
      dataSource: 'mock',
      kpis: {
        totalCostUsd,
        tokens,
        cacheReadShare: tokens > 0 ? allTokens.cacheRead / tokens : 0,
        sessions: n,
        runningNow: raw.perSession.filter((r) => r.session.status === 'running').length,
        avgCostUsd: n > 0 ? totalCostUsd / n : 0,
        medianCostUsd: n > 0 ? (sorted[Math.floor(n / 2)] ?? 0) : 0,
      },
      costPerDay,
      peakUsd: costPerDay.reduce((m, d) => Math.max(m, d.costUsd), 0),
      breakdowns: {
        byAgent: breakdown(byAgent, totalCostUsd, BREAKDOWN_TOP),
        byTicket: breakdown(byTicket, totalCostUsd, BREAKDOWN_TOP),
        byModel: breakdown(byModel, totalCostUsd, BREAKDOWN_TOP),
        byActivity: breakdown(byActivity, totalCostUsd),
      },
    };
  });
}
