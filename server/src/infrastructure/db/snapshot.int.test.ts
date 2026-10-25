import { beforeEach, describe, expect, it } from 'vitest';
import { ticket } from '../../domain/index.js';
import { freshFixture, openTestDb } from '../../../test/int/db.js';
import {
  FIXED_NOW,
  makeSnapshotReader,
  makeUow,
  movedDraft,
  RecordingPublisher,
} from '../../../test/int/factories.js';
import { EventsRepository } from '../repositories/events.repository.js';

const handle = openTestDb();
const { db } = handle;

function createTicketCommand(title: string) {
  const uow = makeUow(handle, new RecordingPublisher());
  return uow.run(async (tx) => {
    const number = await tx.nextNumber('ticket');
    const t = ticket.createTicket({ number, title, now: FIXED_NOW });
    await tx.tickets.insert(t);
    await tx.appendEvents([movedDraft(`created ${title}`, { ticketId: t.id })]);
    return t;
  });
}

describe('PgSnapshotReader (DB-AC-29)', () => {
  beforeEach(() => freshFixture(db));

  it('a snapshot taken during concurrent writes is internally consistent with its asOfSeq, and replay from asOfSeq equals a fresh read', async () => {
    const reader = makeSnapshotReader(handle);

    const snap = await reader.read(async (q) => {
      const first = await q.listTickets();
      // a command commits while the snapshot transaction is still open
      await createTicketCommand('written during snapshot');
      const second = await q.listTickets();
      return { first, second };
    });

    // contract: all reads in one snapshot see the same state, unaffected by the concurrent commit
    expect(snap.data.second.map((t) => t.id)).toEqual(snap.data.first.map((t) => t.id));

    // contract: resuming from asOfSeq yields exactly the changes missing from the snapshot
    const missing = await new EventsRepository(db).since(snap.asOfSeq, 1000);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.type).toBe('ticket.moved');

    const fresh = await reader.read((q) => q.listTickets());
    expect(fresh.data).toHaveLength(snap.data.first.length + 1);
    expect(fresh.asOfSeq).toBe(missing[0]?.seq);
    expect(fresh.asOfSeq).toBeGreaterThan(snap.asOfSeq);
  });

  it('asOfSeq excludes a command that has appended events but not yet committed, and the reader is not blocked by it', async () => {
    const reader = makeSnapshotReader(handle);
    const before = await reader.read((q) => q.listTickets());
    const uow = makeUow(handle, new RecordingPublisher());

    let during: Awaited<ReturnType<typeof reader.read<number>>> | undefined;
    await uow.run(async (tx) => {
      const number = await tx.nextNumber('ticket');
      const t = ticket.createTicket({ number, title: 'uncommitted', now: FIXED_NOW });
      await tx.tickets.insert(t);
      await tx.appendEvents([movedDraft('uncommitted', { ticketId: t.id })]);
      during = await reader.read(async (q) => (await q.listTickets()).length);
    });

    // contract: asOfSeq is exactly what the data includes; uncommitted rows are in neither
    expect(during?.asOfSeq).toBe(before.asOfSeq);
    expect(during?.data).toBe(before.data.length);
  });

  it('exposes the same journal and simulation state inside the snapshot', async () => {
    const reader = makeSnapshotReader(handle);
    const { data, asOfSeq } = await reader.read(async (q) => ({
      last: await q.journal.lastSeq(),
      floor: await q.journal.floor(),
      sim: await q.simulation(),
    }));
    // contract: the journal's last seq inside the snapshot is the snapshot's asOfSeq; floor never exceeds it
    expect(data.last).toBe(asOfSeq);
    expect(data.sim.journalFloorSeq).toBe(data.floor);
    expect(data.floor).toBeLessThanOrEqual(asOfSeq);
  });
});
