import { CommandResult, SimulationState, StepResult } from '@agent-ops/shared';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeEventSource } from '../../test/FakeEventSource';
import { SEED_LAST_SEQ, buildEvent, buildSimulation } from '../../test/fixtures';
import { createFakeNetwork, jsonResponse } from '../../test/fakeNetwork';
import { renderApp } from '../../test/renderApp';

// A light route keeps the header (and its Simulation panel) the only thing under test.
const ROUTE = '/nope';

/** A network whose Simulation read already reports auto-play on (the server is the source of truth). */
function playingNetwork() {
  return createFakeNetwork().on(
    'GET',
    '/simulation',
    jsonResponse(SimulationState, buildSimulation({ playing: true }), { asOfSeq: SEED_LAST_SEQ }),
  );
}

async function findPanel() {
  return screen.findByRole('group', { name: 'Simulation' });
}

describe('Simulation panel (UI-AC-6…8)', () => {
  it('shows label, paused toggle, STEP and the server clock as hh:mm:ss (UI-AC-6)', async () => {
    renderApp({ route: ROUTE });
    const panel = await findPanel();

    // Contract: auto-play is shown as paused unless the server says it is playing.
    const toggle = await within(panel).findByRole('button', { name: '▶ PLAY' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(within(panel).getByRole('button', { name: 'STEP' })).toBeInTheDocument();
    expect(within(panel).getByText('Simulation')).toBeInTheDocument();
    // Contract: the clock is the Simulation Clock in UTC hh:mm:ss, not the browser clock.
    expect(await within(panel).findByText(/^\d{2}:\d{2}:\d{2}$/)).not.toHaveTextContent('--:--:--');
  });

  it('PLAY sends the command and flips only when the play_changed event arrives (UI-AC-7)', async () => {
    const net = createFakeNetwork();
    net.on('POST', '/simulation/play', jsonResponse(CommandResult, { seq: SEED_LAST_SEQ + 1 }));
    const { user } = renderApp({ route: ROUTE, network: net });
    FakeEventSource.emitHello({ lastSeq: SEED_LAST_SEQ });
    const panel = await findPanel();

    await user.click(await within(panel).findByRole('button', { name: '▶ PLAY' }));

    // Contract: the Play command is sent exactly once ...
    expect(net.calls('POST', '/simulation/play')).toHaveLength(1);
    // ... but the panel must NOT change optimistically from the HTTP response alone.
    expect(within(panel).getByRole('button', { name: '▶ PLAY' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    FakeEventSource.emitEvent(
      buildEvent(SEED_LAST_SEQ + 1, 'simulation.play_changed', {
        summary: 'Play on',
        playing: true,
      }),
    );
    // Contract: the panel follows the event: PAUSE label, pressed, STEP refused with its reason.
    const pause = await within(panel).findByRole('button', { name: 'Ⅱ PAUSE' });
    expect(pause).toHaveAttribute('aria-pressed', 'true');
    const step = within(panel).getByRole('button', { name: 'STEP' });
    expect(step).toHaveAttribute('aria-disabled', 'true');
    expect(step).toHaveAccessibleDescription('Pause to step manually'); // UI-AC-8
  });

  it('PAUSE and STEP send their commands; the clock advances only from the event (UI-AC-7)', async () => {
    const net = playingNetwork();
    net.on('POST', '/simulation/pause', jsonResponse(CommandResult, { seq: SEED_LAST_SEQ + 1 }));
    net.on(
      'POST',
      '/simulation/step',
      jsonResponse(StepResult, { seq: SEED_LAST_SEQ + 2, steps: 1 }),
    );
    const { user } = renderApp({ route: ROUTE, network: net });
    FakeEventSource.emitHello({ lastSeq: SEED_LAST_SEQ, playing: true });
    const panel = await findPanel();

    await user.click(await within(panel).findByRole('button', { name: 'Ⅱ PAUSE' }));
    expect(net.calls('POST', '/simulation/pause')).toHaveLength(1);
    // Contract: still shown as playing until the server's event says otherwise.
    expect(within(panel).getByRole('button', { name: 'Ⅱ PAUSE' })).toBeInTheDocument();

    FakeEventSource.emitEvent(
      buildEvent(SEED_LAST_SEQ + 1, 'simulation.play_changed', {
        summary: 'Play off',
        playing: false,
      }),
    );
    await within(panel).findByRole('button', { name: '▶ PLAY' });

    const before = within(panel).getByText(/^\d{2}:\d{2}:\d{2}$/).textContent;
    await user.click(within(panel).getByRole('button', { name: 'STEP' }));
    expect(net.calls('POST', '/simulation/step')).toHaveLength(1);
    // Contract: the clock does not move from the HTTP response; it moves when `simulation.stepped` arrives.
    expect(within(panel).getByText(/^\d{2}:\d{2}:\d{2}$/).textContent).toBe(before);

    FakeEventSource.emitEvent(
      buildEvent(SEED_LAST_SEQ + 2, 'simulation.stepped', {
        summary: 'Step',
        mode: 'step_all',
        clock: '2026-10-24T14:33:06Z',
        actedAgentIds: [],
      }),
    );
    expect(await within(panel).findByText('14:33:06')).toBeInTheDocument();
  });

  it('refuses STEP while playing without sending a request (UI-AC-8)', async () => {
    const net = playingNetwork();
    const { user } = renderApp({ route: ROUTE, network: net });
    FakeEventSource.emitHello({ lastSeq: SEED_LAST_SEQ, playing: true });
    const panel = await findPanel();
    const step = await within(panel).findByRole('button', { name: 'STEP' });

    await user.click(step);

    // Contract: an aria-disabled button is focusable but never fires its command.
    expect(step).toHaveAttribute('aria-disabled', 'true');
    expect(net.calls('POST', '/simulation/step')).toHaveLength(0);
  });
});
