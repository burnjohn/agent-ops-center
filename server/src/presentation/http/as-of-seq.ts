import { AS_OF_SEQ_HEADER } from '@agent-ops/shared';
import type { FastifyReply } from 'fastify';

/** Sets `X-As-Of-Seq` on a snapshot read response (API-AC-71); returns the reply for chaining. */
export function setAsOfSeq(reply: FastifyReply, asOfSeq: number): FastifyReply {
  return reply.header(AS_OF_SEQ_HEADER, String(asOfSeq));
}
