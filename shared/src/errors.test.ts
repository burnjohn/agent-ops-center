import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ErrorResponse, errorHttpStatus } from './errors.js';

const expected: Record<string, number> = {
  validation_failed: 400,
  not_found: 404,
  transition_refused: 409,
  needs_input: 409,
  confirmation_required: 409,
  stale_state: 409,
  agent_busy: 409,
  not_blocked: 409,
  cannot_step: 409,
  simulation_playing: 409,
  db_unavailable: 503,
  internal: 500,
};

describe('errors', () => {
  it('maps every ErrorCode to its C3 HTTP status', () => {
    expect(ERROR_CODES).toHaveLength(12);
    for (const code of ERROR_CODES) expect(errorHttpStatus[code]).toBe(expected[code]);
  });
  it('validates the envelope strictly', () => {
    const ok = {
      error: {
        code: 'validation_failed',
        message: 'bad',
        details: [{ path: 'title', message: 'x' }],
      },
    };
    expect(ErrorResponse.safeParse(ok).success).toBe(true);
    expect(ErrorResponse.safeParse({ error: { code: 'nope', message: 'm' } }).success).toBe(false);
    expect(
      ErrorResponse.safeParse({ error: { code: 'internal', message: 'm' }, extra: 1 }).success,
    ).toBe(false);
  });
});
