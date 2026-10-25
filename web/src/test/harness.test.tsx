import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeEventSource } from './FakeEventSource';
import { buildTicket, SEED_LAST_SEQ, seedTickets, ticketCreatedEvent } from './fixtures';
import { createFakeNetwork, errorResponse, jsonResponse } from './fakeNetwork';
import { renderApp } from './renderApp';
import { TicketListResponse } from '@agent-ops/shared';

describe('test harness', () => {
  it('renders /board from faked fetch and applies a pushed SSE event', async () => {
    const net = createFakeNetwork();
    renderApp({ route: '/board', network: net });

    // The seed has 16 tickets; T-16 sits in the Backlog column.
    const backlog = await screen.findByRole('region', { name: /backlog/i });
    expect(
      await within(backlog).findByRole('link', { name: /Export Event Log as CSV/ }),
    ).toBeInTheDocument();

    // The stream opened exactly one connection and the hello makes it live.
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.current.url).toBe('/api/stream');
    FakeEventSource.emitHello({ lastSeq: SEED_LAST_SEQ });

    // A new ticket arriving as an event shows up on the Board without a refetch.
    const created = buildTicket({
      id: 'T-17',
      number: 17,
      title: 'Pushed by the stream',
      status: 'backlog',
    });
    // Events invalidate the stale read; the refetch then serves the post-event state (asOfSeq 45).
    net.on(
      'GET',
      '/tickets',
      jsonResponse(TicketListResponse, [...seedTickets(), created], { asOfSeq: SEED_LAST_SEQ + 1 }),
    );
    FakeEventSource.emitEvent(ticketCreatedEvent(SEED_LAST_SEQ + 1, created));
    expect(await within(backlog).findByText('Pushed by the stream')).toBeInTheDocument();
  });

  it('serves overrides, validates them against the contract, and records requests', async () => {
    const net = createFakeNetwork();
    const only = seedTickets().slice(0, 1);
    net.on('GET', '/tickets', jsonResponse(TicketListResponse, only, { asOfSeq: SEED_LAST_SEQ }));
    renderApp({ network: net });

    expect(await screen.findByRole('region', { name: /^done/i })).toBeInTheDocument();
    expect(net.calls('GET', '/tickets')).toHaveLength(1);

    // A fake that breaks the contract must fail at build time, not reach the app.
    expect(() => jsonResponse(TicketListResponse, [{ id: 'nope' }] as never)).toThrow();
    expect(errorResponse(409, 'stale_state', 'Changed.').body).toMatchObject({
      error: { code: 'stale_state' },
    });
  });
});
