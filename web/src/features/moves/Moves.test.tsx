import {
  AgentListResponse,
  CommandResult,
  MSG_COMMENT_REQUIRED,
  MSG_TITLE_REQUIRED,
  TicketListResponse,
  type Agent,
} from '@agent-ops/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeEventSource } from '../../test/FakeEventSource';
import {
  createFakeNetwork,
  errorResponse,
  jsonResponse,
  type FakeNetwork,
} from '../../test/fakeNetwork';
import {
  SEED_LAST_SEQ,
  seedAgents,
  seedTickets,
  ticketCreatedEvent,
  buildTicket,
} from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

const ok = () => jsonResponse(CommandResult, { seq: SEED_LAST_SEQ + 1 });

function networkWithCommands(): FakeNetwork {
  const net = createFakeNetwork();
  net.on('POST', '/simulation/hold', {
    status: 200,
    body: { held: true, expiresAt: '2026-10-24T14:32:15Z' },
  });
  net.on('POST', /^\/tickets\/[^/]+\/(move|assign|request-changes)$/, ok());
  net.on('POST', '/tickets', ok());
  return net;
}

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

async function column(name: string): Promise<HTMLElement> {
  return screen.findByRole('region', { name });
}

/** Drags the card `id` from its column onto `to` (jsdom has no real DnD; a stub DataTransfer carries the id). */
async function drag(id: string, from: string, to: string): Promise<void> {
  const card = within(await column(from)).getByRole('article', { name: new RegExp(`^${id} `) });
  const dt = dataTransfer();
  fireEvent.dragStart(card, { dataTransfer: dt });
  fireEvent.drop(await column(to), { dataTransfer: dt });
}

async function boardApp(net: FakeNetwork = networkWithCommands()) {
  const app = renderApp({ route: '/board', network: net });
  await column('Backlog');
  return app;
}

const toast = () => screen.getByRole('status');

describe('refused moves (UI-AC-19)', () => {
  it('toasts the table reason and sends no request when dropping on a refused cell', async () => {
    const { network } = await boardApp();

    // Contract: In Progress -> Backlog is refused with «Release it to Ready first»; the ticket stays put.
    await drag('T-12', 'In Progress', 'Backlog');
    await waitFor(() =>
      expect(toast()).toHaveTextContent('Can’t move T-12 to Backlog: Release it to Ready first'),
    );
    expect(
      network.requests.filter((r) => r.method === 'POST' && r.path !== '/simulation/hold'),
    ).toHaveLength(0);
    expect(
      within(await column('In Progress')).getByRole('article', { name: /^T-12 / }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    // Contract: a newer toast replaces the older one (UI-AC-18).
    await drag('T-14', 'Backlog', 'Review');
    await waitFor(() =>
      expect(toast()).toHaveTextContent(
        'Can’t move T-14 to Review: Nobody worked on it yet — move it to In Progress first',
      ),
    );
    expect(toast()).not.toHaveTextContent('T-12');
  });
});

describe('plain move commands and their toasts (UI-AC-18, AC-45, AC-51)', () => {
  it('sends expectedStatus without confirmed for Backlog -> Ready and toasts the column', async () => {
    const { network } = await boardApp();
    await drag('T-14', 'Backlog', 'Ready');

    await waitFor(() => expect(network.calls('POST', '/tickets/T-14/move')).toHaveLength(1));
    // Contract: `confirmed` is only ever sent from a confirm button.
    expect(network.calls('POST', '/tickets/T-14/move')[0]?.body).toEqual({
      to: 'ready',
      expectedStatus: 'backlog',
    });
    await waitFor(() => expect(toast()).toHaveTextContent('T-14 moved to Ready'));
  });

  it('moves Ready -> Backlog and Backlog -> Done with the plain toast (UI-AC-51)', async () => {
    const { network } = await boardApp();
    await drag('T-13', 'Ready', 'Backlog');
    await waitFor(() => expect(toast()).toHaveTextContent('T-13 moved to Backlog'));
    await drag('T-15', 'Backlog', 'Done');
    await waitFor(() => expect(toast()).toHaveTextContent('T-15 moved to Done'));
    expect(network.calls('POST', '/tickets/T-15/move')[0]?.body).toEqual({
      to: 'done',
      expectedStatus: 'backlog',
    });
  });

  it('approves a Review ticket dropped on Done', async () => {
    const { network } = await boardApp();
    await drag('T-7', 'Review', 'Done');
    await waitFor(() => expect(toast()).toHaveTextContent('T-7 approved — moved to Done'));
    expect(network.calls('POST', '/tickets/T-7/move')[0]?.body).toEqual({
      to: 'done',
      expectedStatus: 'review',
    });
  });
});

describe('server refusals and network failures (UI-AC-20, AC-21)', () => {
  it('shows the envelope reason and leaves the board unchanged', async () => {
    const net = networkWithCommands();
    net.on(
      'POST',
      '/tickets/T-14/move',
      errorResponse(409, 'stale_state', 'Ticket changed.', { reason: 'T-14 is now in Ready.' }),
    );
    await boardApp(net);
    await drag('T-14', 'Backlog', 'Ready');

    // Contract: text = reason if present.
    await waitFor(() =>
      expect(toast()).toHaveTextContent('Can’t move T-14 to Ready: T-14 is now in Ready.'),
    );
    expect(
      within(await column('Backlog')).getByRole('article', { name: /^T-14 / }),
    ).toBeInTheDocument();
  });

  it('falls back to the envelope message when there is no reason', async () => {
    const net = networkWithCommands();
    net.on(
      'POST',
      '/tickets/T-14/move',
      errorResponse(503, 'db_unavailable', 'The database is unavailable.'),
    );
    await boardApp(net);
    await drag('T-14', 'Backlog', 'Ready');
    await waitFor(() =>
      expect(toast()).toHaveTextContent('Can’t move T-14 to Ready: The database is unavailable.'),
    );
  });

  it('says it could not reach the server on a network failure', async () => {
    const net = networkWithCommands();
    net.networkFailure('POST', '/tickets/T-14/move');
    await boardApp(net);
    await drag('T-14', 'Backlog', 'Ready');
    await waitFor(() =>
      expect(toast()).toHaveTextContent('Couldn’t reach the server — try again.'),
    );
  });
});

describe('confirmations (UI-AC-58…60, AC-22, AC-45)', () => {
  it('release: shows the copy, keeps the ticket on «Keep it with the agent», sends confirmed on confirm', async () => {
    const { network, user } = await boardApp();
    await drag('T-12', 'In Progress', 'Ready');

    const dialog = await screen.findByRole('alertdialog', { name: 'Move T-12 to Ready?' });
    expect(
      within(dialog).getByText(
        'alpha is assigned to it. The agent stops working on T-12, gets a refusal with the reason on its next call, and becomes free for other work.',
      ),
    ).toBeInTheDocument();

    // Contract: keep-action closes the modal and changes nothing.
    await user.click(within(dialog).getByRole('button', { name: 'Keep it with the agent' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(network.calls('POST', '/tickets/T-12/move')).toHaveLength(0);

    await drag('T-12', 'In Progress', 'Ready');
    await user.click(await screen.findByRole('button', { name: 'Release ticket' }));
    await waitFor(() => expect(network.calls('POST', '/tickets/T-12/move')).toHaveLength(1));
    expect(network.calls('POST', '/tickets/T-12/move')[0]?.body).toEqual({
      to: 'ready',
      expectedStatus: 'in_progress',
      confirmed: true,
    });
    await waitFor(() =>
      expect(toast()).toHaveTextContent('T-12 moved to Ready — the agent is free again'),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('mark done: adds «The block is cleared.» only for a blocked ticket', async () => {
    const { network, user } = await boardApp();
    await drag('T-12', 'In Progress', 'Done');
    const plain = await screen.findByRole('alertdialog', { name: 'Mark T-12 done?' });
    expect(
      within(plain).getByText(
        'alpha is working on it. The agent stops, its session ends as Completed, and it becomes free for other work.',
      ),
    ).toBeInTheDocument();
    await user.click(within(plain).getByRole('button', { name: 'Keep it with the agent' }));

    await drag('T-8', 'In Progress', 'Done');
    const blocked = await screen.findByRole('alertdialog', { name: 'Mark T-8 done?' });
    expect(within(blocked).getByText(/ The block is cleared\.$/)).toBeInTheDocument();
    await user.click(within(blocked).getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(network.calls('POST', '/tickets/T-8/move')).toHaveLength(1));
    expect(network.calls('POST', '/tickets/T-8/move')[0]?.body).toEqual({
      to: 'done',
      expectedStatus: 'in_progress',
      confirmed: true,
    });
    await waitFor(() => expect(toast()).toHaveTextContent('T-8 moved to Done'));
  });

  it('reopen: Done -> Backlog asks, then sends confirmed and toasts', async () => {
    const { network, user } = await boardApp();
    await drag('T-1', 'Done', 'Backlog');
    const dialog = await screen.findByRole('alertdialog', { name: 'Reopen T-1 in Backlog?' });
    expect(
      within(dialog).getByText(
        'The ticket becomes unassigned work again. Its history and sessions stay.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Reopen ticket' }));
    await waitFor(() => expect(network.calls('POST', '/tickets/T-1/move')).toHaveLength(1));
    expect(network.calls('POST', '/tickets/T-1/move')[0]?.body).toEqual({
      to: 'backlog',
      expectedStatus: 'done',
      confirmed: true,
    });
    await waitFor(() => expect(toast()).toHaveTextContent('T-1 reopened in Backlog'));
  });

  it('keeps «Keep it in Done» as a no-op for a reopen', async () => {
    const { network, user } = await boardApp();
    await drag('T-1', 'Done', 'Ready');
    await user.click(await screen.findByRole('button', { name: 'Keep it in Done' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(network.calls('POST', '/tickets/T-1/move')).toHaveLength(0);
  });

  it('disables the confirm button while the command is in flight so it is sent once (UI-AC-22)', async () => {
    const net = networkWithCommands();
    net.pending('POST', '/tickets/T-12/move');
    const { user } = await boardApp(net);
    await drag('T-12', 'In Progress', 'Ready');
    const confirm = await screen.findByRole('button', { name: 'Release ticket' });
    await user.click(confirm);
    await waitFor(() => expect(confirm).toHaveAttribute('aria-disabled', 'true'));
    await user.click(confirm);
    expect(net.calls('POST', '/tickets/T-12/move')).toHaveLength(1);
  });
});

describe('Assign modal (UI-AC-54…57)', () => {
  it('lists free agents first, greys busy ones, and sends Assign for a free pick', async () => {
    const { network, user } = await boardApp();
    await drag('T-14', 'Backlog', 'In Progress');

    const dialog = await screen.findByRole('dialog', { name: 'Who takes T-14?' });
    expect(within(dialog).getByText('Empty state for Mission Control')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'An agent works on one ticket at a time, so busy agents are greyed out. The chosen agent moves to Planning and starts a session.',
      ),
    ).toBeInTheDocument();
    const rows = within(within(dialog).getByRole('list', { name: 'Agents' })).getAllByRole(
      'button',
    );
    // Contract: charlie (free) first, then five busy rows.
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveTextContent('charlie');
    expect(rows[0]).toHaveTextContent('■ FREE · ONLINE');
    expect(rows[0]).not.toHaveAttribute('aria-disabled');
    expect(rows[1]).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(dialog).getByRole('button', { name: /alpha.*BUSY · T-12 · IMPLEMENTING/ }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();

    // Contract: a busy row sends nothing.
    await user.click(rows[1] as HTMLElement);
    expect(network.calls('POST', '/tickets/T-14/assign')).toHaveLength(0);

    await user.click(rows[0] as HTMLElement);
    await waitFor(() => expect(network.calls('POST', '/tickets/T-14/assign')).toHaveLength(1));
    expect(network.calls('POST', '/tickets/T-14/assign')[0]?.body).toEqual({
      agentId: 'charlie',
      expectedStatus: 'backlog',
    });
    await waitFor(() =>
      expect(toast()).toHaveTextContent('T-14 is In Progress — charlie starts with Planning'),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Cancel without a request', async () => {
    const { network, user } = await boardApp();
    await drag('T-1', 'Done', 'In Progress');
    const dialog = await screen.findByRole('dialog', { name: 'Who takes T-1?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(network.calls('POST', '/tickets/T-1/assign')).toHaveLength(0);
  });

  it('shows the all-busy alert and no pickable row when every agent is busy (UI-AC-56)', async () => {
    const net = networkWithCommands();
    const busy: Agent[] = seedAgents().map((a) =>
      a.currentTicketId ? a : { ...a, currentTicketId: 'T-13' },
    );
    net.on('GET', '/agents', jsonResponse(AgentListResponse, busy, { asOfSeq: SEED_LAST_SEQ }));
    await boardApp(net);
    await drag('T-14', 'Backlog', 'In Progress');

    const dialog = await screen.findByRole('dialog', { name: 'Who takes T-14?' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Every agent is busy. Mark one of their tickets done or release it to Ready first.',
    );
    expect(within(dialog).getByRole('alert').textContent).not.toMatch(/review/i);
    within(dialog)
      .getAllByRole('button', { name: /BUSY/ })
      .forEach((b) => expect(b).toHaveAttribute('aria-disabled', 'true'));
  });

  it('updates rows live when an agent becomes free (UI-AC-57)', async () => {
    const net = networkWithCommands();
    const busy: Agent[] = seedAgents().map((a) =>
      a.currentTicketId ? a : { ...a, currentTicketId: 'T-13' },
    );
    net.on('GET', '/agents', jsonResponse(AgentListResponse, busy, { asOfSeq: SEED_LAST_SEQ }));
    const { queryClient } = await boardApp(net);
    await drag('T-14', 'Backlog', 'In Progress');
    const dialog = await screen.findByRole('dialog', { name: 'Who takes T-14?' });
    expect(within(dialog).getByRole('alert')).toBeInTheDocument();

    // Contract: charlie freed elsewhere -> alert disappears and the row becomes pickable.
    net.on(
      'GET',
      '/agents',
      jsonResponse(AgentListResponse, seedAgents(), { asOfSeq: SEED_LAST_SEQ }),
    );
    await queryClient.invalidateQueries();
    await waitFor(() => expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument());
    expect(within(dialog).getByRole('button', { name: /charlie.*FREE/ })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('shows the server refusal verbatim when the agent was taken meanwhile (UI-AC-20)', async () => {
    const net = networkWithCommands();
    net.on(
      'POST',
      '/tickets/T-14/assign',
      errorResponse(409, 'agent_busy', 'Agent busy.', {
        reason: 'charlie is busy with T-13 — one ticket per agent.',
      }),
    );
    const { user } = await boardApp(net);
    await drag('T-14', 'Backlog', 'In Progress');
    await user.click(await screen.findByRole('button', { name: /charlie.*FREE/ }));
    await waitFor(() =>
      expect(toast()).toHaveTextContent(
        'Can’t move T-14 to In Progress: charlie is busy with T-13 — one ticket per agent.',
      ),
    );
  });
});

describe('Request-changes modal (UI-AC-61, AC-34)', () => {
  it('shows the copy, refuses an empty comment, and sends the trimmed comment with expectedStatus', async () => {
    const { network, user } = await boardApp();
    await drag('T-7', 'Review', 'In Progress');

    const dialog = await screen.findByRole('dialog', { name: 'Send T-7 back to sim-2' });
    expect(
      within(dialog).getByText(
        'The ticket returns to In Progress for the same agent, who reads this comment first.',
      ),
    ).toBeInTheDocument();

    // Contract: an empty comment sends nothing and shows the required message.
    await user.click(within(dialog).getByRole('button', { name: 'Send back' }));
    expect(await within(dialog).findByText(MSG_COMMENT_REQUIRED)).toBeInTheDocument();
    expect(network.calls('POST', '/tickets/T-7/request-changes')).toHaveLength(0);

    await user.type(
      within(dialog).getByRole('textbox', { name: /What should change\?/ }),
      '  Add a retry test  ',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Send back' }));
    await waitFor(() =>
      expect(network.calls('POST', '/tickets/T-7/request-changes')).toHaveLength(1),
    );
    expect(network.calls('POST', '/tickets/T-7/request-changes')[0]?.body).toEqual({
      comment: 'Add a retry test',
      expectedStatus: 'review',
    });
    await waitFor(() => expect(toast()).toHaveTextContent('T-7 sent back to In Progress'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the modal open and the typed text when the server refuses', async () => {
    const net = networkWithCommands();
    net.on(
      'POST',
      '/tickets/T-7/request-changes',
      errorResponse(409, 'stale_state', 'T-7 is now in Done.'),
    );
    const { user } = await boardApp(net);
    await drag('T-7', 'Review', 'In Progress');
    const dialog = await screen.findByRole('dialog', { name: 'Send T-7 back to sim-2' });
    await user.type(
      within(dialog).getByRole('textbox', { name: /What should change\?/ }),
      'Please fix',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Send back' }));

    await waitFor(() =>
      expect(toast()).toHaveTextContent('Can’t move T-7 to In Progress: T-7 is now in Done.'),
    );
    expect(screen.getByRole('dialog', { name: 'Send T-7 back to sim-2' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /What should change\?/ })).toHaveValue('Please fix');
  });

  it('shows a 400 detail message under the field and keeps the text', async () => {
    const net = networkWithCommands();
    net.on(
      'POST',
      '/tickets/T-7/request-changes',
      errorResponse(400, 'validation_failed', 'Invalid request.', {
        details: [{ path: 'comment', message: 'Comment is too long (max 2000).' }],
      }),
    );
    const { user } = await boardApp(net);
    await drag('T-7', 'Review', 'In Progress');
    const field = await screen.findByRole('textbox', { name: /What should change\?/ });
    await user.type(field, 'x');
    await user.click(screen.getByRole('button', { name: 'Send back' }));
    expect(await screen.findByText('Comment is too long (max 2000).')).toBeInTheDocument();
    expect(field).toHaveValue('x');
  });
});

describe('modal for a ticket that changed meanwhile (UI-AC-53)', () => {
  it('closes the modal and toasts when the ticket changes status under it', async () => {
    const net = networkWithCommands();
    const { queryClient } = await boardApp(net);
    await drag('T-14', 'Backlog', 'In Progress');
    await screen.findByRole('dialog', { name: 'Who takes T-14?' });

    const moved = seedTickets().map((t) =>
      t.id === 'T-14' ? { ...t, status: 'ready' as const } : t,
    );
    net.on('GET', '/tickets', jsonResponse(TicketListResponse, moved, { asOfSeq: SEED_LAST_SEQ }));
    await queryClient.invalidateQueries();

    await waitFor(() =>
      expect(toast()).toHaveTextContent('T-14 changed in the meantime — check its new state.'),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('New ticket modal (UI-AC-88…90, AC-21, AC-34)', () => {
  async function openModal(net?: FakeNetwork) {
    const app = await boardApp(net);
    await app.user.click(screen.getByRole('button', { name: '+ New ticket' }));
    const dialog = await screen.findByRole('dialog', { name: 'New ticket' });
    return { ...app, dialog };
  }

  it('shows the next id, the fields, MEDIUM preselected and the actions (UI-AC-88)', async () => {
    const { dialog } = await openModal();
    expect(within(dialog).getByText('Goes to Backlog as T-17')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /^Title/ })).toHaveFocus();
    expect(within(dialog).getByRole('textbox', { name: 'Description' })).toBeInTheDocument();
    expect(
      within(dialog).getByRole('textbox', { name: 'Acceptance criteria' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('One criterion per line.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'MEDIUM' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getByRole('button', { name: 'HIGH' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create ticket' })).toBeInTheDocument();
  });

  it('refuses a whitespace title, flags it, and clears the error on typing (UI-AC-89)', async () => {
    const { dialog, user, network } = await openModal();
    const title = within(dialog).getByRole('textbox', { name: /^Title/ });
    await user.type(title, '   ');
    await user.click(within(dialog).getByRole('button', { name: 'Create ticket' }));

    // Contract: modal stays open, nothing sent, Title aria-invalid with «Title is required.» as an alert.
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(MSG_TITLE_REQUIRED);
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(network.calls('POST', '/tickets')).toHaveLength(0);
    await user.type(title, 'a');
    await waitFor(() => expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument());
  });

  it('submits trimmed title, one criterion per non-empty line and priority, then toasts and closes (UI-AC-90)', async () => {
    const { dialog, user, network } = await openModal();
    await user.type(within(dialog).getByRole('textbox', { name: /^Title/ }), '  Add dark mode  ');
    await user.type(within(dialog).getByRole('textbox', { name: 'Description' }), 'Because night');
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Acceptance criteria' }),
      'Toggle exists{Enter}{Enter}  Persists  ',
    );
    await user.click(within(dialog).getByRole('button', { name: 'HIGH' }));
    await user.click(within(dialog).getByRole('button', { name: 'Create ticket' }));

    await waitFor(() => expect(network.calls('POST', '/tickets')).toHaveLength(1));
    expect(network.calls('POST', '/tickets')[0]?.body).toEqual({
      title: 'Add dark mode',
      description: 'Because night',
      acceptanceCriteria: ['Toggle exists', 'Persists'],
      priority: 'high',
    });
    await waitFor(() =>
      expect(toast()).toHaveTextContent('T-17 created in Backlog — move it to Ready for agents'),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Contract: the form resets for the next opening.
    await user.click(screen.getByRole('button', { name: '+ New ticket' }));
    expect(await screen.findByRole('textbox', { name: /^Title/ })).toHaveValue('');
  });

  it('submits on Enter in Title (UI-AC-88)', async () => {
    const { dialog, user, network } = await openModal();
    await user.type(within(dialog).getByRole('textbox', { name: /^Title/ }), 'Quick one{Enter}');
    await waitFor(() => expect(network.calls('POST', '/tickets')).toHaveLength(1));
  });

  it('keeps typed text and says it could not reach the server on a network failure (UI-AC-21, AC-34)', async () => {
    const net = networkWithCommands();
    net.networkFailure('POST', '/tickets');
    const { dialog, user } = await openModal(net);
    await user.type(within(dialog).getByRole('textbox', { name: /^Title/ }), 'Keep me');
    await user.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
    await waitFor(() =>
      expect(toast()).toHaveTextContent('Couldn’t reach the server — try again.'),
    );
    expect(screen.getByRole('textbox', { name: /^Title/ })).toHaveValue('Keep me');
  });

  it('shows 400 detail messages under their fields and keeps the form (UI-AC-20)', async () => {
    const net = networkWithCommands();
    net.on(
      'POST',
      '/tickets',
      errorResponse(400, 'validation_failed', 'Invalid request.', {
        details: [{ path: 'title', message: 'Title is too long (max 200).' }],
      }),
    );
    const { dialog, user } = await openModal(net);
    await user.type(within(dialog).getByRole('textbox', { name: /^Title/ }), 'Whatever');
    await user.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
    expect(await within(dialog).findByText('Title is too long (max 200).')).toBeInTheDocument();
    expect(toast()).toHaveTextContent('check the highlighted fields');
  });

  it('never clears typed text when an incoming event updates the Board (UI-AC-34)', async () => {
    const net = networkWithCommands();
    const { dialog, user } = await openModal(net);
    FakeEventSource.emitHello({ lastSeq: SEED_LAST_SEQ });
    const title = within(dialog).getByRole('textbox', { name: /^Title/ });
    await user.type(title, 'Half-typed');

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

    // Contract: the Board behind the modal updates while the typed text survives.
    expect(
      await within(await column('Backlog')).findByText('Pushed by the stream'),
    ).toBeInTheDocument();
    expect(title).toHaveValue('Half-typed');
  });
});
