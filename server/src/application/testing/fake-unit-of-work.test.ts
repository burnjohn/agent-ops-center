import { describe, expect, it } from 'vitest';
import { eventBuilders, ticket } from '../../domain/index.js';
import { createTestPorts } from './index.js';

const at = '2026-10-24T14:32:00.000Z';

describe('FakeUnitOfWork', () => {
  it('commits, assigns seq and publishes after commit', async () => {
    const p = createTestPorts();
    const n = await p.uow.run(async (tx) => {
      const num = await tx.nextNumber('ticket');
      const t = ticket.createTicket({ number: num, title: 'A', now: tx.clock.now() });
      await tx.tickets.insert(t);
      await tx.appendEvents([eventBuilders.ticketCreated({ at, ticketId: t.id }, t)]);
      return num;
    });
    expect(n).toBe(1);
    expect(p.publisher.events.map((e) => e.seq)).toEqual([1]);
    expect(await p.journal.lastSeq()).toBe(1);
  });

  it('rolls back state, counters and clock on throw and publishes nothing', async () => {
    const p = createTestPorts();
    await expect(
      p.uow.run(async (tx) => {
        const num = await tx.nextNumber('ticket');
        await tx.tickets.insert(ticket.createTicket({ number: num, title: 'A', now: at }));
        tx.clock.advance(6);
        await tx.appendEvents([]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(p.store.data.tickets.size).toBe(0);
    expect(p.store.data.counters.ticket).toBe(1);
    expect(p.clock.now()).toBe(at);
    expect(p.publisher.batches).toHaveLength(0);
  });

  it('snapshot reader reports asOfSeq', async () => {
    const p = createTestPorts();
    await p.uow.run(async (tx) => {
      const t = ticket.createTicket({ number: 1, title: 'A', now: at });
      await tx.tickets.insert(t);
      await tx.appendEvents([eventBuilders.ticketCreated({ at, ticketId: t.id }, t)]);
    });
    const r = await p.snapshots.read((q) => q.listTickets());
    expect(r.asOfSeq).toBe(1);
    expect(r.data).toHaveLength(1);
  });
});
