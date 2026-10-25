---
status: superseded
date: 2026-10-24
decision-makers: []  # drafted by Claude 2026-10-24; superseded by ADR-0009 after owner chose the stack 2026-10-24
scope: ["server/src/**", "shared/src/**"]
supersedes: []
superseded-by: ["ADR-0009"]
---

# ADR-0003: Store every change as an event in SQLite and derive state from it

## Context and Problem Statement
The spec says all activity is an event in a shared history and the current state of tickets and agents
is a consequence of that history; both screens must never disagree (NFR-02) and state must survive a
restart (NFR-03). Scale is small: 10 agents, 100 tickets (NFR-07).

## Considered Options
- Append-only `events` table in SQLite (built-in `node:sqlite`), state rebuilt into memory projections on boot and updated per event
- Mutable `tickets` / `agents` tables plus a separate activity log
- PostgreSQL in Docker

## Decision Outcome
Chosen option: "Append-only events in SQLite with in-memory projections", because one ordered log gives
both screens the same sequence of facts, makes the Activity Feed and Event Log free, and needs no
external service or native build on a local machine.

### Consequences
- Good, because a client that knows the last event id can catch up exactly (NFR-04).
- Good, because simulation replays are deterministic over the same reducer.
- Bad, because `node:sqlite` is still experimental in Node 22 and prints a warning (suppressed in scripts).
- Bad, because every state change must go through the command layer; direct writes are forbidden.

### Confirmation
- RULE: Only `server/src/store/` executes SQL; it only INSERTs into and SELECTs from `events`.
  CHECK: `grep -rn "prepare(" server/src | grep -v store/`
- RULE: Ticket and agent state change only by applying an event through the reducer in `server/src/domain/`.
  CHECK: reviewer + domain unit tests
