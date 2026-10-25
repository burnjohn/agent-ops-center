import type { AgentHealth } from '../enums.js';

export const STALE_AFTER_SEC = 30;
export const OFFLINE_AFTER_SEC = 120;
export const RUNNING_TOOL_GRACE_SEC = 600;

export interface HealthThresholds {
  staleAfterSec: number;
  offlineAfterSec: number;
  runningToolSec: number;
}

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  staleAfterSec: STALE_AFTER_SEC,
  offlineAfterSec: OFFLINE_AFTER_SEC,
  runningToolSec: RUNNING_TOOL_GRACE_SEC,
};

export interface HealthInput {
  /** ISO timestamp or epoch ms. */
  lastSeenAt: string | number;
  /** Running tool and when it started (ISO timestamp or epoch ms), or null. */
  currentTool: { startedAt: string | number } | null;
}

const toMs = (t: string | number): number => (typeof t === 'number' ? t : Date.parse(t));

/** API-AC-38. Pure: `now` is a parameter. */
export function deriveHealth(
  agent: HealthInput,
  now: string | number,
  thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
): AgentHealth {
  const nowMs = toMs(now);
  if (agent.currentTool) {
    const toolAge = (nowMs - toMs(agent.currentTool.startedAt)) / 1000;
    if (toolAge < thresholds.runningToolSec) return 'online';
  }
  const gap = (nowMs - toMs(agent.lastSeenAt)) / 1000;
  if (gap < thresholds.staleAfterSec) return 'online';
  if (gap < thresholds.offlineAfterSec) return 'stale';
  return 'offline';
}
