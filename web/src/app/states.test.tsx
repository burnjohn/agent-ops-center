import { CommandResult, TicketListResponse } from '@agent-ops/shared';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FakeEventSource } from '../test/FakeEventSource';
import { SEED_LAST_SEQ, buildTicket, seedTickets, ticketCreatedEvent } from '../test/fixtures';
import { createFakeNetwork, jsonResponse } from '../test/fakeNetwork';
import { renderApp } from '../test/renderApp';

describe('loading and error frames (UI-AC-27, UI-AC-28)', () => {
  it('keeps the header and title and shows LOADING… without numbers while the first read is pending', async () => {
    const net = createFakeNetwork().pending('GET', '/tickets');
    renderApp({ route: '/board', network: net });

    // Contract: the frame is there, the data region says LOADING…, and no partial KPIs/columns show.
    expect(await screen.findByRole('heading', { name: 'Board' })).toBeInTheDocument();
    expect(screen.getByText('LOADING…')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /AGENT OPS/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /backlog/i })).not.toBeInTheDocument();
    expect(screen.queryByText('■ Blocked')).not.toBeInTheDocument();
  });

  it('shows the server-not-responding error with Retry, and Retry reloads the data', async () => {
    const net = createFakeNetwork().networkFailure('GET', '/tickets');
    const { user } = renderApp({ route: '/board', network: net });

    // Contract: exact copy, announced as an alert, with a Retry button.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load the Board — the server is not responding.');
    expect(screen.getByRole('heading', { name: 'Board' })).toBeInTheDocument();

    // The server is back: Retry loads that data.
    net.on(
      'GET',
      '/tickets',
      jsonResponse(TicketListResponse, seedTickets(), { asOfSeq: SEED_LAST_SEQ }),
    );
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: /backlog/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('filters survive navigation and events (UI-AC-14)', () => {
  it('keeps the Board agent filter across navigation and an incoming event', async () => {
    const net = createFakeNetwork();
    const { user } = renderApp({ route: '/board', network: net });
    FakeEventSource.emitHello({ lastSeq: SEED_LAST_SEQ });
    await screen.findByRole('region', { name: /backlog/i });

    await user.selectOptions(screen.getByLabelText('Agent'), 'alpha');
    expect(screen.getByLabelText('Agent')).toHaveValue('alpha');

    // Navigation away and back via the primary nav.
    await user.click(screen.getByRole('link', { name: /^02 Mission Control/ }));
    await user.click(await screen.findByRole('link', { name: /^01 Board/ }));
    expect(await screen.findByLabelText('Agent')).toHaveValue('alpha');

    // An incoming event refreshes the data but never touches the filter.
    const created = buildTicket({
      id: 'T-17',
      number: 17,
      title: 'Pushed by the stream',
      status: 'backlog',
    });
    net.on(
      'GET',
      '/tickets',
      jsonResponse(TicketListResponse, [...seedTickets(), created], { asOfSeq: SEED_LAST_SEQ + 1 }),
    );
    FakeEventSource.emitEvent(ticketCreatedEvent(SEED_LAST_SEQ + 1, created));
    // The event invalidates /tickets; wait for the refetch to land before asserting.
    await vi.waitFor(() => expect(net.calls('GET', '/tickets').length).toBeGreaterThanOrEqual(2));
    // Contract: only an Operator action on that control changes it.
    expect(screen.getByLabelText('Agent')).toHaveValue('alpha');
  });
});

describe('toasts for commands (UI-AC-18, UI-AC-21)', () => {
  it('shows the success toast of a created ticket in the live region', async () => {
    const net = createFakeNetwork();
    const created = buildTicket({ id: 'T-17', number: 17, title: 'Brand new', status: 'backlog' });
    net.on(
      'POST',
      '/tickets',
      jsonResponse(CommandResult, { seq: SEED_LAST_SEQ + 1, ticket: created }, { status: 201 }),
    );
    const { user } = renderApp({ route: '/board', network: net });
    await user.click(await screen.findByRole('button', { name: '+ New ticket' }));
    await user.type(await screen.findByLabelText(/Title/), 'Brand new');
    await user.click(screen.getByRole('button', { name: /create/i }));

    // Contract: command succeeded -> its toast text appears in a polite live region.
    const toast = await screen.findByText('T-17 created in Backlog — move it to Ready for agents');
    expect(toast.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('shows the network-failure text and keeps what the Operator typed', async () => {
    const net = createFakeNetwork().networkFailure('POST', '/tickets');
    const { user } = renderApp({ route: '/board', network: net });
    await user.click(await screen.findByRole('button', { name: '+ New ticket' }));
    await user.type(await screen.findByLabelText(/Title/), 'Typed text survives');
    await user.click(screen.getByRole('button', { name: /create/i }));

    // Contract: «Couldn’t reach the server — try again.» is shown and the form keeps its text.
    expect(await screen.findByText(/Couldn’t reach the server — try again\./)).toBeInTheDocument();
    expect(screen.getByLabelText(/Title/)).toHaveValue('Typed text survives');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
