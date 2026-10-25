import type { ServerLockHandle, ServerLockPort } from '../ports/server-lock.js';

export class FakeServerLock implements ServerLockPort {
  private held = false;

  async acquire(): Promise<ServerLockHandle | null> {
    if (this.held) return null;
    this.held = true;
    return {
      release: async () => {
        this.held = false;
      },
    };
  }

  async isRunning(): Promise<boolean> {
    return this.held;
  }
}
