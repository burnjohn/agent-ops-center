import { count, eq, isNotNull } from 'drizzle-orm';
import type { OverviewRaw } from '../../application/ports/read-queries.js';
import type { SimulationRow } from '../../application/ports/repositories.js';
import { idCounters, simulationState, tickets } from '../db/schema.js';
import type { Tx } from '../fixture/load-fixture.js';
import { listAgentStates } from './agents.js';

/** Inputs of the online count (agents), plus Blocked (`blocked_question` set) and Review ticket counts. */
export async function overview(q: Tx): Promise<OverviewRaw> {
  // Sequential: a transaction owns one pg client, which must not run queries concurrently.
  const agents = await listAgentStates(q);
  const [blocked] = await q
    .select({ n: count() })
    .from(tickets)
    .where(isNotNull(tickets.blockedQuestion));
  const [review] = await q.select({ n: count() }).from(tickets).where(eq(tickets.status, 'review'));
  return { agents, blockedCount: blocked?.n ?? 0, reviewCount: review?.n ?? 0 };
}

/** The `simulation_state` singleton (part of `ReadQueries.simulation`). */
export async function readSimulation(q: Tx): Promise<SimulationRow> {
  const [r] = await q.select().from(simulationState).limit(1);
  if (r === undefined) throw new Error('simulation_state row missing');
  return {
    clockAt: r.clockAt.toISOString(),
    seed: r.seed,
    journalFloorSeq: r.journalFloorSeq,
    seededAt: r.seededAt.toISOString(),
  };
}

/** The stored `id_counters` ticket counter (the number the next ticket receives). */
export async function readNextTicketNumber(q: Tx): Promise<number> {
  const [r] = await q
    .select({ n: idCounters.nextValue })
    .from(idCounters)
    .where(eq(idCounters.name, 'ticket'));
  if (r === undefined) throw new Error('id_counters ticket row missing');
  return r.n;
}
