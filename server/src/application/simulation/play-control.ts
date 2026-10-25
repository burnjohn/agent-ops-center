import { eventBuilders } from '../../domain/index.js';
import type { Scheduler } from '../ports/scheduler.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';
import { commitEvents } from '../services/ticket-work.js';
import { stepAll } from './step-all.js';
import type { StepDeps } from './step-agent.js';

export const PLAY_TICK_MS = 1600;
export const HOLD_TTL_MS = 15_000;

export interface PlayControlDeps extends StepDeps {
  uow: UnitOfWork;
  scheduler: Scheduler;
  /** Real (wall-clock) milliseconds; hold expiry never uses the Simulation Clock (API-AC-56). */
  realNowMs: () => number;
  onTickError?: (error: unknown) => void;
}

export interface HoldResult {
  held: boolean;
  /** Real epoch ms; the presentation layer formats it. */
  expiresAtMs: number | null;
}

export interface PlayControl {
  isPlaying(): boolean;
  play(): Promise<{ seq: number; playing: boolean }>;
  pause(): Promise<{ seq: number; playing: boolean }>;
  /** Grants/renews (`held: true`) or releases a client's hold. */
  setHold(clientId: string, held: boolean): HoldResult;
  hasActiveHold(): boolean;
  /** Stops the timer (shutdown / reset). */
  dispose(): void;
}

/**
 * Play flag, the 1.6 s tick and client holds (API-AC-54, AC-56). In-memory only: Play is off after every
 * construction (boot or reset); nothing happens without an explicit command (ADR-0008).
 */
export function createPlayControl(deps: PlayControlDeps): PlayControl {
  let playing = false;
  let cancel: (() => void) | null = null;
  let busy = false;
  const holds = new Map<string, number>();

  const activeHold = (): boolean => {
    const now = deps.realNowMs();
    for (const [id, expires] of holds) if (expires <= now) holds.delete(id);
    return holds.size > 0;
  };

  const tick = async (): Promise<void> => {
    if (!playing || busy || activeHold()) return;
    busy = true;
    try {
      await stepAll({ ...deps, isPlaying: () => playing }, 'play');
    } catch (error) {
      deps.onTickError?.(error);
    } finally {
      busy = false;
    }
  };

  const setPlaying = async (next: boolean): Promise<{ seq: number; playing: boolean }> => {
    if (playing === next) return { seq: 0, playing };
    const seq = await deps.uow.run(async (tx) =>
      commitEvents(tx, [eventBuilders.simulationPlayChanged({ at: tx.clock.now() }, next)]),
    );
    playing = next;
    if (next) {
      cancel = deps.scheduler.every(PLAY_TICK_MS, tick);
    } else {
      cancel?.();
      cancel = null;
    }
    return { seq, playing };
  };

  return {
    isPlaying: () => playing,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    setHold(clientId, held) {
      if (!held) {
        holds.delete(clientId);
        return { held: false, expiresAtMs: null };
      }
      const expires = deps.realNowMs() + HOLD_TTL_MS;
      holds.set(clientId, expires);
      return { held: true, expiresAtMs: expires };
    },
    hasActiveHold: activeHold,
    dispose() {
      cancel?.();
      cancel = null;
      playing = false;
    },
  };
}
