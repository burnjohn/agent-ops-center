import { count, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConstraintRace } from '../../application/ports/errors.js';
import { ticket } from '../../domain/index.js';
import { freshFixture, openTestDb } from '../../../test/int/db.js';
import {
  FIXED_NOW,
  makeUow,
  movedDraft,
  RecordingPublisher,
  repoFactory,
} from '../../../test/int/factories.js';
import { PgUnitOfWork } from './unit-of-work.js';
import { EventsRepository } from '../repositories/events.repository.js';
import { events, idCounters, tickets } from './schema.js';

const handle = openTestDb();
const { db } = handle;

class Forced extends Error {}

async function counts(): Promise<{ tickets: number; events: number; nextTicket: number }> {
  const [t] = await db.select({ n: count() }).from(tickets);
  const [e] = await db.select({ n: count() }).from(events);
  const [c] = await db.select().from(idCounters).where(eq(idCounters.name, 'ticket'));
  return { tickets: t?.n ?? 0, events: e?.n ?? 0, nextTicket: c?.nextValue ?? 0 };
}

describe('PgUnitOfWork (ADR-0009 Confirmation, DB-AC-23/26/27/30)', () => {
  let publisher: RecordingPublisher;
  beforeEach(async () => {
    await freshFixture(db);
    publisher = new RecordingPublisher();
  });

  it('a forced throw after the state write and the event append leaves no state, no event, no counter bump and no publish (AC-26)', async () => {
    const uow = makeUow(handle, publisher);
    const before = await counts();

    // contract: a rolled-back command leaves neither the state change nor the event
    await expect(
      uow.run(async (tx) => {
        const number = await tx.nextNumber('ticket');
        await tx.tickets.insert(ticket.createTicket({ number, title: 'doomed', now: FIXED_NOW }));
        await tx.appendEvents([movedDraft('doomed', { ticketId: `T-${number}` })]);
        throw new Forced('boom');
      }),
    ).rejects.toBeInstanceOf(Forced);

    expect(await counts()).toEqual(before);
    expect(publisher.batches).toHaveLength(0);
  });

  it('a failure raised only by the database (event with a dangling reference) after the state write also rolls the state back (AC-26)', async () => {
    const uow = makeUow(handle, publisher);
    const before = await counts();

    // contract: a constraint failure in the journal write rolls back the earlier ticket insert
    await expect(
      uow.run(async (tx) => {
        const number = await tx.nextNumber('ticket');
        await tx.tickets.insert(ticket.createTicket({ number, title: 'doomed', now: FIXED_NOW }));
        await tx.appendEvents([movedDraft('dangling', { ticketId: 'T-99999' })]);
      }),
    ).rejects.toMatchObject({ name: 'ConstraintRace', kind: 'internal' });

    expect(await counts()).toEqual(before);
    expect(publisher.batches).toHaveLength(0);
  });

  it('a rolled-back create does not consume the number: the next committed ticket takes the previewed number (AC-23)', async () => {
    const uow = makeUow(handle, publisher);
    const preview = (await counts()).nextTicket;

    await expect(
      uow.run(async (tx) => {
        await tx.nextNumber('ticket');
        throw new Forced('rollback');
      }),
    ).rejects.toBeInstanceOf(Forced);

    // contract: committed ticket numbers have no gaps; the counter advanced only in the failed tx
    const committed = await uow.run(async (tx) => {
      const number = await tx.nextNumber('ticket');
      const t = ticket.createTicket({ number, title: 'first real', now: FIXED_NOW });
      await tx.tickets.insert(t);
      await tx.appendEvents([movedDraft('created', { ticketId: t.id })]);
      return t;
    });

    expect(committed.number).toBe(preview);
    expect((await counts()).nextTicket).toBe(preview + 1);
  });

  it('parallel commands get strictly increasing seq and gap-free numbers in commit order (AC-27)', async () => {
    const uow = makeUow(handle, publisher);
    const N = 8;
    const lockOrder: number[] = [];

    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        uow.run(async (tx) => {
          // the advisory lock is held from the first statement, so fn entry order is commit order
          lockOrder.push(i);
          const number = await tx.nextNumber('ticket');
          const t = ticket.createTicket({ number, title: `parallel ${i}`, now: FIXED_NOW });
          await tx.tickets.insert(t);
          await tx.appendEvents([movedDraft(`cmd-${i}`, { ticketId: t.id })]);
        }),
      ),
    );

    // contract: ordering by seq equals ordering by commit; numbers follow the same order without gaps
    const rows = await db.select().from(events).where(eq(events.type, 'ticket.moved'));
    const mine = rows
      .map((r) => ({
        seq: r.seq,
        summary: (r.payload as { summary: string }).summary,
        ticketId: r.ticketId,
      }))
      .filter((r) => r.summary.startsWith('cmd-') && r.ticketId !== null)
      .map((r) => ({ seq: r.seq, cmd: Number(r.summary.slice(4)), ticketId: r.ticketId as string }))
      .sort((a, b) => a.seq - b.seq);
    expect(mine).toHaveLength(N);
    expect(mine.map((r) => r.cmd)).toEqual(lockOrder);
    for (let i = 1; i < mine.length; i += 1) expect(mine[i]!.seq).toBeGreaterThan(mine[i - 1]!.seq);

    const numbers = mine.map((r) => Number(r.ticketId.slice(2)));
    expect(numbers).toEqual(numbers.map((_, i) => numbers[0]! + i));
  });

  it('publishes only after COMMIT: subscribers see committed rows, and a failing subscriber does not fail the command (AC-30)', async () => {
    const uow = makeUow(handle, publisher);
    const seen: number[] = [];
    let probe: Promise<number> = Promise.resolve(-1);
    publisher.onPublish = (evs) => {
      seen.push(...evs.map((e) => e.seq));
      // started at publish time on another pool connection: only committed rows can be seen
      probe = new EventsRepository(db).lastSeq();
      throw new Error('subscriber exploded');
    };

    const written = await uow.run(async (tx) => tx.appendEvents([movedDraft('visible')]));

    // contract: publish happens after the transaction committed, so a fresh connection sees the event
    const lastSeq = await new EventsRepository(db).lastSeq();
    expect(publisher.batches).toHaveLength(1);
    expect(seen).toEqual(written.map((e) => e.seq));
    expect(lastSeq).toBe(written[0]!.seq);
    expect(await probe).toBe(written[0]!.seq);

    // contract: a rolled-back command publishes nothing
    publisher.batches.length = 0;
    await expect(
      uow.run(async (tx) => {
        await tx.appendEvents([movedDraft('never')]);
        throw new Forced('nope');
      }),
    ).rejects.toBeInstanceOf(Forced);
    expect(publisher.batches).toHaveLength(0);
  });

  it('a duplicate ticket number is retried once, then surfaces as ConstraintRace internal (counter collision)', async () => {
    const uow = makeUow(handle, publisher);
    const existing = (await db.select().from(tickets).limit(1))[0]!;

    // contract: counter collision -> one retry, then `internal`
    let attempts = 0;
    const err = await uow
      .run(async (tx) => {
        attempts += 1;
        await tx.tickets.insert(
          ticket.createTicket({ number: existing.number, title: 'dup', now: FIXED_NOW }),
        );
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConstraintRace);
    expect((err as ConstraintRace).kind).toBe('internal');
    expect(attempts).toBe(2);
    expect(publisher.batches).toHaveLength(0);
  });

  it('events.at follows the simulation clock while real_at is wall time (DB-AC-32)', async () => {
    // a stepped clock far from wall time: 2026-01-01 plus the simulated seconds advanced so far
    let simMs = Date.parse(FIXED_NOW);
    const clock = {
      now: () => new Date(simMs).toISOString(),
      advance: (s: number) => void (simMs += s * 1000),
    };
    const uow = new PgUnitOfWork(handle, (tx) => ({ ...repoFactory(tx), clock }), publisher);

    const wallBefore = Date.now();
    const written = await uow.run(async (tx) => {
      tx.clock.advance(90);
      return tx.appendEvents([{ ...movedDraft('stepped'), at: tx.clock.now() }]);
    });
    const wallAfter = Date.now();

    // contract: `at` is the simulation time after the step, `real_at` is the wall-clock time of the write
    const [row] = await db.select().from(events).where(eq(events.seq, written[0]!.seq));
    expect(row!.at.toISOString()).toBe('2026-01-01T00:01:30.000Z');
    expect(row!.realAt.getTime()).toBeGreaterThanOrEqual(wallBefore - 1000);
    expect(row!.realAt.getTime()).toBeLessThanOrEqual(wallAfter + 1000);
    expect(row!.realAt.getTime()).not.toBe(row!.at.getTime());
    expect(written[0]!.at).toBe(row!.at.toISOString());
  });
});
