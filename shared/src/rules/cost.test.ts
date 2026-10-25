import { describe, expect, it } from 'vitest';
import { entryCostUsd, sumTokens } from './cost.js';

const price = { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3, cacheWritePerM: 3.75 };

describe('entryCostUsd', () => {
  it('1M input tokens at $3/M is exactly 3', () => {
    expect(entryCostUsd({ input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }, price)).toBe(
      3,
    );
  });
  it('sums all four components, unrounded', () => {
    expect(
      entryCostUsd({ input: 1000, output: 2000, cacheRead: 10, cacheWrite: 20 }, price),
    ).toBeCloseTo((3000 + 30000 + 3 + 75) / 1_000_000, 12);
  });
  it('zero tokens cost zero', () => {
    expect(entryCostUsd({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, price)).toBe(0);
  });
});

describe('sumTokens', () => {
  it('adds per field; empty list is zeros', () => {
    expect(sumTokens([])).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(
      sumTokens([
        { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
        { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
      ]),
    ).toEqual({ input: 11, output: 22, cacheRead: 33, cacheWrite: 44 });
  });
});
