import { describe, expect, it } from 'vitest';
import {
  formatAge,
  formatClock,
  formatDay,
  formatDuration,
  formatMoney,
  formatStart,
  formatTimer,
  formatTokens,
} from './format';

const NOW = '2026-10-24T14:32:00Z';

describe('format', () => {
  it('formats the clock in UTC', () => {
    expect(formatClock(NOW)).toBe('14:32:00');
  });
  it('decides Today / Mon D from the UTC date of the clock', () => {
    expect(formatDay('2026-10-24T00:00:01Z', NOW)).toBe('Today');
    expect(formatDay('2026-10-04T10:00:00Z', NOW)).toBe('Oct 4');
    expect(formatStart('2026-09-25T09:05:00Z', NOW)).toBe('Sep 25 09:05');
    expect(formatStart('2026-10-24T09:05:00Z', NOW)).toBe('Today 09:05');
  });
  it('formats money and tokens', () => {
    expect(formatMoney(1.234)).toBe('$1.23');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(12_345)).toBe('12.3K');
    expect(formatTokens(2_345_000)).toBe('2.35M');
  });
  it('formats ages relative to the passed clock', () => {
    expect(formatAge('2026-10-24T14:31:48Z', NOW)).toBe('12S');
    expect(formatAge('2026-10-24T14:28:00Z', NOW)).toBe('4M');
    expect(formatAge('2026-10-24T12:30:00Z', NOW)).toBe('2H');
    expect(formatAge('2026-10-24T14:28:00Z', NOW, false)).toBe('4m');
  });
  it('formats durations and timers', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(240)).toBe('4m');
    expect(formatDuration(3900)).toBe('1h 05m');
    expect(formatTimer(65)).toBe('1:05');
  });
});
