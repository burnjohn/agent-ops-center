import { TicketListResponse } from '@agent-ops/shared';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEED_LAST_SEQ, buildTicket, seedTickets } from '../test/fixtures';
import { createFakeNetwork, jsonResponse } from '../test/fakeNetwork';
import { renderApp } from '../test/renderApp';
import { THEME_STORAGE_KEY } from './theme';

const PRIMARY = () => screen.getByRole('navigation', { name: 'Primary' });

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset['theme'];
});

describe('header on every route (UI-AC-1)', () => {
  it.each([
    ['/board'],
    ['/mission-control'],
    ['/usage'],
    ['/tickets/T-12'],
    ['/agents/alpha'],
    ['/nope'],
  ])(
    'shows brand, primary nav, MOCK tag, simulation, theme toggle and the local label on %s',
    async (route) => {
      renderApp({ route });

      // Contract: the same header frames every route.
      const brand = await screen.findByRole('link', { name: /AGENT OPS/ });
      expect(brand).toHaveAttribute('href', '/board');
      const nav = PRIMARY();
      expect(within(nav).getByRole('link', { name: /^01 Board/ })).toHaveAttribute(
        'href',
        '/board',
      );
      expect(within(nav).getByRole('link', { name: /^02 Mission Control/ })).toHaveAttribute(
        'href',
        '/mission-control',
      );
      const usage = within(nav).getByRole('link', { name: /^03 Usage & Cost/ });
      expect(usage).toHaveAttribute('href', '/usage');
      expect(within(usage).getByText('MOCK')).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Simulation' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /toggle dark mode$/ })).toBeInTheDocument();
      expect(screen.getByText('LOCAL · NO AUTH')).toBeInTheDocument();
    },
  );
});

describe('active nav item (UI-AC-2)', () => {
  it.each([
    ['/board', /^01 Board/],
    ['/tickets/T-12', /^01 Board/],
    ['/mission-control', /^02 Mission Control/],
    ['/agents/alpha', /^02 Mission Control/],
    ['/sessions/S-0412', /^02 Mission Control/],
    ['/usage', /^03 Usage & Cost/],
  ])('%s marks exactly one nav item with aria-current="page"', async (route, expected) => {
    renderApp({ route });
    await screen.findByRole('link', { name: /AGENT OPS/ });

    // Contract: ticket pages count as Board; agent and session pages count as Mission Control.
    const current = within(PRIMARY())
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(expected);
  });

  it('marks no nav item on an unknown path', async () => {
    renderApp({ route: '/nope' });
    await screen.findByRole('link', { name: /AGENT OPS/ });
    // Contract: a path that belongs to no screen highlights nothing.
    for (const link of within(PRIMARY()).getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current');
    }
  });
});

describe('blocked badge (UI-AC-3)', () => {
  it('shows "N BLOCKED" on 01 Board counting only In Progress tickets that are blocked', async () => {
    const net = createFakeNetwork();
    const tickets = [
      buildTicket({ id: 'T-1', number: 1, status: 'in_progress', blockedQuestion: 'Which one?' }),
      buildTicket({ id: 'T-2', number: 2, status: 'in_progress', blockedQuestion: 'And this?' }),
      buildTicket({ id: 'T-3', number: 3, status: 'in_progress', blockedQuestion: null }),
      buildTicket({ id: 'T-4', number: 4, status: 'ready', blockedQuestion: null }),
    ];
    net.on(
      'GET',
      '/tickets',
      jsonResponse(TicketListResponse, tickets, { asOfSeq: SEED_LAST_SEQ }),
    );
    renderApp({ route: '/nope', network: net });

    // Contract: N equals the number of tickets that are In Progress and Blocked.
    const board = await within(PRIMARY()).findByRole('link', { name: /01 Board.*2 BLOCKED/ });
    expect(board).toBeInTheDocument();
  });

  it('shows no badge when nothing is blocked', async () => {
    const net = createFakeNetwork();
    const clear = seedTickets().map((t) => ({ ...t, blockedQuestion: null }));
    net.on('GET', '/tickets', jsonResponse(TicketListResponse, clear, { asOfSeq: SEED_LAST_SEQ }));
    renderApp({ route: '/nope', network: net });
    await screen.findByRole('link', { name: /AGENT OPS/ });

    // Contract: the badge exists only WHILE at least one ticket is blocked.
    await vi.waitFor(() => expect(net.calls('GET', '/tickets')).toHaveLength(1));
    expect(screen.queryByText(/BLOCKED/)).not.toBeInTheDocument();
  });
});

describe('theme toggle (UI-AC-5, UI-AC-136)', () => {
  it('reads "◐ DARK" in light, "☀ LIGHT" in dark, and flips data-theme', async () => {
    const { user } = renderApp({ route: '/nope' });
    const toggle = await screen.findByRole('button', { name: /toggle dark mode$/ });

    // Contract: light theme offers to go dark; the accessible name starts with the visible label.
    expect(toggle).toHaveTextContent('◐ DARK');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');

    await user.click(toggle);
    expect(toggle).toHaveTextContent('☀ LIGHT');
    expect(toggle).toHaveAccessibleName('☀ LIGHT — toggle dark mode');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');

    await user.click(toggle);
    expect(toggle).toHaveTextContent('◐ DARK');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });

  it('follows the OS preference until toggled, then keeps the Operator choice across reloads', async () => {
    const osDark = () =>
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('dark'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
    osDark();
    const first = renderApp({ route: '/nope' });
    const toggle = await screen.findByRole('button', { name: /toggle dark mode$/ });

    // Contract: no stored choice -> the OS preference (dark) applies.
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(toggle).toHaveTextContent('☀ LIGHT');

    await first.user.click(toggle);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    // "Reload": remount the whole app; the stored choice beats the OS preference.
    first.unmount();
    renderApp({ route: '/nope' });
    expect(await screen.findByRole('button', { name: /toggle dark mode$/ })).toHaveTextContent(
      '◐ DARK',
    );
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });
});
