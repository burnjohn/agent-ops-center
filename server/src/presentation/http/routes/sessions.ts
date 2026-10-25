import { SessionIdParams, SessionsQuery } from '@agent-ops/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { SnapshotReader } from '../../../application/ports/index.js';
import { getSession } from '../../../application/queries/get-session.js';
import { listSessions } from '../../../application/queries/list-sessions.js';
import { DomainRefusal } from '../../../domain/errors.js';
import { setAsOfSeq } from '../as-of-seq.js';
import { parseOr400 } from '../validate.js';

/** `GET /api/sessions` and `GET /api/sessions/:id` (API-AC-30..36). */
export function sessionRoutes(snapshots: SnapshotReader): FastifyPluginAsync {
  return async (app) => {
    app.get('/sessions', async (request, reply) => {
      const query = parseOr400(SessionsQuery, request.query);
      const { data, asOfSeq } = await listSessions(snapshots, query);
      return setAsOfSeq(reply, asOfSeq).send(data);
    });

    app.get('/sessions/:id', async (request, reply) => {
      const { id } = parseOr400(SessionIdParams, request.params);
      const { data, asOfSeq } = await getSession(snapshots, id);
      if (data === null) throw new DomainRefusal('not_found', `Session ${id} not found.`);
      return setAsOfSeq(reply, asOfSeq).send(data);
    });
  };
}
