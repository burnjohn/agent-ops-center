import { FakeClock } from './fake-clock.js';
import { FakeScheduler } from './fake-scheduler.js';
import { FakeServerLock } from './fake-server-lock.js';
import { FakeUnitOfWork } from './fake-unit-of-work.js';
import { InMemoryEventJournal } from './in-memory-journal.js';
import { InMemorySnapshotReader } from './in-memory-read-queries.js';
import { InMemoryStore } from './in-memory-store.js';
import { RecordingPublisher } from './recording-publisher.js';

export * from './fake-clock.js';
export * from './fake-scheduler.js';
export * from './fake-server-lock.js';
export * from './fake-unit-of-work.js';
export * from './in-memory-journal.js';
export * from './in-memory-read-queries.js';
export * from './in-memory-store.js';
export * from './recording-publisher.js';

/** A fully wired set of in-memory ports for application tests. */
export function createTestPorts() {
  const store = new InMemoryStore();
  const publisher = new RecordingPublisher();
  return {
    store,
    publisher,
    uow: new FakeUnitOfWork(store, publisher),
    snapshots: new InMemorySnapshotReader(store),
    journal: new InMemoryEventJournal(store),
    clock: new FakeClock(store),
    scheduler: new FakeScheduler(),
    serverLock: new FakeServerLock(),
  };
}
