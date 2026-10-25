/** Wall-clock timer used by auto-play. `every` returns a cancel function. */
export interface Scheduler {
  every(ms: number, fn: () => void | Promise<void>): () => void;
}
