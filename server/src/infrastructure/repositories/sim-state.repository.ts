import { asc, eq } from 'drizzle-orm';
import { AgentScript } from '@agent-ops/shared';
import type { AgentSimState, SimStateRepository } from '../../application/ports/repositories.js';
import type { Db } from '../db/client.js';
import { agentSimState } from '../db/schema.js';
import type { Tx } from '../fixture/load-fixture.js';

type Row = typeof agentSimState.$inferSelect;

function toDomain(r: Row): AgentSimState {
  return {
    agentId: r.agentId,
    scenario: r.scenario,
    script: AgentScript.parse(r.script), // jsonb is validated on read with the shared schema
    silent: r.silent,
    pendingRefusalTicketId: r.pendingRefusalTicketId,
    cooldownSteps: r.cooldownSteps,
  };
}

/** `agent_sim_state`: per-agent script position. Upsert only; no delete path (DB-AC-41). */
export class SimStateRepo implements SimStateRepository {
  constructor(private readonly q: Db | Tx) {}

  async get(agentId: string): Promise<AgentSimState | null> {
    const [r] = await this.q
      .select()
      .from(agentSimState)
      .where(eq(agentSimState.agentId, agentId))
      .limit(1);
    return r === undefined ? null : toDomain(r);
  }

  async list(): Promise<AgentSimState[]> {
    const rows = await this.q.select().from(agentSimState).orderBy(asc(agentSimState.agentId));
    return rows.map(toDomain);
  }

  async save(state: AgentSimState): Promise<void> {
    const values = {
      agentId: state.agentId,
      scenario: state.scenario,
      script: AgentScript.parse(state.script), // never persist an invalid script
      silent: state.silent,
      pendingRefusalTicketId: state.pendingRefusalTicketId,
      cooldownSteps: state.cooldownSteps,
    };
    const patch = {
      scenario: values.scenario,
      script: values.script,
      silent: values.silent,
      pendingRefusalTicketId: values.pendingRefusalTicketId,
      cooldownSteps: values.cooldownSteps,
    };
    await this.q
      .insert(agentSimState)
      .values(values)
      .onConflictDoUpdate({ target: agentSimState.agentId, set: patch });
  }
}

export const createSimStateRepository = (q: Db | Tx): SimStateRepository => new SimStateRepo(q);
