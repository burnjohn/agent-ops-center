import { useSyncExternalStore } from 'react';

/**
 * Per-ticket session tab choice (UI-AC-78). Lives for the lifetime of the app (module scope), so it
 * survives navigating away from the ticket page and back, but not a reload.
 */
const chosen = new Map<string, string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function chooseSession(ticketId: string, sessionId: string): void {
  chosen.set(ticketId, sessionId);
  for (const listener of listeners) listener();
}

export function useChosenSession(ticketId: string): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => chosen.get(ticketId),
    () => undefined,
  );
}

/** Test helper: forget every choice. */
export function resetConsoleSelection(): void {
  chosen.clear();
  for (const listener of listeners) listener();
}
