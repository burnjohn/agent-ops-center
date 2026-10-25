import type { ErrorCode } from '@agent-ops/shared';

/** A command refused by a domain rule. Presentation maps `code` to an HTTP status (SPEC-server-api §C3). */
export class DomainRefusal extends Error {
  readonly code: ErrorCode;
  readonly reason: string | undefined;
  /** Field the refusal concerns, for `validation_failed` details. */
  readonly path: string | undefined;

  constructor(code: ErrorCode, message: string, options: { reason?: string; path?: string } = {}) {
    super(message);
    this.name = 'DomainRefusal';
    this.code = code;
    this.reason = options.reason;
    this.path = options.path;
  }
}
