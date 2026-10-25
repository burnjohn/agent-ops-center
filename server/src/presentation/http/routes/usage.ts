import { UsageQuery } from '@agent-ops/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { SnapshotReader } from '../../../application/ports/index.js';
import { getUsage } from '../../../application/queries/get-usage.js';
import { setAsOfSeq } from '../as-of-seq.js';
import { parseOr400 } from '../validate.js';

/** `GET /api/usage` (API-AC-35). */
export function usageRoutes(snapshots: SnapshotReader): FastifyPluginAsync {
  return async (app) => {
    app.get('/usage', async (request, reply) => {
      const { period } = parseOr400(UsageQuery, request.query);
      const { data, asOfSeq } = await getUsage(snapshots, period);
      return setAsOfSeq(reply, asOfSeq).send(data);
    });
  };
}
