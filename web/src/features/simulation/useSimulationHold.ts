import { useEffect, useRef } from 'react';
import { useHold } from '../../api/commands';

/** Server expires a hold 15 s after the last renewal (server-api AC-56); renew well inside that. */
export const HOLD_RENEW_MS = 10_000;

const STORAGE_KEY = 'aoc.simulation.clientId';
let memoryId: string | undefined;

/** Stable per-tab client id: sessionStorage survives reloads of the tab, memory is the fallback. */
export function getClientId(): string {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
    const id = crypto.randomUUID();
    sessionStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    memoryId ??= crypto.randomUUID();
    return memoryId;
  }
}

/**
 * While `active` (a modal is open or a card is dragged) hold the simulation: hold on, renew every 10 s,
 * release when the interaction ends or the component unmounts (UI-AC-9). Never toggles Play.
 */
export function useSimulationHold(active: boolean): void {
  const { mutate } = useHold();
  const send = useRef(mutate);
  send.current = mutate;

  useEffect(() => {
    if (!active) return;
    const clientId = getClientId();
    send.current({ clientId, held: true });
    const timer = setInterval(() => send.current({ clientId, held: true }), HOLD_RENEW_MS);
    return () => {
      clearInterval(timer);
      send.current({ clientId, held: false });
    };
  }, [active]);
}
