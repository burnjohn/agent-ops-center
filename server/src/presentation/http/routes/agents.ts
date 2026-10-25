import { AgentIdParams } from '@agent-ops/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { SnapshotReader } from '../../../application/ports/index.js';
import { getAgentPage } from '../../../application/queries/get-agent-page.js';
import { listAgents } from '../../../application/queries/list-agents.js';
import { DomainRefusal } from '../../../domain/errors.js';
import { setAsOfSeq } from '../as-of-seq.js';
import { parseOr400 } from '../validate.js';

/** `GET /api/agents` and `GET /api/agents/:id` (API-AC-27, AC-28). */
export function agentRoutes(snapshots: SnapshotReader): FastifyPluginAsync {
  return async (app) => {
    app.get('/agents', async (_request, reply) => {
      const { data, asOfSeq } = await listAgents(snapshots);
      return setAsOfSeq(reply, asOfSeq).send(data);
    });

    app.get('/agents/:id', async (request, reply) => {
      const { id } = parseOr400(AgentIdParams, request.params);
      const { data, asOfSeq } = await getAgentPage(snapshots, id);
      if (data === null) throw new DomainRefusal('not_found', `Agent ${id} not found.`);
      return setAsOfSeq(reply, asOfSeq).send(data);
    });
  };
}
