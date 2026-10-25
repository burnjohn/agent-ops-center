import type { Scheduler } from '../ports/scheduler.js';

interface Job {
  ms: number;
  fn: () => void | Promise<void>;
}

/** Manual scheduler: nothing runs until `tick()`. */
export class FakeScheduler implements Scheduler {
  private readonly jobs = new Set<Job>();

  every(ms: number, fn: () => void | Promise<void>): () => void {
    const job: Job = { ms, fn };
    this.jobs.add(job);
    return () => {
      this.jobs.delete(job);
    };
  }

  get activeCount(): number {
    return this.jobs.size;
  }

  /** Runs every active job once, in registration order. */
  async tick(): Promise<void> {
    for (const job of [...this.jobs]) await job.fn();
  }
}
