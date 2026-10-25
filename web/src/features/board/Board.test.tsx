import { SimulationState, TicketListResponse, type Ticket } from '@agent-ops/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeNetwork, jsonResponse } from '../../test/fakeNetwork';
import { SEED_LAST_SEQ, buildSimulation, seedTickets } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

const COLUMNS = ['Backlog', 'Ready', 'In Progress', 'Review', 'Done'] as const;

async function column(name: string): Promise<HTMLElement> {
  return screen.findByRole('region', { name });
}

function cardTitles(col: HTMLElement): string[] {
  return within(col)
    .queryAllByRole('article')
    .map((a) => a.getAttribute('aria-label') ?? '');
}

async function renderBoard(tickets?: Ticket[], clock?: string) {
  const net = createFakeNetwork();
  if (tickets) {
    net.on(
      'GET',
      '/tickets',
      jsonResponse(TicketListResponse, tickets, { asOfSeq: SEED_LAST_SEQ }),
    );
  }
  if (clock) {
    net.on(
      'GET',
      '/simulation',
      jsonResponse(SimulationState, buildSimulation({ clock }), { asOfSeq: SEED_LAST_SEQ }),
    );
  }
  const app = renderApp({ route: '/board', network: net });
  await column('Backlog');
  return app;
}

function kpiOf(label: string): HTMLElement {
  const tile = screen.getByText(label).parentElement;
  if (!tile) throw new Error(`no KPI ${label}`);
  return tile;
}

describe('Board layout and content', () => {
  it('shows the title, KPIs 16 · 3 · 1 and the five columns in order with counts 3/3/3/2/5 (UI-AC-35)', async () => {
    await renderBoard();

    // Contract: title `Board`, KPIs Tickets / Agents working / ■ Blocked read 16, 3, 1 on the seed.
    expect(screen.getByRole('heading', { level: 1, name: 'Board' })).toBeInTheDocument();
    expect(kpiOf('Tickets')).toHaveTextContent('16');
    expect(kpiOf('Agents working')).toHaveTextContent('3');
    expect(kpiOf('■ Blocked')).toHaveTextContent('1');

    // Contract: columns appear Backlog → Done, numbered 01…05, each with its card count.
    const regions = screen
      .getAllByRole('region')
      .filter((r) => COLUMNS.some((c) => r.getAttribute('aria-label') === c));
    expect(regions.map((r) => r.getAttribute('aria-label'))).toEqual([...COLUMNS]);
    regions.forEach((r, i) => expect(within(r).getByText(`0${i + 1}`)).toBeInTheDocument());
    const counts = regions.map((r) => within(r).getByLabelText(/ tickets$/).textContent);
    expect(counts).toEqual(['3', '3', '3', '2', '5']);
  });

  it('keeps the card order the server sent within a column (UI-AC-36)', async () => {
    // Contract: the server orders (priority, then oldest); the Board must not re-sort. Seed Ready reads T-13, T-11, T-10.
    const tickets = seedTickets();
    const ready = ['T-13', 'T-11', 'T-10'].map((id) => tickets.find((t) => t.id === id) as Ticket);
    const rest = tickets.filter((t) => !ready.includes(t));
    await renderBoard([...rest, ...ready]);

    const col = await column('Ready');
    expect(cardTitles(col).map((l) => l.split(' ')[0])).toEqual(['T-13', 'T-11', 'T-10']);
  });

  it('shows the three empty texts (UI-AC-37)', async () => {
    // Contract: empty Backlog -> «Create a ticket to start», other empty column -> «Nothing here».
    const noBacklogOrReady = seedTickets().filter(
      (t) => t.status !== 'backlog' && t.status !== 'ready',
    );
    const { user } = await renderBoard(noBacklogOrReady);
    expect(
      within(await column('Backlog')).getByText('Create a ticket to start'),
    ).toBeInTheDocument();
    expect(within(await column('Ready')).getByText('Nothing here')).toBeInTheDocument();

    // Contract: with a filter on, every empty column says «Nothing matches the filter».
    await user.click(screen.getByRole('checkbox', { name: 'Blocked only' }));
    expect(
      within(await column('Backlog')).getByText('Nothing matches the filter'),
    ).toBeInTheDocument();
    expect(
      within(await column('Ready')).getByText('Nothing matches the filter'),
    ).toBeInTheDocument();
  });

  it('renders a working card with id, priority, link, stepper, agent, stage, age and last update (UI-AC-38)', async () => {
    await renderBoard();
    const card = within(await column('In Progress')).getByRole('article', { name: /^T-12 / });

    // Contract: T-12 is alpha's current ticket in IMPLEMENTING; age is relative to the Simulation Clock.
    expect(within(card).getByText('T-12')).toBeInTheDocument();
    expect(within(card).getByText('HIGH')).toBeInTheDocument();
    expect(
      within(card).getByRole('link', { name: 'SSE reconnect with event replay' }),
    ).toHaveAttribute('href', '/tickets/T-12');
    expect(within(card).getByText('Stage: Implementing')).toBeInTheDocument();
    expect(within(card).getByText('alpha')).toBeInTheDocument();
    expect(within(card).getByText('IMPLEMENTING')).toBeInTheDocument();
    expect(within(card).getByText(/^\d+[SMH]$/)).toBeInTheDocument();
    expect(within(card).queryByText('■ BLOCKED')).not.toBeInTheDocument();
  });

  it('shows WAITING when the assignee is no longer on the ticket (UI-AC-38)', async () => {
    // Contract: agent not on this ticket (sim-3 holds T-6 in Review but is awaiting_review on it) vs. detached.
    const tickets = seedTickets().map((t) =>
      t.id === 'T-9' ? { ...t, assigneeId: 'charlie' } : t,
    );
    await renderBoard(tickets);
    const card = within(await column('In Progress')).getByRole('article', { name: /^T-9 / });
    // charlie is idle with no current ticket, so it is not on T-9.
    expect(within(card).getByText('WAITING')).toBeInTheDocument();
  });

  it('fills a blocked card with its flag and the agent question instead of the last update (UI-AC-39)', async () => {
    await renderBoard();
    const card = within(await column('In Progress')).getByRole('article', { name: /^T-8 / });
    const ticket = seedTickets().find((t) => t.id === 'T-8') as Ticket;

    // Contract: Blocked card shows «■ BLOCKED» and the question, never the last-update line.
    expect(within(card).getByText('■ BLOCKED')).toBeInTheDocument();
    expect(within(card).getByText(ticket.blockedQuestion as string)).toBeInTheDocument();
    if (ticket.lastUpdate)
      expect(within(card).queryByText(ticket.lastUpdate.text)).not.toBeInTheDocument();
  });

  it('shows Done cards without agent, stepper or last update (UI-AC-40)', async () => {
    await renderBoard();
    const card = within(await column('Done')).getByRole('article', { name: /^T-1 / });

    // Contract: a Done card keeps id, priority and title only.
    expect(within(card).getByText('T-1')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Event store on SQLite' })).toBeInTheDocument();
    expect(within(card).queryByText('alpha')).not.toBeInTheDocument();
    expect(within(card).queryByText(/^Stage:/)).not.toBeInTheDocument();
  });

  it('marks a card UPDATED only while its last change is at most 7 s of Simulation Clock old (UI-AC-33)', async () => {
    // T-9 changed at 14:31:50Z. Contract: marker present up to and including 7 s, gone after.
    await renderBoard(undefined, '2026-10-24T14:31:57Z');
    const card = within(await column('In Progress')).getByRole('article', { name: /^T-9 / });
    expect(within(card).getByText('UPDATED')).toBeInTheDocument();
    expect(
      within(
        within(await column('In Progress')).getByRole('article', { name: /^T-12 / }),
      ).queryByText('UPDATED'),
    ).not.toBeInTheDocument();
  });

  it('drops the UPDATED marker one second past the window (UI-AC-33)', async () => {
    await renderBoard(undefined, '2026-10-24T14:31:58Z');
    const card = within(await column('In Progress')).getByRole('article', { name: /^T-9 / });
    expect(within(card).queryByText('UPDATED')).not.toBeInTheDocument();
  });
});

describe('Board interaction', () => {
  it('reaches each card with one Tab stop and opens the ticket on Enter (UI-AC-41)', async () => {
    const { user } = await renderBoard();
    const card = within(await column('Ready')).getByRole('article', { name: /^T-13 / });

    // Contract: the card is the focus stop; its inner link is not a second one.
    expect(card).toHaveAttribute('tabindex', '0');
    expect(within(card).getByRole('link')).toHaveAttribute('tabindex', '-1');
    card.focus();
    await user.keyboard('{Enter}');
    // Contract: Enter navigates away from the Board to /tickets/T-13.
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Backlog' })).not.toBeInTheDocument(),
    );
  });

  it('opens the ticket on a click anywhere on the card (UI-AC-41)', async () => {
    const { user } = await renderBoard();
    const card = within(await column('Backlog')).getByRole('article', { name: /^T-14 / });
    await user.click(within(card).getByText('T-14'));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Backlog' })).not.toBeInTheDocument(),
    );
  });

  it('filters by agent and by blocked, with a hint line and Clear filters (UI-AC-42)', async () => {
    const { user } = await renderBoard();

    // Contract: select lists All agents + every agent id.
    const select = screen.getByRole('combobox', { name: 'Agent' });
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['All agents', 'alpha', 'bravo', 'charlie', 'sim-1', 'sim-2', 'sim-3']);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();

    await user.selectOptions(select, 'alpha');
    expect(screen.getByText('Filter on: agent alpha.')).toBeInTheDocument();
    const shown = screen.getAllByRole('article').map((a) => a.getAttribute('aria-label') ?? '');
    expect(shown.every((l) => /^T-(1|3|5|12) /.test(l))).toBe(true);

    await user.click(screen.getByRole('checkbox', { name: 'Blocked only' }));
    expect(screen.getByText('Filter on: agent alpha, blocked only.')).toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);

    await user.click(screen.getByRole('checkbox', { name: 'Blocked only' }));
    await user.selectOptions(select, 'All agents');
    await user.click(screen.getByRole('checkbox', { name: 'Blocked only' }));
    expect(screen.getByText('Filter on: blocked only.')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('checkbox', { name: 'Blocked only' })).not.toBeChecked();
    expect(screen.getAllByRole('article')).toHaveLength(16);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('opens the New ticket modal from + New ticket with focus in Title (UI-AC-43)', async () => {
    const { user } = await renderBoard();
    await user.click(screen.getByRole('button', { name: '+ New ticket' }));
    const dialog = await screen.findByRole('dialog', { name: 'New ticket' });
    expect(within(dialog).getByRole('textbox', { name: /^Title/ })).toHaveFocus();
  });

  it('shows the drag footer verbatim and never says any column works (UI-AC-44)', async () => {
    await renderBoard();
    expect(
      screen.getByText(
        'Drag a card to a highlighted column. Moving to In Progress asks which agent takes it; work leaves an agent only by releasing it to Ready, with confirmation. Only the agent submits for review. Without a mouse: open a ticket and use its Move buttons.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/any column/i)).not.toBeInTheDocument();
  });
});

describe('Board drag hints and styles', () => {
  const dataTransfer = () => ({
    data: {} as Record<string, string>,
    setData(k: string, v: string) {
      this.data[k] = v;
    },
    getData(k: string) {
      return this.data[k] ?? '';
    },
    effectAllowed: 'all',
    dropEffect: 'none',
    types: [] as string[],
  });

  it('shows the hint line and per-column hints while dragging T-12, none in its own column (UI-AC-46)', async () => {
    await renderBoard();
    const card = within(await column('In Progress')).getByRole('article', { name: /^T-12 / });
    fireEvent.dragStart(card, { dataTransfer: dataTransfer() });

    // Contract: hint line names the card; In Progress → Ready asks to confirm, → Backlog/Review are refused.
    expect(
      await screen.findByText('Moving T-12 — highlighted columns accept it.'),
    ).toBeInTheDocument();
    expect(
      within(await column('Ready')).getByText('↓ DROP — RELEASE (CONFIRM)'),
    ).toBeInTheDocument();
    expect(
      within(await column('Backlog')).getByText('⊘ RELEASE IT TO READY FIRST'),
    ).toBeInTheDocument();
    expect(
      within(await column('Review')).getByText('⊘ ONLY THE AGENT SUBMITS WORK FOR REVIEW'),
    ).toBeInTheDocument();
    expect(
      within(await column('Done')).getByText('↓ DROP — MARK DONE (CONFIRM)'),
    ).toBeInTheDocument();
    expect(within(await column('In Progress')).queryByText(/DROP|⊘/)).not.toBeInTheDocument();

    // Contract: drag end removes hints.
    fireEvent.dragEnd(card);
    expect(screen.queryByText(/Moving T-12/)).not.toBeInTheDocument();
    expect(screen.queryByText(/↓ DROP|⊘/)).not.toBeInTheDocument();
  });

  it('marks an accepting column as a drop target on dragover and ignores refused or own columns (UI-AC-47)', async () => {
    await renderBoard();
    const card = within(await column('In Progress')).getByRole('article', { name: /^T-12 / });
    const dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });

    // Contract: dragover on a column marks it droppable (default prevented) -> fireEvent returns false.
    const ready = await column('Ready');
    const before = ready.className;
    expect(fireEvent.dragOver(ready, { dataTransfer: dt })).toBe(false);
    expect(ready.className).not.toBe(before);
    // Own column: not a drop target.
    expect(fireEvent.dragOver(await column('In Progress'), { dataTransfer: dt })).toBe(true);
  });

  it('opens the confirmation on a drop on an accepting column (UI-AC-48)', async () => {
    await renderBoard();
    const card = within(await column('In Progress')).getByRole('article', { name: /^T-12 / });
    const dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.drop(await column('Ready'), { dataTransfer: dt });
    expect(
      await screen.findByRole('alertdialog', { name: 'Move T-12 to Ready?' }),
    ).toBeInTheDocument();
  });

  it('does nothing when dropped on its own column, and sends no request (UI-AC-49)', async () => {
    const { network } = await renderBoard();
    const card = within(await column('Ready')).getByRole('article', { name: /^T-13 / });
    const dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.drop(await column('Ready'), { dataTransfer: dt });

    expect(screen.queryByRole('status')?.textContent ?? '').toBe('');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(network.calls('POST', '/tickets/T-13/move')).toHaveLength(0);
  });

  it('makes Done cards draggable and holds the simulation while dragging (UI-AC-50)', async () => {
    const { network } = await renderBoard();
    network.on('POST', '/simulation/hold', {
      status: 200,
      body: { held: true, expiresAt: '2026-10-24T14:32:15Z' },
    });
    const card = within(await column('Done')).getByRole('article', { name: /^T-1 / });
    expect(card).toHaveAttribute('draggable', 'true');

    const dt = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    await waitFor(() =>
      expect(network.calls('POST', '/simulation/hold')[0]?.body).toMatchObject({ held: true }),
    );

    // Contract: dropping T-1 on Ready opens the Reopen confirmation.
    fireEvent.drop(await column('Ready'), { dataTransfer: dt });
    expect(
      await screen.findByRole('alertdialog', { name: 'Reopen T-1 in Ready?' }),
    ).toBeInTheDocument();
  });

  it('hides filtered-out cards, so they cannot be dragged (UI-AC-50)', async () => {
    const { user } = await renderBoard();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Agent' }), 'bravo');
    expect(screen.queryByRole('article', { name: /^T-1 / })).not.toBeInTheDocument();
  });
});
