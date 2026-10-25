import { useSyncExternalStore } from 'react';
import type { Period, SessionSort } from '@agent-ops/shared';

/**
 * Usage & Cost controls are UI state (ADR-0011): module-level so they survive navigation but not a reload,
 * and are never touched by events (UI-AC-14).
 */
export const PAGE_SIZE = 12;

export interface UsageControls {
  period: Period;
  sort: SessionSort;
  agentId: string;
  model: string;
  /** Number of table rows requested (12, 24, …). */
  rows: number;
}

const INITIAL: UsageControls = {
  period: '30d',
  sort: 'start',
  agentId: '',
  model: '',
  rows: PAGE_SIZE,
};

let current: UsageControls = INITIAL;
const listeners = new Set<() => void>();

function set(next: UsageControls): void {
  current = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Period change recomputes everything and resets the table to 12 rows (UI-AC-111). */
export const setPeriod = (period: Period): void => set({ ...current, period, rows: PAGE_SIZE });
/** Agent / Model filter change resets the table to 12 rows (UI-AC-119). */
export const setAgentFilter = (agentId: string): void =>
  set({ ...current, agentId, rows: PAGE_SIZE });
export const setModelFilter = (model: string): void => set({ ...current, model, rows: PAGE_SIZE });
/** Clicking the active column returns to start-time order (UI-AC-118). */
export const toggleSort = (key: SessionSort): void =>
  set({ ...current, sort: current.sort === key ? 'start' : key, rows: PAGE_SIZE });
export const showMoreRows = (): void => set({ ...current, rows: current.rows + PAGE_SIZE });

/** Back to defaults; used by the test harness so no state leaks between tests. */
export const resetUsageControls = (): void => set(INITIAL);

export function useUsageControls(): UsageControls {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => INITIAL,
  );
}
