import type { AgentScript } from '@agent-ops/shared';

/** Park–Miller "minimal standard" generator (prototype `rng`); the state lives in `AgentScript.prngState`. */
export const PM_MODULUS = 2147483647;
export const PM_MULTIPLIER = 16807;

/** Folds any integer seed into the valid state range 1 … modulus-1. */
export function normalizeSeed(seed: number): number {
  const s = Math.abs(Math.trunc(seed)) % PM_MODULUS;
  return s === 0 ? 1 : s;
}

/** One Park–Miller step. The product stays below 2^53, so plain numbers are exact. */
export function nextState(state: number): number {
  return (normalizeSeed(state) * PM_MULTIPLIER) % PM_MODULUS;
}

/** Maps a state to [0, 1) exactly like the prototype. */
export function toUnit(state: number): number {
  return (state - 1) / (PM_MODULUS - 1);
}

/** Draws a number in [0, 1) and returns the script with the advanced state. */
export function nextRandom(script: AgentScript): { value: number; script: AgentScript } {
  const state = nextState(script.prngState);
  return { value: toUnit(state), script: { ...script, prngState: state } };
}

/** Draws an integer in [0, bound) and returns the script with the advanced state. */
export function nextInt(
  script: AgentScript,
  bound: number,
): { value: number; script: AgentScript } {
  const drawn = nextRandom(script);
  return { value: Math.floor(drawn.value * bound), script: drawn.script };
}
