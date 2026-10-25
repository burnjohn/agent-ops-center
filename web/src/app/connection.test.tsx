import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WATCHDOG_MS } from '../api/stream';
import { FakeEventSource } from '../test/FakeEventSource';
import { SEED_LAST_SEQ } from '../test/fixtures';
import { renderApp } from '../test/renderApp';
import { setupUser } from '../test/user';
import { ACTIONS_PAUSED_REASON } from './ActionGate';

const BANNER = 'Connection lost — reconnecting…';

/** Lets pending promises and zero-delay timers (query notifications) run under fake timers. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(10));
const elapse = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

async function boardLive() {
  const app = renderApp({
    route: '/board',
    user: setupUser({ advanceTimers: (ms) => void vi.advanceTimersByTime(ms) }),
  });
  await screen.findByRole('region', { name: /backlog/i });
  FakeEventSource.emitHello({ lastSeq: SEED_LAST_SEQ });
  await settle();
  return app;
}

beforeEach(() => {
  // shouldAdvanceTime keeps findBy*/waitFor polling alive; the 30 s watchdog is still advanced explicitly.
  vi.useFakeTimers({ now: new Date('2026-10-24T14:32:00Z'), shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('connection-lost banner (UI-AC-29)', () => {
  it('shows no banner while the stream is alive, even across keepalives', async () => {
    await boardLive();
    // Contract: a healthy stream shows nothing.
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
  });

  it('appears when the stream reports an error', async () => {
    await boardLive();
    FakeEventSource.fail();
    await settle();

    // Contract: role="status", exact copy, shown immediately (well within 2 s).
    expect(screen.getByText(BANNER)).toHaveAttribute('role', 'status');
  });

  it('appears after 30 s without any message, and every message (even keepalive) restarts that wait', async () => {
    await boardLive();
    expect(WATCHDOG_MS).toBe(30_000);

    await elapse(WATCHDOG_MS - 1_000);
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();

    // Contract: keepalive counts as a message.
    FakeEventSource.emitKeepalive();
    await elapse(WATCHDOG_MS - 1_000);
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();

    await elapse(1_000 + 2_000);
    expect(screen.getByText(BANNER)).toHaveAttribute('role', 'status');
  });

  it('goes away when the stream reconnects and catches up', async () => {
    await boardLive();
    FakeEventSource.fail();
    await settle();
    expect(screen.getByText(BANNER)).toBeInTheDocument();

    // Contract: the app retries on its own; a new hello makes the connection live again.
    await elapse(2_500);
    expect(FakeEventSource.instances.length).toBeGreaterThan(1);
    expect(FakeEventSource.current.url).toContain(`since=${SEED_LAST_SEQ}`);
    FakeEventSource.emitHello({ lastSeq: SEED_LAST_SEQ });
    await settle();
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
  });
});

describe('actions while the banner is shown (UI-AC-30)', () => {
  it('refuses data-changing controls with the reason, keeps navigation, theme and filters working', async () => {
    const { user } = await boardLive();
    const newTicket = screen.getByRole('button', { name: '+ New ticket' });
    expect(newTicket).not.toHaveAttribute('aria-disabled');

    FakeEventSource.fail();
    await settle();

    // Contract: aria-disabled (still focusable) with the pause reason exposed as its description.
    expect(newTicket).toHaveAttribute('aria-disabled', 'true');
    expect(newTicket).toHaveAccessibleDescription(ACTIONS_PAUSED_REASON);
    expect(ACTIONS_PAUSED_REASON).toBe('Reconnecting — actions are paused');
    await user.click(newTicket);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Contract: navigation, theme and filters keep working on the data already shown.
    await user.click(screen.getByRole('button', { name: /toggle dark mode$/ }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await user.selectOptions(screen.getByLabelText('Agent'), 'alpha');
    expect(screen.getByLabelText('Agent')).toHaveValue('alpha');
    await user.click(screen.getByRole('link', { name: /^02 Mission Control/ }));
    // The route change is async (lazy chunk): wait for it instead of a fixed settle.
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /^02 Mission Control/ })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
    expect(screen.getByText(BANNER)).toBeInTheDocument();
  });

  it('re-enables the controls when the connection is back', async () => {
    await boardLive();
    FakeEventSource.fail();
    await settle();
    const newTicket = screen.getByRole('button', { name: '+ New ticket' });
    expect(newTicket).toHaveAttribute('aria-disabled', 'true');

    await elapse(2_500);
    FakeEventSource.emitHello({ lastSeq: SEED_LAST_SEQ });
    await settle();
    expect(newTicket).not.toHaveAttribute('aria-disabled');
  });

  // Spec UI-AC-30 lists play / pause / step-all among the controls that must be disabled "with the
  // reason". AppHeader wraps the panel in <fieldset disabled>, which gives the buttons the native
  // `disabled` state: no aria-disabled, no description (only a `title` on the fieldset).
  // Suspected source bug: web/src/app/AppHeader.tsx:75-77 (fieldset) / features/simulation/SimulationPanel.tsx:28-41
  // (buttons do not use useGatedReason / disabledReason).
  it('the Simulation panel buttons are refused with the pause reason, like every other control', async () => {
    await boardLive();
    FakeEventSource.fail();
    await settle();

    const panel = screen.getByRole('group', { name: 'Simulation' });
    for (const name of ['▶ PLAY', 'STEP']) {
      const button = within(panel).getByRole('button', { name });
      // Contract: aria-disabled + reason as description (same treatment as U-9 disabled-with-reason).
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription(ACTIONS_PAUSED_REASON);
    }
  });

  it('the Simulation panel buttons cannot be pressed while the stream is lost (behaviour of the native fieldset)', async () => {
    const { user, network } = await boardLive();
    FakeEventSource.fail();
    await settle();

    const panel = screen.getByRole('group', { name: 'Simulation' });
    await user.click(within(panel).getByRole('button', { name: '▶ PLAY' }));
    await user.click(within(panel).getByRole('button', { name: 'STEP' }));

    // Contract: no data-changing command leaves the browser while actions are paused.
    expect(network.calls('POST', '/simulation/play')).toHaveLength(0);
    expect(network.calls('POST', '/simulation/step')).toHaveLength(0);
  });
});
