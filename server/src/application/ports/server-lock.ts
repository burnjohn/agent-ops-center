export interface ServerLockHandle {
  release(): Promise<void>;
}

/** Process-lifetime "a server is running" lock; reset probes it (SPEC-server-api AC-65). */
export interface ServerLockPort {
  /** Null when another server already holds the lock. */
  acquire(): Promise<ServerLockHandle | null>;
  isRunning(): Promise<boolean>;
}
