import { deriveHealth, entryCostUsd, type Agent, type ModelPrice } from '@agent-ops/shared';
import type { TicketState } from '../../domain/index.js';
import type { AgentRow, SnapshotReader } from '../ports/read-queries.js';
import { stepAvailability } from '../simulation/step-availability.js';
import { priceMap, priceOf } from './list-sessions.js';

/** API-AC-27/38: stored agent + derived health (at the sim clock), step object and today's cost. */
export function toAgent(
  row: AgentRow,
  ticket: TicketState | null,
  clockAt: string,
  prices: Map<string, ModelPrice>,
): Agent {
  const a = row.agent;
  const costTodayUsd = row.todayTokens.reduce(
    (sum, m) => sum + entryCostUsd(m.tokens, priceOf(prices, m.model)),
    0,
  );
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    model: a.model,
    stage: a.stage,
    health: deriveHealth(a, clockAt),
    lastSeenAt: a.lastSeenAt,
    currentTicketId: a.currentTicketId,
    currentSessionId: a.currentSessionId,
    lastSessionId: a.lastSessionId,
    currentTool: a.currentTool,
    lastTool: a.lastTool,
    pausedAfterRelease: a.pausedAfterRelease,
    costTodayUsd,
    step: stepAvailability({
      agent: a,
      ticket,
      sim: row.sim,
    }),
  };
}

/** API-AC-27: all agents in fixture order. */
export function listAgents(snapshots: SnapshotReader) {
  return snapshots.read(async (q): Promise<Agent[]> => {
    const [sim, rows, tickets, priceList] = await Promise.all([
      q.simulation(),
      q.listAgents(),
      q.listTickets(),
      q.modelPrices(),
    ]);
    const byId = new Map(tickets.map((t) => [t.id, t]));
    const prices = priceMap(priceList);
    return rows.map((r) =>
      toAgent(
        r,
        r.agent.currentTicketId === null ? null : (byId.get(r.agent.currentTicketId) ?? null),
        sim.clockAt,
        prices,
      ),
    );
  });
}
