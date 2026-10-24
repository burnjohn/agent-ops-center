---
status: proposed
date: 2026-10-24
decision-makers: []  # drafted by Claude 2026-10-24, awaiting review
scope: ["server/src/simulation/**"]
supersedes: []
superseded-by: []
---

# ADR-0008: Run simulated agents inside the server through the same command layer

## Context and Problem Statement
Simulated agents must behave like real ones (SIM-01), reproduce failure cases (SIM-02), be reproducible
(SIM-03) and coexist with real agents (SIM-05).

## Considered Options
- Server-side simulator driving the same commands as the MCP server, with a seeded PRNG and scripted scenarios
- Separate process that spawns fake MCP clients

## Decision Outcome
Chosen option: "Server-side simulator over the command layer", because it exercises the exact same rules
and events, and a seed + scenario fully determines the sequence of decisions.

### Consequences
- Good, because the same scenario with the same seed yields the same event sequence (modulo timestamps).
- Bad, because simulation shares the server process; a busy simulation adds load to the API.

### Confirmation
- RULE: The simulator changes state only by calling the domain commands, never by appending events directly.
  CHECK: `grep -rn "appendEvent\|store\." server/src/simulation`
- RULE: All randomness in `server/src/simulation/` comes from the seeded PRNG.
  CHECK: `grep -rn "Math.random" server/src/simulation`
