/**
 * Stream messages (SPEC-server-api §C8).
 *
 * ASSUMPTION (plan Q1, resolved as the default): the server sends an id-less `event: keepalive`
 * message with `data: {}` at most every 15 s. Domain events are sent as `id: <seq>` / `event: <Event.type>`.
 */
import { z } from 'zod';
import { IsoTimestamp, NonNegativeInt } from './primitives.js';

export const STREAM_EVENT_HELLO = 'hello';
export const STREAM_EVENT_RESYNC = 'resync';
export const STREAM_EVENT_KEEPALIVE = 'keepalive';
export const KEEPALIVE_INTERVAL_MS = 15_000;

export const HelloMessage = z
  .object({
    lastSeq: NonNegativeInt,
    journalFloorSeq: NonNegativeInt,
    clock: IsoTimestamp,
    playing: z.boolean(),
  })
  .strict();
export type HelloMessage = z.infer<typeof HelloMessage>;

export const RESYNC_REASONS = ['ahead', 'below_floor', 'too_far_behind'] as const;
export const ResyncReason = z.enum(RESYNC_REASONS);
export type ResyncReason = z.infer<typeof ResyncReason>;

export const ResyncMessage = z
  .object({ reason: ResyncReason, lastSeq: NonNegativeInt, journalFloorSeq: NonNegativeInt })
  .strict();
export type ResyncMessage = z.infer<typeof ResyncMessage>;

export const KeepaliveMessage = z.object({}).strict();
export type KeepaliveMessage = z.infer<typeof KeepaliveMessage>;
