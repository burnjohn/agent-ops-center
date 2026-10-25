/** Advisory-lock keys (bigint-safe integers). ADR-0009. */

/** Transaction-level lock taken as the first statement of every command transaction; keeps `seq` in commit order. */
export const EVENTS_LOCK_KEY = 7_201_001;

/** Session-level lock held by the running server; the reset command probes it. */
export const SERVER_LOCK_KEY = 7_201_002;
