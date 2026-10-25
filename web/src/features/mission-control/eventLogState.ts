import { useSyncExternalStore } from 'react';
import type { Event } from '@agent-ops/shared';
import type { CategoryFilter, SourceFilter } from './model';

/**
 * Event Log controls are UI state (ADR-0011): module-level so they survive leaving and re-opening Mission
 * Control, and are never touched by events or navigation (UI-AC-14).
 */
export interface EventLogControls {
  source: SourceFilter;
  category: CategoryFilter;
  /** While paused: the newest seq known at pause time; rows above it are held (UI-AC-102). */
  heldSeq: number | null;
  /** While paused: the rows visible at pause time, for the filters in `frozenKey`, so refetches cannot drop them. */
  frozen: readonly Event[];
  frozenKey: string;
}

const INITIAL: EventLogControls = {
  source: 'all',
  category: 'all',
  heldSeq: null,
  frozen: [],
  frozenKey: '',
};

let current: EventLogControls = INITIAL;
const listeners = new Set<() => void>();

function set(next: EventLogControls): void {
  current = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const setEventSource = (source: SourceFilter): void => set({ ...current, source });
export const setEventCategory = (category: CategoryFilter): void => set({ ...current, category });
export const pauseEventLog = (heldSeq: number, frozen: readonly Event[], frozenKey: string): void =>
  set({ ...current, heldSeq, frozen, frozenKey });
export const resumeEventLog = (): void =>
  set({ ...current, heldSeq: null, frozen: [], frozenKey: '' });
export const resetEventLogControls = (): void => set(INITIAL);

export function useEventLogControls(): EventLogControls {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => INITIAL,
  );
}
