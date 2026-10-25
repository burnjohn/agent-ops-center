import { ApiError, NetworkError } from '../../api/client';

export const NETWORK_TEXT = 'Couldn’t reach the server — try again.';

/** UI-AC-20/21: `reason` if present, else `message`; network failures get the fixed text. */
export function commandErrorText(error: unknown): string {
  if (error instanceof ApiError) return error.reason ?? error.message;
  if (error instanceof NetworkError) return NETWORK_TEXT;
  return 'Something went wrong — try again.';
}

/** Field-level messages of a `400` with `details`, keyed by the last path segment. */
export function fieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (error instanceof ApiError && error.details) {
    for (const d of error.details) {
      const key = d.path.split(/[./[\]]+/).filter(Boolean)[0] ?? '';
      if (key && !(key in out)) out[key] = d.message;
    }
  }
  return out;
}
