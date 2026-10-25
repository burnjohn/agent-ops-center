import { describe, expect, it } from 'vitest';
import { deriveHealth } from './health.js';

const now = Date.parse('2026-10-24T14:32:00Z');
const seen = (secAgo: number) => now - secAgo * 1000;

describe('deriveHealth', () => {
  it.each([
    [0, 'online'],
    [29, 'online'],
    [30, 'stale'],
    [119, 'stale'],
    [120, 'offline'],
  ] as const)('gap %is -> %s', (gap, health) => {
    expect(deriveHealth({ lastSeenAt: seen(gap), currentTool: null }, now)).toBe(health);
  });

  it.each([
    [599, 'online'],
    [600, 'offline'],
  ] as const)('running tool %is with old last-seen -> %s', (age, health) => {
    expect(
      deriveHealth({ lastSeenAt: seen(1000), currentTool: { startedAt: seen(age) } }, now),
    ).toBe(health);
  });

  it('accepts ISO strings', () => {
    expect(
      deriveHealth(
        { lastSeenAt: '2026-10-24T14:31:00Z', currentTool: null },
        '2026-10-24T14:32:00Z',
      ),
    ).toBe('stale');
  });

  it('honours custom thresholds', () => {
    const th = { staleAfterSec: 5, offlineAfterSec: 10, runningToolSec: 1 };
    expect(deriveHealth({ lastSeenAt: seen(7), currentTool: null }, now, th)).toBe('stale');
  });
});
