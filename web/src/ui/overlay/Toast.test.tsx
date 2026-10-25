import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupUser } from '../../test/user';
import { TOAST_DURATION_MS, ToastRegion, useToast } from './Toast';

function Trigger({ messages }: { messages: string[] }) {
  const { showToast } = useToast();
  return (
    <>
      {messages.map((m) => (
        <button key={m} type="button" onClick={() => showToast(m)}>
          show {m}
        </button>
      ))}
    </>
  );
}

describe('ToastRegion (UI-AC-18)', () => {
  beforeEach(() => {
    // shouldAdvanceTime lets userEvent's internal delays resolve; toast expiry is advanced explicitly.
    vi.useFakeTimers({ now: new Date('2026-10-24T14:32:00Z'), shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = () => {
    const user = setupUser({ advanceTimers: (ms) => void vi.advanceTimersByTime(ms) });
    render(
      <ToastRegion>
        <Trigger messages={['first', 'second']} />
      </ToastRegion>,
    );
    return user;
  };

  it('announces a toast in a polite live region for 3.4 s, then removes it', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'show first' }));

    // Contract: the toast text is inside an aria-live="polite" status region.
    const toast = screen.getByText('first');
    expect(toast.closest('[aria-live="polite"]')).toBe(screen.getByRole('status'));
    expect(TOAST_DURATION_MS).toBe(3400);

    act(() => void vi.advanceTimersByTime(TOAST_DURATION_MS - 500));
    expect(screen.getByText('first')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.queryByText('first')).not.toBeInTheDocument();
  });

  it('a newer toast replaces the older one and restarts the 3.4 s timer', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'show first' }));
    act(() => void vi.advanceTimersByTime(2500));
    await user.click(screen.getByRole('button', { name: 'show second' }));

    // Contract: only the newest toast is shown.
    expect(screen.queryByText('first')).not.toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();

    // The first toast's timer would have fired by now (2500 + 1500 > 3400 ms): it must not dismiss the new toast.
    act(() => void vi.advanceTimersByTime(1500));
    expect(screen.getByText('second')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(TOAST_DURATION_MS));
    expect(screen.queryByText('second')).not.toBeInTheDocument();
  });
});
