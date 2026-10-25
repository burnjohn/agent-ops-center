import type { FastifyPluginAsync } from 'fastify';
import type { SnapshotReader } from '../../../application/ports/index.js';
import { getOverview } from '../../../application/queries/get-overview.js';
import { setAsOfSeq } from '../as-of-seq.js';

/** `GET /api/overview` (API-AC-26). */
export function overviewRoutes(snapshots: SnapshotReader): FastifyPluginAsync {
  return async (app) => {
    app.get('/overview', async (_request, reply) => {
      const { data, asOfSeq } = await getOverview(snapshots);
      return setAsOfSeq(reply, asOfSeq).send(data);
    });
  };
}
