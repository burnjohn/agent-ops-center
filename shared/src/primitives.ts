import { z } from 'zod';

/** `T-<n>`, no leading zeros, n >= 1. */
export const TicketId = z.string().regex(/^T-[1-9]\d*$/);
export type TicketId = z.infer<typeof TicketId>;

/** `S-<nnnn>`, four or more digits. */
export const SessionId = z.string().regex(/^S-\d{4,}$/);
export type SessionId = z.infer<typeof SessionId>;

/** Fixture slug, e.g. `alpha`, `sim-1`. */
export const AgentId = z.string().regex(/^[a-z0-9-]+$/);
export type AgentId = z.infer<typeof AgentId>;

/** ISO-8601 UTC timestamp. */
export const IsoTimestamp = z.iso.datetime();
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;

export const NonNegativeInt = z.number().int().min(0);
export type NonNegativeInt = z.infer<typeof NonNegativeInt>;

/** USD amount as a JSON number, unrounded, never negative. */
export const Money = z.number().min(0);
export type Money = z.infer<typeof Money>;
