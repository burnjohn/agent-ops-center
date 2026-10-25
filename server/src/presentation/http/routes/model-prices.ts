import type { FastifyPluginAsync } from 'fastify';
import type { SnapshotReader } from '../../../application/ports/index.js';
import { listModelPrices } from '../../../application/queries/list-model-prices.js';
import { setAsOfSeq } from '../as-of-seq.js';

/** `GET /api/model-prices` (API-AC-37). */
export function modelPriceRoutes(snapshots: SnapshotReader): FastifyPluginAsync {
  return async (app) => {
    app.get('/model-prices', async (_request, reply) => {
      const { data, asOfSeq } = await listModelPrices(snapshots);
      return setAsOfSeq(reply, asOfSeq).send(data);
    });
  };
}
