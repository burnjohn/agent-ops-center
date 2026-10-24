---
status: proposed
date: 2026-10-24
decision-makers: [Ivan Lapa]  # chosen by owner 2026-10-24, drafted by Claude
scope: ["server/src/application/simulation/**", "server/src/presentation/http/simulation/**", "web/src/features/simulation/**"]
supersedes: []
superseded-by: []
---

# ADR-0008: Run simulated agents inside the server through the same command layer, advancing on demand

## Context and Problem Statement
In the MVP every agent is simulated: the MCP server and telemetry hook are deferred (ADR-0006, ADR-0007).
Simulated agents must behave like real ones (SIM-01), reproduce failure cases — blocked ticket, failed
tool call, unresponsive agent, report that disagrees with telemetry (SIM-02) — be reproducible (SIM-03),
and later coexist with real agents on one board (SIM-05).

The owner wants the Operator in control of pacing: a demo or a test must be able to stop at any moment
and look at the state, instead of watching agents race ahead on a timer.

## Considered Options
- Server-side simulator over the application command layer, seeded PRNG + scripted scenarios, advanced on demand by Operator commands (`Next step`, `Run to next stage`), optional auto-play off by default
- The same simulator driven by a background timer that runs continuously
- A separate process that spawns fake API (later MCP) clients

## Decision Outcome
Chosen option: "Server-side simulator over the command layer, advanced on demand", because it exercises
the exact same rules and writes the same events as real agents will, a seed + scenario + the sequence of
Operator step commands fully determines the outcome, and the Operator decides when anything happens.

Behaviour:
- Each simulated agent has a scenario and a seed. It does nothing until the Operator triggers it.
- Time is a persisted **Simulation Clock** that moves only with steps (6 s per step, SIM-10); health, "ago", `UPDATED` and Events/min are computed against it, never against wall-clock time.
- `Next step` (per agent) advances the clock once and performs exactly one agent action (finish a tool, report stage, tool call, update, block, submit, …).
- `Run to next stage` (per agent) repeats `Next step` — each step its own transaction — until the agent's stage changes, it waits for the Operator, it runs out of work, or 40 steps.
- Auto-play (`Play`) is a server-wide toggle, **off by default** and off after every restart or reset; when on, a server-side timer performs one simulation-wide step (clock +6 s, every agent acts once) every 1.6 s, skipped while a client holds the simulation (open dialog / drag). A single simulation-wide `Step` is also available while paused.
- Agents that are Online and responsive get a heartbeat on every clock advance (PDR-0011); a fixture agent can be marked unresponsive to reproduce silence (SIM-02).
- The agent's `Kind` (`Real`/`Simulated`) comes from the fixture and is display-only; every agent is simulated in the MVP (PDR-0008).
- Behaviour, scripts and contracts: `docs/specs/server-api.md` (SPEC-server-api).

### Consequences
- Good, because the same scenario + seed + step sequence yields the same event sequence (modulo timestamps).
- Good, because tests drive the simulator step by step with no timers or sleeps.
- Good, because real agents added in the next iteration go through the same commands; nothing in the simulator is special-cased in the domain.
- Bad, because simulation shares the server process; auto-play with many agents adds load to the API.
- Bad, because the Simulation Clock diverges from wall-clock time: "14:32" on screen is simulation time,
  and health thresholds (PDR-0011) only mean something in simulated seconds. Resolved in SPEC-server-api
  (SIM-10): nothing ages while nobody steps.

### Confirmation
- RULE: The simulator changes state only by calling application commands (use cases); it never imports repositories, the Drizzle client or writes to `events`.
  CHECK: `grep -rnE "drizzle|infrastructure/|insert\(|\.execute\(" server/src/application/simulation`
- RULE: All randomness in `server/src/application/simulation/` comes from the seeded PRNG.
  CHECK: `grep -rn "Math.random\|crypto.random" server/src/application/simulation`
- RULE: The simulator reads time only through the injected Simulation `Clock` port, never `Date.now()` / `new Date()`.
  CHECK: `grep -rn "Date.now\|new Date(" server/src/application/simulation`
- RULE: Simulated agents advance only through the `step` / `runToNextStage` commands (HTTP `POST`) or the auto-play timer, and auto-play defaults to off.
  CHECK: `server/src/application/simulation/simulation.test.ts` (no events are produced and the clock does not move without a step; auto-play flag is false after boot)
- RULE: Replaying a scenario with the same seed and the same step sequence produces the same event types and payloads in the same order.
  CHECK: `server/src/application/simulation/determinism.test.ts`
