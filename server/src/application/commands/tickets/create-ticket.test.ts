import { describe, expect, it } from 'vitest';
import { DomainRefusal } from '../../../domain/index.js';
import { createTestPorts } from '../../testing/index.js';
import { createTicket } from './create-ticket.js';

describe('createTicket (API-AC-7/8)', () => {
  it('stores a Backlog ticket with the next id and emits ticket.created', async () => {
    const p = createTestPorts();
    p.store.data.counters.ticket = 17;
    const out = await createTicket(
      { uow: p.uow },
      { title: '  Add pagination ', acceptanceCriteria: [' a ', '  ', 'b'] },
    );
    expect(out.ticket).toMatchObject({
      id: 'T-17',
      title: 'Add pagination',
      status: 'backlog',
      priority: 'medium',
      acceptanceCriteria: ['a', 'b'],
      assigneeId: null,
      createdAt: p.clock.now(),
      updatedAt: p.clock.now(),
    });
    expect(p.store.data.tickets.get('T-17')).toBeDefined();
    expect(p.publisher.events.map((e) => e.type)).toEqual(['ticket.created']);
    expect(out.seq).toBe(p.publisher.events[0]?.seq);
  });

  it('refuses a whitespace title without writing anything', async () => {
    const p = createTestPorts();
    const err = await createTicket({ uow: p.uow }, { title: '   ' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainRefusal);
    expect(err).toMatchObject({
      code: 'validation_failed',
      path: 'title',
      message: 'Title is required.',
    });
    expect(p.store.data.tickets.size).toBe(0);
    expect(p.store.data.counters.ticket).toBe(1);
    expect(p.publisher.events).toHaveLength(0);
  });
});
