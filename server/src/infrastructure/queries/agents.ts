import { AgentScript } from '@agent-ops/shared';
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import type { AgentRow, ModelTokens } from '../../application/ports/read-queries.js';
import type { AgentState } from '../../domain/index.js';
import {
  agents,
  agentSimState,
  sessionLogEntries,
  sessions,
  simulationState,
} from '../db/schema.js';
import type { Tx } from '../fixture/load-fixture.js';
import { agentToDomain } from '../repositories/mappers.js';
import { tokenSum } from './ticket-detail.js';

/** Simulation clock instant (never the wall clock). */
export async function readClock(q: Tx): Promise<Date> {
  const [r] = await q.select({ clockAt: simulationState.clockAt }).from(simulationState).limit(1);
  if (r === undefined) throw new Error('simulation_state row missing');
  return r.clockAt;
}

/** `[start, end)` of the UTC calendar day of `clock`. */
export function utcDayRange(clock: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate()));
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

function agentSelect(q: Tx) {
  return q
    .select({
      agent: agents,
      lastSessionId: sql<
        string | null
      >`(select s.id from ${sessions} s where s.agent_id = ${agents.id} order by s.number desc limit 1)`,
      pendingRefusal: agentSimState.pendingRefusalTicketId,
      simSilent: agentSimState.silent,
      simScript: agentSimState.script,
    })
    .from(agents)
    .leftJoin(agentSimState, eq(agentSimState.agentId, agents.id));
}

type AgentSelected = Awaited<ReturnType<ReturnType<typeof agentSelect>['limit']>>[number];

function toState(r: AgentSelected): AgentState {
  return agentToDomain(r.agent, {
    lastSessionId: r.lastSessionId,
    pausedAfterRelease: r.pendingRefusal !== null,
  });
}

/** Script facts for step availability; null when the agent has no `agent_sim_state` row (left join). */
function simOf(r: AgentSelected): AgentRow['sim'] {
  if (r.simScript === null || r.simSilent === null) return null;
  return { silent: r.simSilent, script: AgentScript.parse(r.simScript) };
}

/** Agents in fixture order (`created_at`, `id`) with derived fields. */
export async function listAgentStates(q: Tx): Promise<AgentState[]> {
  const rows = await agentSelect(q).orderBy(asc(agents.createdAt), asc(agents.id));
  return rows.map(toState);
}

/** Token sums per (agent, model) over sessions started in today's UTC day of the simulation clock. */
async function todayTokensByAgent(q: Tx, agentId?: string): Promise<Map<string, ModelTokens[]>> {
  const { start, end } = utcDayRange(await readClock(q));
  const e = sessionLogEntries;
  const rows = await q
    .select({
      agentId: sessions.agentId,
      model: sessions.model,
      input: tokenSum(e.inputTokens),
      output: tokenSum(e.outputTokens),
      cacheRead: tokenSum(e.cacheReadTokens),
      cacheWrite: tokenSum(e.cacheWriteTokens),
    })
    .from(sessions)
    .innerJoin(e, eq(e.sessionId, sessions.id))
    .where(
      and(
        gte(sessions.startedAt, start),
        lt(sessions.startedAt, end),
        agentId === undefined ? undefined : eq(sessions.agentId, agentId),
      ),
    )
    .groupBy(sessions.agentId, sessions.model)
    .orderBy(asc(sessions.model));
  const out = new Map<string, ModelTokens[]>();
  for (const r of rows) {
    const list = out.get(r.agentId) ?? [];
    list.push({
      model: r.model,
      tokens: {
        input: Number(r.input),
        output: Number(r.output),
        cacheRead: Number(r.cacheRead),
        cacheWrite: Number(r.cacheWrite),
      },
    });
    out.set(r.agentId, list);
  }
  return out;
}

export async function listAgents(q: Tx): Promise<AgentRow[]> {
  const rows = await agentSelect(q).orderBy(asc(agents.createdAt), asc(agents.id));
  const today = await todayTokensByAgent(q);
  return rows.map((r) => ({
    agent: toState(r),
    todayTokens: today.get(r.agent.id) ?? [],
    pendingRefusalTicketId: r.pendingRefusal,
    sim: simOf(r),
  }));
}

export async function getAgent(q: Tx, id: string): Promise<AgentRow | null> {
  const [r] = await agentSelect(q).where(eq(agents.id, id)).limit(1);
  if (r === undefined) return null;
  const today = await todayTokensByAgent(q, id);
  return {
    agent: toState(r),
    todayTokens: today.get(id) ?? [],
    pendingRefusalTicketId: r.pendingRefusal,
    sim: simOf(r),
  };
}
