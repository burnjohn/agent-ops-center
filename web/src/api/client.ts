import type { z } from 'zod';
import { AS_OF_SEQ_HEADER, ErrorResponse, type ErrorCode } from '@agent-ops/shared';

/** The only module besides stream.ts allowed to call `fetch` (ADR-0011). */
const API_BASE = '/api';

export interface Snapshot<T> {
  data: T;
  /** Highest journal seq the server snapshot includes (`X-As-Of-Seq`); null when absent (POST, healthz). */
  asOfSeq: number | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'unknown';
  readonly reason: string | undefined;
  readonly details: { path: string; message: string }[] | undefined;

  constructor(
    status: number,
    code: ErrorCode | 'unknown',
    message: string,
    reason?: string,
    details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.reason = reason;
    this.details = details;
  }
}

export class NetworkError extends Error {
  constructor(message = 'Cannot reach the server.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

export type QueryParams = Record<string, string | number | boolean | undefined>;

export function buildPath(path: string, params?: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const parsed = ErrorResponse.safeParse(body);
  if (parsed.success) {
    const { code, message, reason, details } = parsed.data.error;
    return new ApiError(res.status, code, message, reason, details);
  }
  return new ApiError(res.status, 'unknown', `Request failed (${res.status}).`);
}

function readAsOfSeq(res: Response): number | null {
  const raw = res.headers.get(AS_OF_SEQ_HEADER);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  params?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
}

export async function request<S extends z.ZodType>(
  path: string,
  schema: S,
  { method = 'GET', params, body, signal }: RequestOptions = {},
): Promise<Snapshot<z.output<S>>> {
  let res: Response;
  try {
    res = await fetch(buildPath(path, params), {
      method,
      signal: signal ?? null,
      headers:
        body === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new NetworkError(undefined, { cause });
  }
  if (!res.ok) throw await toApiError(res);
  let json: unknown;
  try {
    json = await res.json();
  } catch (cause) {
    throw new NetworkError('The server sent an unreadable response.', { cause });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(res.status, 'unknown', 'The server response did not match the contract.');
  }
  return { data: parsed.data, asOfSeq: readAsOfSeq(res) };
}

export const get = <S extends z.ZodType>(
  path: string,
  schema: S,
  params?: QueryParams,
  signal?: AbortSignal,
) => request(path, schema, { params, signal });

export const post = <S extends z.ZodType>(path: string, schema: S, body: unknown) =>
  request(path, schema, { method: 'POST', body });
