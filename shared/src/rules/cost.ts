import type { ModelPrice, TokenUsage } from '../resources.js';

export type TokenPrice = Pick<
  ModelPrice,
  'inputPerM' | 'outputPerM' | 'cacheReadPerM' | 'cacheWritePerM'
>;

/** API-AC-32: USD cost of one entry, unrounded. */
export function entryCostUsd(tokens: TokenUsage, price: TokenPrice): number {
  return (
    (tokens.input * price.inputPerM +
      tokens.output * price.outputPerM +
      tokens.cacheRead * price.cacheReadPerM +
      tokens.cacheWrite * price.cacheWritePerM) /
    1_000_000
  );
}

export function sumTokens(items: readonly TokenUsage[]): TokenUsage {
  const total: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const t of items) {
    total.input += t.input;
    total.output += t.output;
    total.cacheRead += t.cacheRead;
    total.cacheWrite += t.cacheWrite;
  }
  return total;
}
