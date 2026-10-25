import { useSyncExternalStore } from 'react';

/**
 * Board filters are UI state (ADR-0011): module-level so they survive leaving and re-opening the Board,
 * and are never touched by events or navigation (UI-AC-14).
 */
export interface BoardFilters {
  agentId: string;
  blockedOnly: boolean;
}

export const ALL_AGENTS = '';
const NO_FILTERS: BoardFilters = { agentId: ALL_AGENTS, blockedOnly: false };

let current: BoardFilters = NO_FILTERS;
const listeners = new Set<() => void>();

function set(next: BoardFilters): void {
  current = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const setAgentFilter = (agentId: string): void => set({ ...current, agentId });
export const setBlockedOnly = (blockedOnly: boolean): void => set({ ...current, blockedOnly });
export const clearBoardFilters = (): void => set(NO_FILTERS);

export function useBoardFilters(): BoardFilters {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => NO_FILTERS,
  );
}

export const isFiltering = (f: BoardFilters): boolean => f.agentId !== ALL_AGENTS || f.blockedOnly;

/** «Filter on: agent <id>, blocked only.» — only the parts that apply (UI-AC-42). */
export function filterHint(f: BoardFilters): string {
  const parts: string[] = [];
  if (f.agentId !== ALL_AGENTS) parts.push(`agent ${f.agentId}`);
  if (f.blockedOnly) parts.push('blocked only');
  return parts.length ? `Filter on: ${parts.join(', ')}.` : '';
}
