import { addSeconds } from '../../domain/index.js';
import type { SimClock } from '../ports/clock.js';
import type { InMemoryStore } from './in-memory-store.js';

/** Simulation clock kept in the store, so a rolled-back transaction also rolls the clock back. */
export class FakeClock implements SimClock {
  constructor(private readonly store: InMemoryStore) {}

  now(): string {
    return this.store.data.simulation.clockAt;
  }

  advance(seconds: number): void {
    this.store.data.simulation.clockAt = addSeconds(this.now(), seconds);
  }
}
