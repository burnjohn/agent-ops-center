import { errorHttpStatus, type ErrorCode, type ErrorResponse } from '@agent-ops/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ConstraintRace, DbUnavailableError } from '../../application/ports/index.js';
import { DomainRefusal } from '../../domain/errors.js';
import { RequestValidationError } from './validate.js';

interface Mapped {
  status: number;
  body: ErrorResponse;
}

function envelope(
  code: ErrorCode,
  message: string,
  extra: Partial<ErrorResponse['error']> = {},
): Mapped {
  return { status: errorHttpStatus[code], body: { error: { code, message, ...extra } } };
}

function mapConstraintRace(err: ConstraintRace): Mapped {
  switch (err.kind) {
    case 'agent_busy':
      return envelope('agent_busy', 'That agent already has a ticket in progress.');
    case 'empty_title':
      return envelope('validation_failed', 'Request validation failed', {
        details: [{ path: 'title', message: 'Title is required.' }],
      });
    case 'stale_state':
      return envelope('stale_state', 'Something changed meanwhile — try again.');
    default:
      return envelope('internal', 'Internal server error');
  }
}

export function mapError(err: unknown): Mapped {
  if (err instanceof RequestValidationError) {
    return envelope('validation_failed', err.message, { details: err.details });
  }
  if (err instanceof DomainRefusal) {
    return envelope(err.code, err.message, {
      ...(err.reason !== undefined ? { reason: err.reason } : {}),
      ...(err.code === 'validation_failed'
        ? { details: [{ path: err.path ?? '', message: err.message }] }
        : {}),
    });
  }
  if (err instanceof ConstraintRace) return mapConstraintRace(err);
  if (err instanceof DbUnavailableError)
    return envelope('db_unavailable', 'The database is unavailable.');
  const status = (err as Partial<FastifyError> | null)?.statusCode;
  // Framework-level client errors (malformed JSON, body over the limit, unsupported media type).
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return envelope('validation_failed', 'Malformed request.');
  }
  return envelope('internal', 'Internal server error');
}

/** Central error handler: no stack traces, SQL or internals in response bodies. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const mapped = mapError(err);
    if (mapped.body.error.code === 'internal') request.log.error({ err }, 'unhandled error');
    else if (mapped.body.error.code === 'db_unavailable')
      request.log.warn({ err }, 'database unavailable');
    return reply.code(mapped.status).send(mapped.body);
  });
}

/** 404 envelope for unknown `/api` routes. */
export function notFoundEnvelope(request: FastifyRequest): ErrorResponse {
  return envelope('not_found', `No such route: ${request.method} ${request.url.split('?')[0]}`)
    .body;
}
