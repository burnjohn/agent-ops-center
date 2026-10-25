import { entryCostUsd, type AgentPageResponse } from '@agent-ops/shared';
import type { SnapshotReader } from '../ports/read-queries.js';
import { toAgent } from './list-agents.js';
import { priceMap, priceOf, toSummary } from './list-sessions.js';
import { buildSaidVsDid } from './said-vs-did.js';

/** API-AC-28: KPIs, Said vs did, 10 newest sessions + total, related tickets; unknown id -> `data: null`. */
export function getAgentPage(snapshots: SnapshotReader, id: string) {
  return snapshots.read(async (q): Promise<AgentPageResponse | null> => {
    const [sim, raw, priceList] = await Promise.all([
      q.simulation(),
      q.agentPage(id),
      q.modelPrices(),
    ]);
    if (raw === null) return null;
    const prices = priceMap(priceList);
    const events = await q.journal.latestForAgent(id, 16);
    const current = raw.row.agent.currentTicketId;
    const ticket = raw.tickets.find((t) => t.id === current) ?? null;
    return {
      agent: toAgent(raw.row, ticket, sim.clockAt, prices),
      kpis: {
        sessions7d: raw.sessions7d.length,
        ticketsDone: raw.doneTicketCount,
        toolCallsToday: raw.toolCallsToday,
        cost7dUsd: raw.tokens7d.reduce(
          (sum, m) => sum + entryCostUsd(m.tokens, priceOf(prices, m.model)),
          0,
        ),
      },
      saidVsDid: buildSaidVsDid(events, sim.clockAt),
      sessions: raw.recentSessions.map((r) => toSummary(r, prices)),
      sessionsTotal: raw.sessionTotal,
      tickets: raw.tickets.map((t) => ({ id: t.id, title: t.title, status: t.status })),
      dataSource: 'mock',
    };
  });
}
