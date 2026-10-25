import { asc, eq, sql } from 'drizzle-orm';
import type { AgentRepository } from '../../application/ports/repositories.js';
import type { AgentState } from '../../domain/index.js';
import type { Db } from '../db/client.js';
import { agents, agentSimState, sessions } from '../db/schema.js';
import type { Tx } from '../fixture/load-fixture.js';
import { agentToDomain, agentToUpdate } from './mappers.js';

/**
 * Agents as stored. `lastSessionId` (newest session) and `pausedAfterRelease` (pending refusal marker in
 * `agent_sim_state`) are derived on read; they have no `agents` column. No delete path (DB-AC-41).
 */
export class AgentsRepository implements AgentRepository {
  constructor(private readonly q: Db | Tx) {}

  private select() {
    return this.q
      .select({
        agent: agents,
        lastSessionId: sql<
          string | null
        >`(select s.id from ${sessions} s where s.agent_id = ${agents.id} order by s.number desc limit 1)`,
        pendingRefusal: agentSimState.pendingRefusalTicketId,
      })
      .from(agents)
      .leftJoin(agentSimState, eq(agentSimState.agentId, agents.id));
  }

  async get(id: string): Promise<AgentState | null> {
    const [r] = await this.select().where(eq(agents.id, id)).limit(1);
    return r === undefined ? null : this.map(r);
  }

  async list(): Promise<AgentState[]> {
    const rows = await this.select().orderBy(asc(agents.createdAt), asc(agents.id));
    return rows.map((r) => this.map(r));
  }

  async update(agent: AgentState): Promise<void> {
    await this.q.update(agents).set(agentToUpdate(agent)).where(eq(agents.id, agent.id));
  }

  private map(r: {
    agent: typeof agents.$inferSelect;
    lastSessionId: string | null;
    pendingRefusal: string | null;
  }): AgentState {
    return agentToDomain(r.agent, {
      lastSessionId: r.lastSessionId,
      pausedAfterRelease: r.pendingRefusal !== null,
    });
  }
}

export const createAgentRepository = (q: Db | Tx): AgentRepository => new AgentsRepository(q);
