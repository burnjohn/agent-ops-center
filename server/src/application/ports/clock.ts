/** The Simulation Clock (SIM-10). Persisted by the adapter; advances only with steps. ISO timestamps, UTC. */
export interface SimClock {
  now(): string;
  advance(seconds: number): void;
}
