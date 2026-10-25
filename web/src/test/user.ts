import userEvent from '@testing-library/user-event';

/** `userEvent.setup()` — call before `render`. Pass `advanceTimers: vi.advanceTimersByTime` under fake timers. */
export const setupUser = userEvent.setup;
export type TestUser = ReturnType<typeof userEvent.setup>;
