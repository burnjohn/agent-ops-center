import {
  CommandResult,
  MSG_ANSWER_REQUIRED,
  MSG_COMMENT_REQUIRED,
  TicketDetailResponse,
  isFeedEvent,
  type Ticket,
} from '@agent-ops/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  createFakeNetwork,
  errorResponse,
  jsonResponse,
  ticketDetailResponse,
  type FakeNetwork,
} from '../../test/fakeNetwork';
import {
  SEED_CLOCK,
  SEED_LAST_SEQ,
  buildEvent,
  seedEvents,
  seedTickets,
} from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

const ok = () => jsonResponse(CommandResult, { seq: SEED_LAST_SEQ + 1 });

/** Fake network whose ticket detail applies `patch` to the seed ticket; sessions arrive newest first (API-AC-24). */
function ticketNet(
  id: string,
  patch: Partial<Ticket> = {},
  extra?: (net: FakeNetwork) => void,
): FakeNetwork {
  const net = createFakeNetwork();
  if (Object.keys(patch).length > 0)
    net.on('GET', `/tickets/${id}`, () => ticketDetailResponse(net, id, patch));
  net.on('POST', /^\/tickets\/[^/]+\/(move|answer|request-changes)$/, ok());
  extra?.(net);
  return net;
}

async function openTicket(
  id: string,
  patch: Partial<Ticket> = {},
  extra?: (net: FakeNetwork) => void,
) {
  const app = renderApp({ route: `/tickets/${id}`, network: ticketNet(id, patch, extra) });
  await screen.findByRole('heading', { name: 'A — Description' });
  return app;
}

describe('ticket header (UI-AC-62, AC-63)', () => {
  it('shows id, priority, numbered status badge and title; no JUST UPDATED for an old change', async () => {
    await openTicket('T-12');

    // Contract: badges `<id>`, `▮▮▮ HIGH`, `0N <STATUS>`, then the title.
    expect(
      screen.getByRole('heading', { level: 1, name: 'SSE reconnect with event replay' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('T-12').length).toBeGreaterThan(0);
    expect(screen.getByText(/03\s+IN PROGRESS/)).toBeInTheDocument();
    expect(screen.getByText(/HIGH/)).toBeInTheDocument();
    // Contract: updated 76 s before the sim clock -> not "just updated" (AC-33 window is 7 s).
    expect(screen.queryByText(/JUST UPDATED/)).not.toBeInTheDocument();
  });

  it('shows ■ JUST UPDATED when the change is within 7 s of the simulation clock', async () => {
    await openTicket('T-12', { updatedAt: '2026-10-24T14:31:55Z' });
    expect(SEED_CLOCK).toBe('2026-10-24T14:32:00Z');
    expect(await screen.findByText(/JUST UPDATED/)).toBeInTheDocument();
  });

  it('numbers acceptance criteria and shows the description', async () => {
    await openTicket('T-12');
    const section = screen
      .getByRole('heading', { name: 'B — Acceptance criteria · 3' })
      .closest('section')!;
    const items = within(section).getAllByRole('listitem');
    // Contract: criteria are a numbered list 01, 02, …
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('01');
    expect(items[2]).toHaveTextContent('03');
    expect(items[0]).toHaveTextContent('Reconnect sends Last-Event-ID');
    expect(screen.getByRole('heading', { name: 'A — Description' })).toBeInTheDocument();
  });

  it('shows the empty states for a ticket without criteria (T-15) and without description', async () => {
    await openTicket('T-15', { description: '' });
    // Contract: empty copy from the spec, verbatim.
    expect(screen.getByText('No acceptance criteria yet.')).toBeInTheDocument();
    expect(screen.getByText('No description.')).toBeInTheDocument();
  });
});

describe('unknown ticket id (not found)', () => {
  it('shows the not-found screen on a 404', async () => {
    renderApp({ route: '/tickets/T-999' });
    // Contract: a missing ticket renders an entity-not-found view, not the ticket page.
    expect(
      await screen.findByRole('heading', { name: "Ticket T-999 doesn't exist." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /D — Agent console/ })).not.toBeInTheDocument();
  });
});

describe('blocked panel (UI-AC-64, AC-65, AC-70)', () => {
  it('shows the question and sends a trimmed answer, clearing the field and toasting', async () => {
    const { user, network } = await openTicket('T-8');

    // Contract: attn panel with the agent's question in quotes and a required answer field.
    expect(
      await screen.findByRole('heading', { name: /Blocked — sim-1 needs your answer/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('blockquote')).toHaveTextContent(
      'Which priorities should the demo tickets cover?',
    );
    const field = screen.getByRole('textbox', { name: /Your answer/ });
    expect(field).toHaveAttribute('placeholder', 'The agent reads this on its next step');

    await user.type(field, '  All three  ');
    await user.click(screen.getByRole('button', { name: 'Send answer & unblock' }));

    // Contract: Answer & unblock is sent once with the trimmed text; field clears; toast confirms.
    await waitFor(() => expect(network.calls('POST', '/tickets/T-8/answer')).toHaveLength(1));
    expect(network.calls('POST', '/tickets/T-8/answer')[0]?.body).toEqual({ answer: 'All three' });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('T-8 unblocked — the agent continues'),
    );
    expect(field).toHaveValue('');
  });

  it('refuses a whitespace-only answer with an alert and sends nothing', async () => {
    const { user, network } = await openTicket('T-8');
    await user.type(await screen.findByRole('textbox', { name: /Your answer/ }), '   ');
    await user.click(screen.getByRole('button', { name: 'Send answer & unblock' }));

    // Contract: empty/whitespace answer sends nothing and shows the required message as role=alert.
    expect(await screen.findByRole('alert')).toHaveTextContent(MSG_ANSWER_REQUIRED);
    expect(MSG_ANSWER_REQUIRED).toBe('Write an answer before unblocking.');
    expect(network.calls('POST', '/tickets/T-8/answer')).toHaveLength(0);
  });

  it('shows the Operator answer note and the review comment on an In Progress ticket (AC-70)', async () => {
    await openTicket('T-9', { answer: 'Cover all three', reviewComment: 'Add a11y test' });
    // Contract: both notes appear with their labels.
    expect(await screen.findByText(/Returned from review ·/)).toBeInTheDocument();
    expect(screen.getByText('Add a11y test')).toBeInTheDocument();
    expect(screen.getByText(/You answered ·/)).toBeInTheDocument();
    expect(screen.getByText('Cover all three')).toBeInTheDocument();
  });
});

describe('review panel (UI-AC-66…69)', () => {
  it('shows summary, result line and both actions for T-7', async () => {
    await openTicket('T-7');
    // Contract: «Ready for review · Submitted by <agent>», summary, RESULT line, Approve + Request changes.
    expect(
      await screen.findByRole('heading', { name: /Ready for review · Submitted by sim-2/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('RESULT')).toBeInTheDocument();
    expect(screen.getByText('PR #41 · feat/health-thresholds · +214 −38')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Request changes/ })).toBeInTheDocument();
  });

  it('falls back to «No summary provided.» and hides RESULT when absent', async () => {
    await openTicket('T-7', { reviewSummary: null, resultLink: null });
    expect(await screen.findByText('No summary provided.')).toBeInTheDocument();
    expect(screen.queryByText('RESULT')).not.toBeInTheDocument();
  });

  it('approves: sends the move to done with the shown status and toasts', async () => {
    const { user, network } = await openTicket('T-7');
    await user.click(await screen.findByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(network.calls('POST', '/tickets/T-7/move')).toHaveLength(1));
    // Contract: Approve = move review -> done, expectedStatus is the shown status.
    expect(network.calls('POST', '/tickets/T-7/move')[0]?.body).toEqual({
      to: 'done',
      expectedStatus: 'review',
    });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('T-7 approved — moved to Done'),
    );
  });

  it('request changes swaps the actions for the inline form, Cancel restores them', async () => {
    const { user } = await openTicket('T-7');
    await user.click(await screen.findByRole('button', { name: /Request changes/ }));

    // Contract: inline required field, note and Send back / Cancel replace the actions.
    const field = screen.getByRole('textbox', { name: /Comment for sim-2/ });
    expect(field).toHaveAttribute('placeholder', 'What should change before this can be approved?');
    expect(
      screen.getByText(
        'The ticket returns to In Progress for the same agent, who reads this comment on its next step.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send back to sim-2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
  });

  it('refuses an empty comment, then sends a trimmed one and toasts', async () => {
    const { user, network } = await openTicket('T-7');
    await user.click(await screen.findByRole('button', { name: /Request changes/ }));
    await user.click(screen.getByRole('button', { name: 'Send back to sim-2' }));

    // Contract: empty comment sends nothing and alerts with the spec message.
    expect(await screen.findByRole('alert')).toHaveTextContent(MSG_COMMENT_REQUIRED);
    expect(MSG_COMMENT_REQUIRED).toBe('A comment is required — tell the agent what to change.');
    expect(network.calls('POST', '/tickets/T-7/request-changes')).toHaveLength(0);

    await user.type(screen.getByRole('textbox', { name: /Comment for sim-2/ }), ' Add tests ');
    await user.click(screen.getByRole('button', { name: 'Send back to sim-2' }));
    await waitFor(() =>
      expect(network.calls('POST', '/tickets/T-7/request-changes')).toHaveLength(1),
    );
    expect(network.calls('POST', '/tickets/T-7/request-changes')[0]?.body).toEqual({
      comment: 'Add tests',
      expectedStatus: 'review',
    });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('T-7 sent back to In Progress'),
    );
  });
});

describe('move panel (UI-AC-71, AC-72)', () => {
  it('lists one button per other column with the In Progress ellipsis rule', async () => {
    await openTicket('T-12');
    const section = screen.getByRole('heading', { name: 'C — Move' }).closest('section')!;
    const names = within(section)
      .getAllByRole('button')
      .map((b) => b.textContent);
    // Contract: one button per other column; «In Progress…» only when not from Review.
    expect(names).toEqual(['Move to Backlog', 'Move to Ready', 'Move to Review', 'Move to Done']);
    expect(
      screen.getByText(
        'In Progress asks which agent takes the ticket. Work leaves an agent only by releasing it to Ready, with confirmation. Only the agent submits for review.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Any column works/)).not.toBeInTheDocument();
  });

  it('uses «Move to In Progress» without ellipsis from Review', async () => {
    await openTicket('T-7');
    const section = (await screen.findByRole('heading', { name: 'C — Move' })).closest('section')!;
    expect(
      within(section).getByRole('button', { name: 'Move to In Progress' }),
    ).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: /…/ })).not.toBeInTheDocument();
  });

  it('keeps a refused button focusable, aria-disabled, describes its reason and sends nothing', async () => {
    const { user, network } = await openTicket('T-12');
    const review = within(
      screen.getByRole('heading', { name: 'C — Move' }).closest('section')!,
    ).getByRole('button', {
      name: 'Move to Review',
    });

    // Contract: refused = aria-disabled (not native disabled), reason is the accessible description.
    expect(review).toHaveAttribute('aria-disabled', 'true');
    expect(review).not.toBeDisabled();
    expect(review).toHaveAccessibleDescription('Only the agent submits work for review');

    await user.tab();
    review.focus();
    expect(review).toHaveFocus();
    await user.click(review);
    expect(network.calls('POST', '/tickets/T-12/move')).toHaveLength(0);
  });

  it('sends a plain move for an allowed button (Backlog -> Ready)', async () => {
    const { user, network } = await openTicket('T-14');
    await user.click(await screen.findByRole('button', { name: 'Move to Ready' }));
    await waitFor(() => expect(network.calls('POST', '/tickets/T-14/move')).toHaveLength(1));
    expect(network.calls('POST', '/tickets/T-14/move')[0]?.body).toEqual({
      to: 'ready',
      expectedStatus: 'backlog',
    });
  });
});

describe('Who is on it (UI-AC-73, AC-74)', () => {
  it('shows the assignee with links, health, stepper labels, current action and the live session link', async () => {
    await openTicket('T-12');
    const who = screen.getByRole('heading', { name: 'Who is on it' }).closest('section')!;

    // Contract: agent id links to the agent page; stepper labels; Running session -> primary current log link.
    expect(within(who).getByRole('link', { name: 'alpha' })).toHaveAttribute(
      'href',
      '/agents/alpha',
    );
    for (const label of ['PLAN', 'IMPL', 'TEST', 'REVIEW']) {
      expect(within(who).getByText(label)).toBeInTheDocument();
    }
    expect(within(who).getByRole('link', { name: /Open current session log/ })).toHaveAttribute(
      'href',
      '/sessions/S-0412',
    );
    expect(within(who).getByRole('link', { name: 'Agent page →' })).toHaveAttribute(
      'href',
      '/agents/alpha',
    );
  });

  it('shows «Open last session log» and «Finished here» for a done ticket (T-1)', async () => {
    await openTicket('T-1');
    const who = screen.getByRole('heading', { name: 'Who is on it' }).closest('section')!;
    // Contract: no Running session -> last session link; agent not on this ticket and ticket Done -> «Finished here».
    expect(await within(who).findByText('Finished here')).toBeInTheDocument();
    expect(within(who).getByRole('link', { name: /Open last session log/ })).toBeInTheDocument();
    expect(
      within(who).queryByRole('link', { name: /Open current session log/ }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['T-14', 'Nobody yet. Move it to Ready so an agent can pick it up.'],
    ['T-10', 'Waiting for the next free agent — agents take Ready tickets by priority, then age.'],
  ])('shows the unassigned copy for %s', async (id, copy) => {
    await openTicket(id);
    expect(await screen.findByText(copy)).toBeInTheDocument();
  });

  it('shows «Finished.» for an unassigned Done ticket (reopened ticket)', async () => {
    await openTicket('T-14', { status: 'done' });
    expect(await screen.findByText('Finished.')).toBeInTheDocument();
  });
});

describe('Sessions & cost (UI-AC-75)', () => {
  it('lists newest session first with a MOCK tag, links and the total', async () => {
    await openTicket('T-12');
    const box = screen.getByRole('heading', { name: 'Sessions & cost' }).closest('section')!;

    // Contract: MOCK tag, rows `<id> · <agent> · <status> · <cost>` newest first, linking to the Session Log.
    expect(within(box).getByText('MOCK')).toBeInTheDocument();
    const rows = within(box).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/^S-0412 · alpha · .*RUNNING.* · \$\d+\.\d\d$/);
    expect(rows[1]).toHaveTextContent(/^S-0409 · alpha · .*DONE.* · \$\d+\.\d\d$/);
    expect(within(box).getByRole('link', { name: 'S-0412' })).toHaveAttribute(
      'href',
      '/sessions/S-0412',
    );
  });

  it('shows the empty copy when no session touched the ticket (T-14)', async () => {
    await openTicket('T-14');
    expect(
      await screen.findByText('No agent session has touched this ticket yet.'),
    ).toBeInTheDocument();
  });
});

describe('Activity (UI-AC-76)', () => {
  it('shows the legend and the ticket events oldest first with accessible source names', async () => {
    await openTicket('T-7');
    const box = screen.getByRole('heading', { name: 'Activity' }).closest('section')!;
    expect(within(box).getByText('● OPERATOR ■ REPORT ◆ TELEMETRY')).toBeInTheDocument();

    const expected = seedEvents().filter((e) => e.ticketId === 'T-7' && isFeedEvent(e));
    const rows = within(box).getAllByRole('listitem');
    // Contract: chronological order (oldest of the shown events on top), one row per event.
    expect(rows).toHaveLength(expected.length);
    const summary = (e: (typeof expected)[number]) => (e.payload as { summary: string }).summary;
    expect(rows[0]).toHaveTextContent(summary(expected[0]!));
    expect(rows.at(-1)).toHaveTextContent(summary(expected.at(-1)!));
    // Contract: the source mark exposes its source name as accessible label.
    expect(within(rows[0]!).getByRole('img')).toHaveAccessibleName(
      /Operator|Agent Report|Agent Telemetry|System/,
    );
  });

  it('renders event text as plain text, never as markup', async () => {
    const net = ticketNet('T-14');
    net.on('GET', '/tickets/T-14', () => {
      const ticket = seedTickets().find((t) => t.id === 'T-14')!;
      const e = buildEvent(
        50,
        'ticket.moved',
        { summary: '<b>bold</b> <img src=x onerror=alert(1)>', from: 'backlog', to: 'ready' },
        { ticketId: 'T-14' },
      );
      return jsonResponse(
        TicketDetailResponse,
        { ticket, activity: [e], sessions: [], dataSource: 'mock' },
        { asOfSeq: SEED_LAST_SEQ },
      );
    });
    renderApp({ route: '/tickets/T-14', network: net });
    // Contract: user text is rendered literally.
    expect(await screen.findByText('<b>bold</b> <img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.getElementsByTagName('img')).toHaveLength(0);
  });
});

describe('load failures', () => {
  it('offers a retry when the ticket cannot be loaded', async () => {
    const net = ticketNet('T-12');
    net.on('GET', '/tickets/T-12', errorResponse(500, 'internal', 'boom'));
    renderApp({ route: '/tickets/T-12', network: net });
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
