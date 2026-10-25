import type { Scheduler } from '../../application/ports/scheduler.js';

/** Real wall-clock timers (`setInterval`). Overlap and errors are the callers' concern; a rejected tick is swallowed. */
export function createIntervalScheduler(): Scheduler {
  return {
    every(ms, fn) {
      const timer = setInterval(() => {
        try {
          void Promise.resolve(fn()).catch(() => undefined);
        } catch {
          // a throwing tick must not stop the timer
        }
      }, ms);
      return () => clearInterval(timer);
    },
  };
}
