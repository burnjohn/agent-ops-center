import type { FastifyPluginAsync } from 'fastify';
import type { SnapshotReader } from '../../../application/ports/index.js';

/** `GET /api/healthz` (API-AC-70): 200 `{ok:true,db:"up"}` when the database answers, 503 `{ok:false,db:"down"}` otherwise. */
export function healthzRoutes(snapshots: SnapshotReader): FastifyPluginAsync {
  return async (app) => {
    app.get('/healthz', async (_request, reply) => {
      try {
        await snapshots.read(async () => null);
        return { ok: true, db: 'up' };
      } catch {
        return reply.code(503).send({ ok: false, db: 'down' });
      }
    });
  };
}
