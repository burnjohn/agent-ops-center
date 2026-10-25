import { z } from 'zod';

export const ERROR_CODES = [
  'validation_failed',
  'not_found',
  'transition_refused',
  'needs_input',
  'confirmation_required',
  'stale_state',
  'agent_busy',
  'not_blocked',
  'cannot_step',
  'simulation_playing',
  'db_unavailable',
  'internal',
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorResponse = z
  .object({
    error: z
      .object({
        code: ErrorCode,
        message: z.string(),
        reason: z.string().optional(),
        details: z.array(z.object({ path: z.string(), message: z.string() }).strict()).optional(),
      })
      .strict(),
  })
  .strict();
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const errorHttpStatus: Record<ErrorCode, number> = {
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
