import { EventsQuery } from '@agent-ops/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { SnapshotReader } from '../../../application/ports/index.js';
import { listEvents } from '../../../application/queries/list-events.js';
import { setAsOfSeq } from '../as-of-seq.js';
import { parseOr400 } from '../validate.js';

/** `GET /api/events` (API-AC-25): feed events, newest first, keyset on `beforeSeq`. */
export function eventRoutes(snapshots: SnapshotReader): FastifyPluginAsync {
  return async (app) => {
    app.get('/events', async (request, reply) => {
      const query = parseOr400(EventsQuery, request.query);
      const { data, asOfSeq } = await listEvents(snapshots, query);
      return setAsOfSeq(reply, asOfSeq).send(data);
    });
  };
}
