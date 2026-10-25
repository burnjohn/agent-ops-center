import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../app/providers';
import { SEED_CLOCK } from '../../test/fixtures';
import { createFakeNetwork, jsonResponse, type FakeNetwork } from '../../test/fakeNetwork';
import { HoldResponse } from '@agent-ops/shared';
import { HOLD_RENEW_MS, getClientId, useSimulationHold } from './useSimulationHold';

interface HoldBody {
  clientId: string;
  held: boolean;
}

describe('useSimulationHold (UI-AC-9)', () => {
  let net: FakeNetwork;

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-10-24T14:32:00Z') });
    net = createFakeNetwork();
    net.on(
      'POST',
      '/simulation/hold',
      jsonResponse(HoldResponse, { held: true, expiresAt: SEED_CLOCK }),
    );
    net.install();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>
  );

  const holds = () => net.calls('POST', '/simulation/hold').map((r) => r.body as HoldBody);

  it('holds on activation, renews at most every 10 s with a stable client id, releases on deactivation', async () => {
    const { rerender } = renderHook(({ active }) => useSimulationHold(active), {
      wrapper,
      initialProps: { active: false },
    });
    // Contract: nothing is sent while no modal is open / card dragged.
    await vi.advanceTimersByTimeAsync(HOLD_RENEW_MS * 2);
    expect(holds()).toHaveLength(0);

    rerender({ active: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(holds()).toEqual([{ clientId: getClientId(), held: true }]);

    // Contract: the server expires a hold 15 s after the last renewal, so a renewal must land within 10 s.
    await vi.advanceTimersByTimeAsync(HOLD_RENEW_MS);
    expect(holds()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(HOLD_RENEW_MS);
    expect(holds()).toHaveLength(3);
    expect(new Set(holds().map((h) => h.clientId)).size).toBe(1);
    expect(holds().every((h) => h.held)).toBe(true);

    rerender({ active: false });
    await vi.advanceTimersByTimeAsync(0);
    // Contract: the interaction ended, so the hold is released with the same client id.
    expect(holds().at(-1)).toEqual({ clientId: getClientId(), held: false });
    const countAfterRelease = holds().length;
    await vi.advanceTimersByTimeAsync(HOLD_RENEW_MS * 3);
    expect(holds()).toHaveLength(countAfterRelease); // no renewals after release
  });

  it('releases the hold when the owner unmounts (UI-AC-9)', async () => {
    const { unmount } = renderHook(() => useSimulationHold(true), { wrapper });
    await vi.advanceTimersByTimeAsync(0);
    expect(holds().map((h) => h.held)).toEqual([true]);

    unmount();
    await vi.advanceTimersByTimeAsync(0);
    // Contract: a closing screen never leaves the simulation held.
    expect(holds().map((h) => h.held)).toEqual([true, false]);
  });

  it('keeps the client id stable for the tab across hook instances (UI-AC-9)', () => {
    // Contract: "a client id stable for the tab" — two reads return the same value, persisted in sessionStorage.
    const first = getClientId();
    expect(getClientId()).toBe(first);
    expect(sessionStorage.getItem('aoc.simulation.clientId')).toBe(first);
  });
});
