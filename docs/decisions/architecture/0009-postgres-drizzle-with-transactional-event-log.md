---
status: accepted
date: 2026-10-24
decision-makers: [Ivan Lapa]  # chosen by owner 2026-10-24, drafted by Claude
scope: ["server/src/infrastructure/db/**", "server/src/infrastructure/repositories/**", "server/drizzle/**", "server/drizzle.config.ts", "compose.yaml"]
supersedes: ["ADR-0003"]
superseded-by: []
---

# ADR-0009: Store state in PostgreSQL via Drizzle, with an append-only events table written in the same transaction

## Context and Problem Statement
ADR-0003 (proposed, never accepted) chose an event-sourced log in `node:sqlite` with in-memory
projections. The owner chose a different store on 2026-10-24: PostgreSQL, accessed through Drizzle ORM.

The forces are unchanged: the board and Mission Control must never disagree (NFR-02); tickets, agents
and history must survive a restart (NFR-03); a reconnecting client must catch up with exactly the events
it missed (NFR-04); Activity Feed and Event Log show the ordered history. Scale is small (10 agents,
100 tickets, 1 000-entry session logs — NFR-07). The product runs only on the Operator's machine (NFR-05).
The screens also need plain relational reads (tickets by status, sessions with their log entries,
model prices for cost), which a pure event-sourced store makes awkward.

## Considered Options
- PostgreSQL + Drizzle: normal tables for current state **plus** an append-only `events` table written in the same transaction as each state change
- PostgreSQL + Drizzle, pure event sourcing (only `events`, state rebuilt into projections)
- SQLite (`node:sqlite`), event-sourced (ADR-0003)

## Decision Outcome
Chosen option: "PostgreSQL + Drizzle, state tables plus a transactional `events` table", because state
tables give simple, indexed reads for every screen, while the `events` row committed atomically with each
change gives one ordered history that drives Activity Feed, Event Log and SSE resume (ADR-0004) — the
two can never diverge because they commit or roll back together.

Details:
- State tables (initial set): `tickets`, `agents`, `sessions`, `session_log_entries`, `model_prices`, plus the simulation state (clock, data epoch, id counters); the final set is defined by SPEC-database.
- `events(seq bigint generated always as identity primary key, at timestamptz /* Simulation Clock */, real_at timestamptz,
  source text, category text, type text, agent_id text null, ticket_id text null, session_id text null, payload jsonb, warn boolean)`
  — the columns of the shared `Event` contract (SPEC-server-api §C2/§C5); exact types, constraints and indexes are owned by `docs/specs/database.md`.
  `events` is append-only: no UPDATE or DELETE ever (the terminal reset command that reloads the fixture is the only exception: it replaces all data in one
  transaction, keeps `seq` increasing past every earlier value and records the new dataset's first `seq` as the
  journal floor, so a client resuming from older history is told to resync — SPEC-database AC-39, SPEC-server-api AC-61).
- Every application command runs in one transaction: change state rows → insert one or more `events` rows → commit → publish the committed events to the in-process SSE fan-out.
- `seq` must follow commit order, or a client resuming from `seq > N` could skip a row that commits late
  with a lower `seq`. Each command-transaction therefore takes `pg_advisory_xact_lock(<events lock key>)`
  before inserting into `events`, which serialises writers (fine at NFR-07 scale).
- Schema in `server/src/infrastructure/db/schema.ts`; migrations generated with `drizzle-kit generate`
  into `server/drizzle/` and applied with the Drizzle migrator on server start and in tests. No `drizzle-kit push` against a real database.
- Postgres runs locally via `compose.yaml` at the repo root, image pinned to a major version (`postgres:18-alpine`),
  data in a named volume. Connection string from `DATABASE_URL` in a git-ignored `.env`; `.env.example` documents it.

### Consequences
- Good, because each screen reads current state with ordinary queries; no projection rebuild on boot.
- Good, because state and history are atomic: a failed command leaves neither a state change nor an event.
- Good, because resume is `SELECT … FROM events WHERE seq > $1 ORDER BY seq`.
- Bad, because Docker (with docker compose) is now required on the Operator's machine; NFR-05 (local only) still holds.
- Bad, because the same fact lives in two places (state row and event payload); a command that forgets the event row breaks the feed silently — guarded by the rules below.
- Bad, because the advisory lock serialises all writes; revisit if write load ever grows far past NFR-07.
- Migration work: none in code (nothing was built on ADR-0003); ADR-0003 is marked superseded.

### Confirmation
- RULE: Only files under `server/src/infrastructure/` import `drizzle-orm`, `pg`/`postgres` or `server/src/infrastructure/db/schema`.
  CHECK: `grep -rlnE "from ['\"](drizzle-orm|pg|postgres)['\"/]|db/schema" server/src | grep -v "server/src/infrastructure/"`
- RULE: No code issues UPDATE or DELETE on `events`.
  CHECK: `grep -rnE "update\(events\)|delete\(events\)|UPDATE events|DELETE FROM events" server/src`
- RULE: Every application command that changes a state table inserts at least one `events` row in the same transaction (through the unit-of-work port), after taking the events advisory lock.
  CHECK: reviewer + `server/src/infrastructure/db/unit-of-work.int.test.ts` (rollback leaves no event; concurrent commands produce strictly increasing, commit-ordered `seq`; gaps from rolled-back transactions are allowed)
- RULE: Schema changes ship as a generated migration in `server/drizzle/` committed together with the `schema.ts` change.
  CHECK: `pnpm --filter @agent-ops/server exec drizzle-kit check` and reviewer
- RULE: `DATABASE_URL` is read only from the environment (config module); no connection string is committed.
  CHECK: `grep -rn "postgres://\|postgresql://" --include=*.ts server/src`
- RULE: `compose.yaml` pins the Postgres image to a major version tag, never `latest`.
  CHECK: `grep -n "image: postgres" compose.yaml`
