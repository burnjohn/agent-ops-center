import type { ZodType } from 'zod';

export interface ValidationDetail {
  path: string;
  message: string;
}

/** Thrown by `parseOr400`; the central error handler maps it to `400 validation_failed` with `details`. */
export class RequestValidationError extends Error {
  override readonly name = 'RequestValidationError';
  readonly details: ValidationDetail[];

  constructor(details: ValidationDetail[]) {
    super('Request validation failed');
    this.details = details;
  }
}

/** Parses `value` with a shared schema (strict schemas reject unknown fields); throws `RequestValidationError` on failure. */
export function parseOr400<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const details: ValidationDetail[] = [];
  for (const issue of result.error.issues) {
    const base = issue.path.map(String);
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys)
        details.push({ path: [...base, key].join('.'), message: 'Unknown field.' });
    } else {
      details.push({ path: base.join('.'), message: issue.message });
    }
  }
  throw new RequestValidationError(details);
}
