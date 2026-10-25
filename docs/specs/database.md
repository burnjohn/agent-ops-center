---
status: approved               # draft | approved | implemented | superseded
date: 2026-10-24
owner: Ivan Lapa
plan: docs/plans/mvp.md
---

# Spec: Database — schema, event journal, fixture and reset

Spec ID: `SPEC-database` · Supersedes: none · Product source of truth: [`abstract-project-spec.md`](abstract-project-spec.md)
Sibling layer specs (written in parallel): `SPEC-server-api` ([`server-api.md`](server-api.md)), `SPEC-web-ui` ([`web-ui.md`](web-ui.md)).

## Problem

The MVP (simulation only, PDR-0008) needs one durable store that the server, the simulator and every
screen agree on. The Board and Mission Control must never disagree (NFR-02), everything must survive a
restart (NFR-03), a reconnecting browser must receive exactly the events it missed (NFR-04), and Usage &
Cost / Session Log must show a fixed, reproducible mock dataset (MOCK-02…MOCK-04) that the prototype
already defines down to the token. ADR-0009 (accepted) chose PostgreSQL + Drizzle with state tables
plus an append-only `events` journal written in the same transaction. This spec pins down **what** that
store holds, which invariants it enforces, how the fixture maps into it, and how it is reset — so the
server and UI specs can rely on it without re-deciding the data layer.

## Goals

- One relational schema for every domain entity of the abstract spec: Ticket, Agent, Session,
  LogEntry, ModelPrice, Event, plus Simulation state.
- Data invariants the product rules depend on, enforced by the database itself (not only by code):
  one active ticket per agent, one running session per agent, id formats, append-only journal.
- An `events` journal whose `seq` follows commit order and drives Activity Feed, Event Log and SSE resume.
- A deterministic seed fixture that reproduces the prototype's mock data and the MOCK-02 facts exactly.
- Persistence across restarts and a reset-to-seed command.
- Indexes sized for the reads the screens make (Usage & Cost aggregations, Event Log / Activity
  pagination, Session Log reading) at NFR-07 scale.

## Non-goals

- HTTP endpoints, request/response shapes, SSE framing, error format — `SPEC-server-api`.
- Domain rules of commands (which transitions are allowed, refusal copy), health computation, cost
  computation, simulator behaviour and scenario format — `SPEC-server-api`. This spec only stores their
  inputs and outputs and backs some rules with constraints.
- Screens, copy, UI state — `SPEC-web-ui`.
- Live capture of tokens or transcripts from real agents (PDR-0007), MCP and telemetry ingest (PDR-0008).
- Multi-user, auth, remote hosting, backups, replication (NFR-05: local only).
- Data retention / pruning: nothing is deleted automatically in the MVP (see AC-41).
- A UI for reset or for adding/removing agents (owner decision: fixed 6 agents; reset is a server CLI).
- Down-migrations / rollback scripts: migrations are forward-only.

## Constraints

- **PDR-0001** Record product decisions as PDRs (accepted) — specs follow PDRs; this spec does not contradict any.
- **PDR-0004** No WIP limit (accepted 2026-10-24) — the schema has no limit on `in_progress` tickets; only "one active ticket per agent".
- **PDR-0006** Operator can release an In Progress ticket (accepted 2026-10-24) — a released ticket has no assignee; the agent keeps a pending-refusal marker (simulation state) until its next step (SIM-11).
- **PDR-0007** Usage & Cost and Session Log on mock data (accepted 2026-10-24) — sessions, log entries and model prices come from the fixture plus the simulator; no live capture tables.
- **PDR-0008** MVP runs on simulated agents only (accepted 2026-10-24) — `agents.kind` is stored for display only; no MCP/telemetry ingest tables.
- **PDR-0009** Operator assigns and moves tickets within guards (accepted 2026-10-24) — assignment is an Operator event, an agent self-claim is an `agent_report` event; one ticket per agent.
- **PDR-0010** Offline agents stay in the grid (accepted 2026-10-24) — no "archived/collapsed" agent state is stored.
- **PDR-0011** Health thresholds with capped tool grace and heartbeat (accepted 2026-10-24) — health is **derived**, never stored; the store keeps `last_seen_at`, current tool and its start time, all in simulation time.
- **ADR-0009** PostgreSQL + Drizzle with a transactional, append-only `events` table (accepted 2026-10-24, supersedes ADR-0003) — state tables + `events` in the same transaction, commit-ordered `seq` (advisory lock), drizzle-kit generated migrations applied on start and in tests, Postgres via `compose.yaml` pinned to a major version, `DATABASE_URL` from env only.
- **ADR-0008** Simulation through the command layer (accepted 2026-10-24) — the simulator writes only through application commands, so every simulated change also goes through the same-transaction rule; auto-play is off after every boot.
- **ADR-0010** Onion architecture (accepted 2026-10-24) — only the infrastructure layer touches the database; this spec's column names (snake_case) map to contract fields (camelCase) in `shared/`.
- **ADR-0002** TypeScript pnpm monorepo (accepted 2026-10-24) — the database belongs to the `server/` module.
- **ADR-0012** Testing strategy (being drafted in parallel; cited by number) — integration tests run against a real PostgreSQL, never a mock or another engine; every AC below marked _(integration)_ is verified that way.

## User stories

- **US-1** As an Operator, I want everything I and the agents did to still be there after I restart the product, so that I never lose the board or history. (NFR-03)
- **US-2** As an Operator, I want the Board, Mission Control and every open tab to show the same state and to catch up after a lost connection, so that I can trust what I see. (NFR-02, NFR-04, BRD-05)
- **US-3** As an Operator, I want the product to open on the same demo dataset every time it starts clean, so that a demo or a test always looks the same. (SIM-04, MOCK-02, MOCK-04)
- **US-4** As an Operator, I want to put the demo back to its starting state with one command, so that I can repeat a demo. (owner decision: reset CLI)
- **US-5** As an Operator, I want the cost of a session to equal the sum of its steps everywhere it is shown, so that the numbers add up. (MOCK-03, LOG-04, CST-08)
- **US-6** As a developer or agent implementing the server, I want the database to reject impossible states (two active tickets for one agent, an edited event), so that a bug cannot silently corrupt the board. (NFR-02, SIM-09)

## Acceptance criteria (EARS)

Traceability: each AC lists the abstract-spec / decision IDs it serves. _(integration)_ = verified by an
integration test against a real PostgreSQL (ADR-0012).

### Schema and migrations

- **AC-1** When the server starts, the system shall apply every pending migration before it accepts any request or runs any command. (NFR-03, ADR-0009) _(observable: start against an empty database → all tables of Contracts §1 exist before the first request is served; integration)_
- **AC-2** If applying a migration fails, then the system shall not start and shall report the name of the failing migration, leaving the database at the last successfully applied migration. (ADR-0009) _(observable: a deliberately broken migration → non-zero exit, message names it, earlier migrations remain applied)_
- **AC-3** When migrations are applied to a database that is already up to date, the system shall change nothing. _(observable: second start on the same database → identical schema and row counts; integration)_
- **AC-4** The system shall define every schema change only as a generated, committed, forward-only migration, such that applying all migrations to an empty database yields exactly the declared schema. (ADR-0009) _(observable: drift check reports no difference in CI)_
- **AC-5** If `DATABASE_URL` is missing, or the database is unreachable at start, then the system shall exit with a message that names the problem and the host:port it tried, without printing the password. (ADR-0009, NFR-05) _(observable: run with no env / stopped container → non-zero exit, message contains host:port and no credentials)_ Server-side behaviour: SPEC-server-api AC-73.

### Seed fixture

- **AC-6** When the server starts and, after migrations, the `agents` table is empty, the system shall load the seed fixture (Contracts §4) in a single transaction. (SIM-04, MOCK-02) _(observable: fresh database → after start, fixture counts of AC-8…AC-12 hold; integration)_
- **AC-7** While the `agents` table holds at least one row, the system shall not load the fixture automatically on start. (NFR-03) _(observable: start, create a ticket, restart → the ticket is still there, nothing duplicated)_
- **AC-8** When the fixture is loaded, the system shall contain exactly 6 agents (`alpha`, `bravo`, `charlie` with kind `real`; `sim-1`, `sim-2`, `sim-3` with kind `simulated`) and 16 tickets `T-1`…`T-16` with statuses T-1…T-5 `done`, T-6/T-7 `review`, T-8/T-9/T-12 `in_progress` (T-8 blocked), T-10/T-11/T-13 `ready`, T-14…T-16 `backlog`. (MOCK-02, SIM-04) _(observable: count queries; integration)_
- **AC-9** When the fixture is loaded, the system shall contain 3 model prices exactly as in Contracts §4.3 and 121 sessions — 114 historical (`S-0001`…`S-0114`, days 1…29 before the fixture day) and 7 on the fixture day (`S-0401`, `S-0409`, `S-0410`, `S-0412`…`S-0415`) — of which 4 are `running` (`S-0412`…`S-0415`), 9 `failed`, 19 have no ticket, 10 contain at least one failed tool call; the longest session has 23 log entries; exactly one session (`S-0409`) has a tool output longer than 4 lines. (MOCK-02) _(observable: aggregate queries return these numbers; integration)_
- **AC-10** When the fixture is loaded, the system shall contain 1 918 log entries, of which 1 670 carry tokens, with fixture-wide token totals input 10 753 797, output 1 844 687, cache read 179 299 980, cache write 8 523 948, and a fixture-wide cost of $305.19 (rounded to cents) at the fixture prices. (MOCK-02, MOCK-03, CST-08) _(observable: golden-total query equals these values; integration)_
- **AC-11** When the fixture is loaded, the system shall contain the 44 fixture events (Contracts §4.5) with `seq` strictly increasing in the prototype's order, and the simulation clock set to `2026-10-24T14:32:00Z`. (MOCK-02, SIM-10) _(observable: event count and order; clock value)_
- **AC-12** When the fixture is loaded, the system shall set the next ticket number to 17 and the next session number to 416, so that the next created ticket is `T-17` and the next started session is `S-0416`. (BRD-02, MOCK-04) _(observable: create a ticket and start a session after load → `T-17`, `S-0416`)_
- **AC-13** When the fixture is loaded twice into two empty databases, the system shall produce identical rows in every table except `events.real_at`, the absolute `events.seq` values, `simulation_state.journal_floor_seq` and `simulation_state.seeded_at`. (MOCK-04, SIM-03) _(observable: dump-and-diff of two loads, ignoring those columns)_
- **AC-14** The system shall store token counts only on log entries and derive every session's (and any aggregate's) token totals and cost from those entries, so that a session's total always equals the sum of its entries. (MOCK-03, LOG-04, CST-08) _(observable: no token or cost column exists on `sessions`; for every fixture session the derived total equals the sum of its entries)_

### Integrity constraints

- **AC-15** If a row would be written to `tickets` with an id not matching `T-<n>` (n ≥ 1, no leading zeros) or with `number` ≠ n, then the database shall reject it. (Domain model: Ticket ID) _(observable: insert `T-01` / `X-3` → constraint error; integration)_
- **AC-16** If a row would be written to `sessions` with an id not matching `S-` followed by at least 4 digits (zero-padded to 4) or with `number` ≠ that integer, then the database shall reject it. (Domain model: Session ID) _(observable: insert `S-12` → constraint error; `S-0416`, `S-10000` accepted)_
- **AC-17** If a write would leave one agent as the assignee of more than one ticket in `in_progress` or `review`, or would give one agent more than one current ticket, then the database shall reject it. (SIM-09, BRD-11, PDR-0009) _(observable: two concurrent assigns of the same agent → exactly one commits; integration)_
- **AC-18** If a write would leave one agent with more than one `running` session, then the database shall reject it. (LOG-10) _(observable: second running session for `alpha` → constraint error)_
- **AC-19** The database shall reject a session whose `status` is `running` with a non-null `ended_at`, a `completed`/`failed` session with a null `ended_at`, or an `ended_at` earlier than `started_at`. (LOG-10, CST-09) _(observable: constraint errors on each combination)_
- **AC-20** If a ticket's title is empty or whitespace-only, then the database shall reject the row. (BRD-02) _(observable: insert title `"   "` → constraint error)_
- **AC-21** The database shall reject a log entry whose four token counts are not either all present or all absent, any negative token count, tokens on an `operator` or `stage` entry, or a token-bearing entry without a token activity. (LOG-04, Domain model: Log Entry) _(observable: constraint errors on each case)_
- **AC-22** The database shall accept for every enumerated column (ticket status and priority, agent kind and stage, session status, log entry kind, token activity, event source and category) only the values listed in Contracts §1, which equal the enums of SPEC-server-api Contracts §C1 — in particular event `category` ∈ `ticket` · `agent` · `tool` (no other category; `simulation.*` events use `agent`, SPEC-server-api §C5). (Domain model) _(observable: insert an unknown value, e.g. category `simulation` → constraint error)_
- **AC-23** When a ticket or session is created, the system shall take its number from a persistent counter incremented in the same transaction, so that numbers are never reused and committed numbers have no gaps. (BRD-02 "Goes to Backlog as T-N") _(observable: a rolled-back create followed by a committed create → the committed ticket gets the number the preview showed; integration)_
- **AC-24** The database shall reject deleting an agent, ticket, session or model price that any other row references. _(observable: delete `alpha` → constraint error)_

### Event journal

- **AC-25** If any statement attempts to UPDATE or DELETE a row of `events`, then the database shall reject it. (ADR-0009, NFR-03) _(observable: raw `UPDATE events …` / `DELETE FROM events …` → error; integration)_
- **AC-26** When a command changes any state table, the system shall insert at least one `events` row in the same transaction, and if the transaction rolls back, neither the state change nor the event shall remain. (ADR-0009, NFR-02) _(observable: forced failure after the state write → no state change and no event; integration)_
- **AC-27** When several commands commit concurrently, the system shall assign `seq` values that strictly increase in commit order, so that a reader that has seen `seq ≤ N` never later finds a newly committed row with `seq ≤ N`. Gaps in `seq` from rolled-back transactions are allowed. (NFR-04, ADR-0009) _(observable: N parallel commands → ordering by `seq` equals ordering by commit; integration)_
- **AC-28** When a reader asks for events after `seq` N, the system shall return every committed event with `seq > N` in ascending `seq` order, with no omissions and no duplicates. (NFR-04, BRD-10) _(observable: write 100 events, resume from the 40th → exactly the last 60 in order)_ Used by the SSE resume of SPEC-server-api AC-60.
- **AC-29** When a reader takes a snapshot of current state, the system shall return it together with the highest `seq` that snapshot already includes, read in one consistent transaction. (NFR-02, NFR-04) _(observable: snapshot during concurrent writes → resuming from its `seq` yields exactly the changes missing from the snapshot)_ Exposed as the `X-As-Of-Seq` header on every read (SPEC-server-api AC-71), as `lastSeq` in `SimulationState` / stream `hello` (§C2, §C8, AC-58) and as `seq` in `CommandResult`.
- **AC-30** The system shall publish an event to live subscribers only after the transaction that wrote it has committed. (ADR-0009) _(observable: a rolled-back command produces no SSE message)_ Delivery: SPEC-server-api AC-58, AC-59.
- **AC-31** The database shall reject an event whose `agent_id`, `ticket_id` or `session_id` references a row that does not exist, or whose `type` does not match `<word>.<word>` in lowercase snake_case; every type of the SPEC-server-api event catalogue (§C5) shall be accepted without a migration. _(observable: constraint errors on a dangling reference or `Ticket.Moved`; one row of each §C5 type inserts cleanly; integration)_
- **AC-32** The system shall store every event's simulation time (`at`) and wall-clock time (`real_at`) separately, and all time-based product rules (health, "ago", `UPDATED`, `Events / min`) shall be computable from simulation time alone. (SIM-10, MC-05) _(observable: `at` follows the simulation clock, not the wall clock, in a stepped test)_

### Reads the screens need

- **AC-33** When the Event Log asks for a page, the system shall return the 40 newest events by `seq` (optionally filtered by source and/or category) and continue from the last returned `seq` for `Show 40 more`, without skipping or repeating rows while new events arrive. (MC-06) _(observable: keyset pagination over a growing journal; integration)_
- **AC-34** When a ticket's Activity or an agent's history is read, the system shall return that ticket's 30 newest events or that agent's 16 newest events by `seq` using an index on the reference column. (BRD-06, MC-08) _(observable: query plan uses the index; results ordered by `seq` desc)_
- **AC-35** When a session log is read, the system shall return its entries ordered by their per-session ordinal (not by time), so that entries with equal or out-of-order timestamps keep the order in which they were written. (LOG-03, CON-01) _(observable: two entries with the same `at` keep write order)_ The ordinal is the 0-based `LogEntry.index` of SPEC-server-api §C2.
- **AC-36** When Usage & Cost data are read for a period, the system shall select sessions by the UTC day of `started_at` within the period on the simulation clock and aggregate their entries' tokens by agent, ticket (including "no ticket"), model and token activity. (CST-01…CST-05) _(observable: fixture, `today` → 7 sessions, 4 running; per-dimension sums equal the fixture totals of AC-10 restricted to the period)_ Period semantics and the cost formula are SPEC-server-api AC-35 and AC-32; this spec only guarantees exact `numeric` prices and integer tokens as their inputs.

### Persistence, reset, retention

- **AC-37** When the server process or the database container is restarted (without deleting the data volume), the system shall keep every row of every table, the simulation clock and both id counters unchanged. (NFR-03) _(observable: snapshot before and after restart are equal)_
- **AC-38** The system shall not persist the auto-play flag, so that simulation is paused after every start. (SIM-07, ADR-0008) _(observable: start auto-play, restart → paused)_
- **AC-39** When the Operator runs the reset-to-seed command, the system shall replace all data in every table with the seed fixture in one transaction, keep `seq` increasing past every previously issued value, and record the first `seq` of the new dataset as the journal floor. (owner decision: reset CLI, MOCK-04, SPEC-server-api AC-65) _(observable: after reset, AC-8…AC-12 hold, every new `seq` > every old `seq`, floor = first fixture `seq`)_
- **AC-40** If the reset command runs while a server is connected to the same database, or fails part-way, then the system shall leave the database unchanged and say why (for a running server: "Stop the server first"). (SPEC-server-api AC-66) _(observable: reset with server running → non-zero exit, data unchanged)_
- **AC-41** The system shall never delete events, sessions or log entries except through the reset command. (NFR-03) _(observable: no delete path outside reset; reviewer)_
- **AC-42** If a client resumes from a `seq` lower than the journal floor, the system shall be able to detect it from the stored floor alone, so that the client is told to reload instead of receiving a partial history. (NFR-04) _(observable: resume from a pre-reset `seq` → "resync" condition detected)_ Signal: SPEC-server-api AC-61 / §C8 `resync` with reason `below_floor` (also `ahead`, `too_far_behind`).

## Edge cases

- Two Operator tabs assign the same free agent to different tickets at the same moment → one commit wins, the other hits AC-17 and is refused. → AC-17, AC-27 (refusal: SPEC-server-api AC-20, `agent_busy`)
- Operator creates a ticket and the transaction fails → no ticket, no event, counter not advanced; the next create gets the previewed number. → AC-23, AC-26
- Two commands commit in the opposite order to the one in which they started → `seq` follows commit order. → AC-27
- Browser resumes after a reset with an old `Last-Event-ID` → resync, not a partial replay. → AC-42
- Browser resumes with a `Last-Event-ID` higher than the current max `seq` (server restarted with an older DB) → empty replay; treated like AC-42 (resync). → AC-42
- Log entries with identical timestamps (tool entry logged at finish with its start time, prototype `finishTool`) → order by ordinal. → AC-35
- Session with no entries carrying tokens (e.g. just started) → totals 0, cost $0.00, not null. → AC-14
- Running session counted in Usage & Cost → included with its tokens so far. → AC-14, AC-36 (labelling: SPEC-web-ui, CST-09)
- Agent goes Offline with a running session → server ends it `failed` with `ended_at`; constraint AC-19 holds. → AC-19 (rule: SPEC-server-api AC-41; submit ends the session `completed`: AC-50; LOG-10)
- Released ticket whose agent is Offline → ticket has no assignee; pending refusal stays stored until the agent's next step, possibly forever. → AC-17 (accepted: the marker may stay indefinitely)
- `Done → In Progress` for a ticket that has a review comment from the previous cycle → the comment column is cleared; the old comment survives in the event payload. → AC-26 (rule: BRD-11)
- Released or reopened ticket → `assignee_id` null; the agent's "tickets worked on" list is derived from sessions and events, not from the assignee column. → AC-34
- Very long tool output (> 1 MB) → stored as is; no database cap (accepted: NFR-07 scale; see Open questions).
- Ticket text, agent text or tool output containing SQL, HTML or markup → stored verbatim as data. → Untrusted inputs
- Heartbeats on a clock advance → one `agent.heartbeat` row (journal-only, not in feeds) per refreshed agent, committed with its `agents.last_seen_at` update; at NFR-07 scale growth is bounded by steps × agents (accepted). → AC-26 (SPEC-server-api §C5, AC-39)
- Docker volume deleted (`docker compose down -v`) → next start is a fresh database and loads the fixture. → AC-6 (accepted: explicit data deletion by the Operator)
- Reset while the browser is open but the server is stopped → after the server restarts, the browser resumes below the floor → resync. → AC-42
- Session number passes 9999 → `S-10000` (padding is a minimum, not a width). → AC-16
- Model price referenced by a session cannot be removed. → AC-24
- Fixture day vs. Operator's local timezone → fixture times are anchored in UTC (see Open questions).

## Non-functional

Measured locally (NFR-05) on a developer laptop, PostgreSQL from `compose.yaml`, warm cache, dataset =
fixture × 10 (≈1 210 sessions, ≈19 000 log entries) plus a 100 000-row `events` table, and one session of
1 000 entries (NFR-07).

- **NFR-DB-1 (command latency, NFR-01):** p95 of one command transaction (state change + events + commit) < 20 ms; the remaining NFR-01 budget (< 500 ms end-to-end) belongs to SPEC-server-api / SPEC-web-ui.
- **NFR-DB-2 (Event Log / Activity page):** p95 < 20 ms for a 40-event page with or without source/category filters, and for a ticket's 30 / an agent's 16 newest events.
- **NFR-DB-3 (Session Log):** p95 < 50 ms to read all entries of a 1 000-entry session in order.
- **NFR-DB-4 (Usage & Cost):** p95 < 150 ms for one period's full aggregate set (KPIs, 4 breakdowns, 30-day cost-per-day series, first sessions page) over `ALL TIME`.
- **NFR-DB-5 (resume):** p95 < 50 ms to read up to 1 000 events after a given `seq`.
- **NFR-DB-6 (start-up):** migrations + fixture load on an empty database < 5 s.
- **NFR-DB-7 (security, NFR-05):** the database listens on localhost only; credentials only in the git-ignored env file; no connection string committed (ADR-0009).

## Cross-module interactions

Modules (ADR-0002): `server/` owns the database; `shared/` holds the camelCase contract shapes;
`web/` never touches the database. `mcp/` and `telemetry/` are next iteration.

```mermaid
sequenceDiagram
  participant W as web (browser)
  participant S as server: command (use case)
  participant DB as PostgreSQL
  participant F as server: SSE fan-out
  W->>S: command (SPEC-server-api §C6)
  S->>DB: BEGIN; take events advisory lock
  S->>DB: read + change state rows; bump id counter if needed
  S->>DB: INSERT events (seq assigned)
  alt guard or constraint fails
    S->>DB: ROLLBACK (no state, no event)
    S-->>W: refusal (SPEC-server-api §C3)
  else ok
    S->>DB: COMMIT
    S->>F: publish committed events
    F-->>W: id: seq / event: type / data: Event
  end
  W->>S: reconnect with Last-Event-ID = N
  S->>DB: events WHERE seq > N ORDER BY seq (or resync `below_floor` / `ahead` / `too_far_behind` — SPEC-server-api AC-61, §C8)
```

- **Data crossing the boundary:** rows map 1:1 to the shared contract entities (Contracts §2); `seq` crosses as the SSE `id`.
- **Failure contract:** any failure inside a command transaction rolls back everything (AC-26). A database constraint violation is reported to the server as a typed failure, which SPEC-server-api maps per §C3 "Constraint mapping" (AC-72): a race the rules would have refused → the matching `409` (e.g. `agent_busy`), counter collision → one retry then `500 internal`, empty title → `400 validation_failed`, enum / token-shape / FK / append-only violation → `500 internal`, serialization or lock timeout → `409 stale_state`; no event is published. If the database becomes unreachable at runtime, the server answers `503 db_unavailable` and recovers without restart (SPEC-server-api AC-69); the UI shows its "Connection lost" banner (SPEC-web-ui, BRD-10).
- **Simulator:** writes only through the same commands (ADR-0008); its per-agent script state is stored in `agent_sim_state` in the same transaction as the step it belongs to, so a restart resumes the same script (SIM-03, NFR-03).

## Contracts

Shapes only. Logical types: `text`, `int` (32-bit), `bigint`, `bool`, `numeric`, `timestamptz`, `jsonb`,
`text[]`. Enumerations are stored as lowercase snake_case strings and constrained to the listed values.
Every `*_at` column is **simulation time** unless named `real_*`. Column names are snake_case; the
contract field is the camelCase equivalent (`assignee_id` ↔ `assigneeId`). Columns are named so that each maps 1:1 to a field of SPEC-server-api §C2; derived fields (`health`, `step`, `costTodayUsd`, `lastSessionId`, token totals, costs) have no column.

### 1. Tables

**`tickets`** — Ticket (abstract spec: Domain model › Ticket)

| Column | Type | Null | Rule |
|---|---|---|---|
| `id` | text | no | PK; `T-<number>` (AC-15) |
| `number` | int | no | unique; ≥ 1; equals the id's integer |
| `title` | text | no | trimmed length ≥ 1 (AC-20) |
| `description` | text | no | default `''` |
| `acceptance_criteria` | text[] | no | default empty; one item per criterion, order kept |
| `priority` | text | no | `high` · `medium` · `low` |
| `status` | text | no | `backlog` · `ready` · `in_progress` · `review` · `done` |
| `assignee_id` | text | yes | FK → `agents.id`; null when nobody works on it (released / reopened / never assigned); kept on `done` as "finished by" |
| `blocked_question` | text | yes | the agent's question; non-null ⇒ `status = in_progress` |
| `answer` | text | yes | last Operator answer to a block |
| `review_summary` | text | yes | |
| `result_link` | text | yes | branch / PR text; never followed (Untrusted inputs) |
| `review_comment` | text | yes | current review comment; cleared on re-assign (BRD-11) |
| `last_update_text` | text | yes | one-line last update |
| `last_update_at` | timestamptz | yes | |
| `created_at` | timestamptz | no | age order for Board columns (BRD-01), ties broken by `number` |
| `updated_at` | timestamptz | no | last change of any field; drives `UPDATED` (BRD-05) and `done` order |

Partial unique index: `assignee_id` where `status in (in_progress, review)` (AC-17).

**`agents`** — Agent

| Column | Type | Null | Rule |
|---|---|---|---|
| `id` | text | no | PK; stable id (`alpha`, `sim-1`); lowercase `[a-z0-9-]+` |
| `name` | text | no | display name |
| `kind` | text | no | `real` · `simulated` (display only, PDR-0008) |
| `model` | text | no | FK → `model_prices.model`; model of the sessions it starts (contract `Agent.model`) |
| `stage` | text | no | `idle` · `planning` · `implementing` · `testing` · `awaiting_review` |
| `current_ticket_id` | text | yes | FK → `tickets.id`; **unique** (AC-17) |
| `current_session_id` | text | yes | FK → `sessions.id`; unique |
| `current_tool_name` / `current_tool_arg` / `current_tool_started_at` | text / text / timestamptz | yes | all three present or all absent |
| `last_tool_name` / `last_tool_arg` / `last_tool_ok` / `last_tool_at` | text / text / bool / timestamptz | yes | all four present or all absent |
| `last_seen_at` | timestamptz | no | last action or heartbeat (MC-05); `Agent Health` is derived, **not stored** (PDR-0011) |
| `created_at` | timestamptz | no | |

**`sessions`** — Session

| Column | Type | Null | Rule |
|---|---|---|---|
| `id` | text | no | PK; `S-` + number zero-padded to ≥ 4 digits (AC-16) |
| `number` | int | no | unique |
| `agent_id` | text | no | FK → `agents.id` |
| `ticket_id` | text | yes | FK → `tickets.id`; null = "no ticket" |
| `model` | text | no | FK → `model_prices.model` |
| `status` | text | no | `running` · `completed` · `failed` |
| `started_at` | timestamptz | no | |
| `ended_at` | timestamptz | yes | null ⇔ `running`; ≥ `started_at` (AC-19) |

Partial unique index: `agent_id` where `status = running` (AC-18). **No token or cost columns** (AC-14).

**`session_log_entries`** — LogEntry

| Column | Type | Null | Rule |
|---|---|---|---|
| `id` | bigint | no | PK, generated |
| `session_id` | text | no | FK → `sessions.id` |
| `ordinal` | int | no | 0, 1, 2… within the session (contract `LogEntry.index`); unique (`session_id`, `ordinal`) (AC-35) |
| `at` | timestamptz | no | entry time as shown |
| `kind` | text | no | `operator` · `agent` · `tool` · `stage` · `system` |
| `text` | text | yes | required for `operator`, `agent`, `system` |
| `stage` | text | yes | required for `stage`; agent stage value |
| `tool_name` | text | yes | required for `tool` (e.g. `Read`, `agent-ops · claim_next_ticket`) |
| `tool_arg` | text | yes | |
| `tool_ok` | bool | yes | required for `tool` |
| `tool_result` | text | yes | short result (`EXIT 1`, `142 LINES`, `+38 −6`) |
| `tool_duration_sec` | int | yes | ≥ 0 (contract `tool.durationSec`) |
| `tool_output` | text | yes | full output, verbatim, no length cap |
| `input_tokens` / `output_tokens` / `cache_read_tokens` / `cache_write_tokens` | bigint | yes | all-or-none, ≥ 0; only on `agent`, `tool`, `system` (AC-21) |
| `token_activity` | text | yes | required iff tokens present: `reasoning_replies` · `reading_code` · `editing_code` · `running_commands` · `agent_ops` · `session_context` · `other` |

Token activity is stored (not re-derived at read time) so Usage & Cost "By activity" is a plain
aggregation; the mapping rule (Agent → reasoning_replies, Read/Grep → reading_code, Edit → editing_code,
Bash → running_commands, `agent-ops · *` → agent_ops, session-start System → session_context, any other
entry → other) is applied when the entry is written, exactly as SPEC-server-api §C1 states it. `other` never occurs in the fixture.

**`model_prices`** — ModelPrice

| Column | Type | Null | Rule |
|---|---|---|---|
| `model` | text | no | PK (`opus-5-5`) |
| `input_per_m` / `output_per_m` / `cache_read_per_m` / `cache_write_per_m` | numeric (exact, ≥ 4 decimals) | no | ≥ 0; USD per 1 000 000 tokens; never floating point |

**`events`** — Event (the journal; shared vocabulary)

| Column | Type | Null | Rule |
|---|---|---|---|
| `seq` | bigint | no | PK, generated always, commit-ordered (AC-27), never reset (AC-39) |
| `at` | timestamptz | no | simulation time |
| `real_at` | timestamptz | no | wall clock at commit, default now |
| `source` | text | no | `operator` · `agent_report` · `agent_telemetry` · `system` |
| `category` | text | no | `ticket` · `agent` · `tool` |
| `type` | text | no | `<word>.<word>` lowercase snake_case (AC-31); catalogue owned by SPEC-server-api |
| `agent_id` | text | yes | FK → `agents.id` |
| `ticket_id` | text | yes | FK → `tickets.id` |
| `session_id` | text | yes | FK → `sessions.id` |
| `payload` | jsonb | no | default `{}`; shape per `type` as in SPEC-server-api §C5; always contains `summary` |
| `warn` | bool | no | default false (blocked, failed tool, refusal) |

Append-only: UPDATE and DELETE rejected by the database (AC-25). `type` is free text under the format
check, so new event types need no migration.

**`simulation_state`** — Simulation state (exactly one row)

| Column | Type | Null | Rule |
|---|---|---|---|
| `id` | int | no | PK, always 1 |
| `clock_at` | timestamptz | no | Simulation Clock (SIM-10); advances only with steps |
| `seed` | bigint | no | PRNG seed of the simulation (fixture: 20261024) |
| `journal_floor_seq` | bigint | no | first `seq` of the current dataset (AC-39, AC-42); lets the server tell a pre-reset `Last-Event-ID` from a current one |
| `seeded_at` | timestamptz | no | wall clock of the last fixture load / reset |

The auto-play flag is **not** a column (AC-38).

**`agent_sim_state`** — per simulated agent script position (one row per agent)

| Column | Type | Null | Rule |
|---|---|---|---|
| `agent_id` | text | no | PK, FK → `agents.id` |
| `scenario` | text | no | scenario name (SIM-02) |
| `script` | jsonb | no | `AgentScript` of SPEC-server-api §C7 (versioned: queued actions, `askedTicketIds`, PRNG state) |
| `silent` | bool | no | agent is unresponsive and never acts (prototype `frozen`, SIM-02; SPEC-server-api AC-40 "unresponsive") |
| `pending_refusal_ticket_id` | text | yes | FK → `tickets.id`; set on Release, cleared on the agent's next step (SIM-11) |
| `cooldown_steps` | int | no | ≥ 0, default 0 |

**`id_counters`** — gap-free ids (AC-23)

| Column | Type | Null | Rule |
|---|---|---|---|
| `name` | text | no | PK: `ticket` · `session` |
| `next_value` | int | no | ≥ 1 |

### 2. Indexes (beyond PKs and the unique/partial-unique indexes above)

| Table | Index | Serves |
|---|---|---|
| `tickets` | (`status`, `priority`, `created_at`, `number`) | Board columns, auto-play pull order (BRD-01, SIM-08) |
| `events` | (`ticket_id`, `seq` desc) | ticket Activity, last 30 (BRD-06) |
| `events` | (`agent_id`, `seq` desc) | agent page, Said vs did 16 (MC-07, MC-08) |
| `events` | (`source`, `seq` desc), (`category`, `seq` desc) | Event Log filters + pagination (MC-06) |
| `events` | (`at`) | `Events / min` and 12-minute sparkline (MC-01) |
| `sessions` | (`started_at`) | Usage & Cost period filter, cost per day (CST-02, CST-03) |
| `sessions` | (`agent_id`, `started_at` desc) | agent's 10 newest sessions, `$ TODAY`, `Cost · 7d` (LOG-01, MC-02) |
| `sessions` | (`ticket_id`, `started_at` desc) | ticket `Sessions & cost`, console tabs (CST-07, CON-02) |
| `sessions` | (`model`, `started_at`) | Model filter (CST-05, CST-08) |
| `session_log_entries` | unique (`session_id`, `ordinal`) | Session Log order, per-session aggregates (LOG-03…LOG-09) |
| `session_log_entries` | (`session_id`, `token_activity`) | Where the tokens went, By activity (LOG-08, CST-04) |

### 3. Transaction rule

Every command is one transaction: take the events advisory lock as the **first** statement (so guards
read the latest committed state and `seq` follows commit order) → read and change state rows (and
`id_counters`, `agent_sim_state`, `simulation_state.clock_at` when the command touches them) → insert
one or more `events` rows → commit → publish. Reads that must be consistent with a `seq` (AC-29) run in
one repeatable-read transaction. Fixture load and reset are single transactions under the same lock.

### 4. Seed fixture mapping

Source of truth for values: `seed()`, `history()`, `todaySessions()`, `genLog()`, `enrich()`,
`toolTok()`, `ctxTok()` in `docs/design/prototype/app.dc.html`, documented in `docs/design/mock-data.md`.
The fixture must reproduce that generator's output exactly (golden values in AC-9, AC-10); whether it is
ported as code or committed as a generated data file is a planning choice.

**4.1 Time.** Prototype times are seconds-of-day plus a `day` index. Map to
`2026-10-24T00:00:00Z − day × 1 day + seconds`. Fixture "now" (simulation clock) = `2026-10-24T14:32:00Z`.
Tool durations `d` (seconds) → `tool_duration_sec = d`.

**4.2 Agents** (`name` = `id`; kind from `seed()`):

| id | kind | model | stage | current ticket / session | current tool | last tool | last_seen_at | sim state |
|---|---|---|---|---|---|---|---|---|
| alpha | real | sonnet-5-5 | implementing | T-12 / S-0412 | Edit `src/stream/sse.ts`, started 14:32:00 | — | 14:31:58 | prototype `queue` → §C7 `script` |
| bravo | real | opus-5-5 | testing | T-9 / S-0413 | Bash `npm test -- a11y`, started 14:31:26 | — | 14:31:59 | prototype `queue` → §C7 `script` |
| charlie | real | haiku-5-5 | idle | — / S-0415 | — | — | 14:31:55 | empty `queue` |
| sim-1 | simulated | sonnet-5-5 | planning | T-8 / S-0414 | — | — | 14:31:46 | prototype `queue` → §C7 `script` |
| sim-2 | simulated | sonnet-5-5 | awaiting_review | T-7 / — | — | Bash `npm run lint`, failed, 14:19:30 | 14:31:12 | empty `queue` |
| sim-3 | simulated | sonnet-5-5 | awaiting_review | T-6 / — | — | — | 13:31:09 | `silent = true` |

**4.3 Model prices** (USD per 1M tokens): `opus-5-5` 15.00 / 75.00 / 1.50 / 18.75 · `sonnet-5-5` 3.00 / 15.00 / 0.30 / 3.75 · `haiku-5-5` 0.80 / 4.00 / 0.08 / 1.00 (input / output / cache read / cache write).

**4.4 Tickets.** All 16 from `seed()` with title, description, acceptance criteria, priority, status,
assignee, blocked reason (T-8), review summary and result link (T-6, T-7), last update text. Mapping
of fields: `desc` → `description`, `ac` → `acceptance_criteria`, `summary` → `review_summary`, `pr` →
`result_link`, `update` → `last_update_text`, `blocked` → `blocked_question`. Times:
`created_at` = 08:00:00 + `number` seconds on the fixture day, except T-7 = 09:12:00 (its creation event);
`updated_at` / `last_update_at` = the prototype `updatedAt` where non-zero (T-6 13:30:40, T-7 14:20:18,
T-8 14:26:40, T-9 14:31:50, T-12 14:30:44, T-13 14:30:11), T-5 = 14:12:30 (its approval event), others =
`created_at`. The prototype `asked` flag (T-7, T-8, T-9, T-12) goes into the holding agent's
`script.askedTicketIds` (sim-2, sim-1, bravo, alpha respectively), not into `tickets`.

**4.5 Events.** The 44 rows of `seed().events`, in order, mapped by pattern to the SPEC-server-api
event catalogue (§C5), which is the source of truth for types, sources, categories, `warn` and payloads:

| Prototype text (src) | `source` | `category` | `type` | `warn` |
|---|---|---|---|---|
| `Created T-x` (op) | operator | ticket | `ticket.created` | no |
| `Moved A → B` (op) | operator | ticket | `ticket.moved` | no |
| `Approved T-x` (op) | operator | ticket | `ticket.approved` | no |
| `Claimed T-x` (rep) | agent_report | ticket | `ticket.assigned` with `payload.claim = true`, `from = "ready"` | no |
| `Stage → X` (rep) | agent_report | agent | `agent.stage_changed` | no |
| `Submitted for review · …` (rep) | agent_report | ticket | `ticket.submitted` | no |
| `Blocked · …` (rep) | agent_report | ticket | `ticket.blocked` | yes |
| `Update · … · N%` (rep) | agent_report | ticket | `ticket.updated` | no |
| `Connected` (rep) | agent_report | agent | `agent.connected` | no |
| `Checked review status` (rep) | agent_report | agent | `agent.heartbeat` | no |
| `<Tool> started · arg` (tel) | agent_telemetry | tool | `tool.started` | no |
| `<Tool> ok · arg` (tel) | agent_telemetry | tool | `tool.finished` | no |
| `<Tool> failed · arg · exit 1` (tel) | agent_telemetry | tool | `tool.failed` | yes |

`at` = the prototype time on the fixture day; `agent_id` / `ticket_id` as in the prototype row;
`session_id` = the agent's session covering that time where one exists; `payload` = the §C5 payload for
that type parsed from the prototype text (from/to, stage, tool and arg, progress and text, question,
result link) plus `summary` = the prototype text verbatim (it already follows the §C5 summary pattern).
Besides that one `agent.heartbeat`, the fixture contains no `simulation.*`, `agent.health_changed`, `session.*` or
`log.appended` rows — those are written only by live commands and steps. Historical sessions
(`S-0001`…`S-0114`) have no journal events.

**4.6 Sessions and log entries.** 114 sessions from `history()` (PRNG seed 20261024, Park–Miller
`s = s × 16807 mod 2147483647`) and 7 from `todaySessions()` (sub-generators seeded 401 and 410 plus the
hand-written logs of S-0409, S-0412…S-0415), each entry passed through `enrich()` (tool tokens, tool
output, session-start context tokens). Entry mapping: prototype `type` → `kind`; `tok.i/o/cr/cw` → the
four token columns; `tool`, `arg`, `ok`, `result`, `out` → `tool_*`; `stage` entries' `STAGE → X` →
`stage`; `ordinal` = 0-based position in the prototype array. Running sessions: `ended_at` null. Counters after
load: ticket 17, session 416.

## Untrusted inputs

The database stores, and never interprets, text that originates outside the product's control: ticket
titles/descriptions/criteria, Operator answers and comments, agent replies, tool names, arguments,
results and outputs, review summaries, result links, and event payloads. In the MVP all of it comes
from the fixture or the simulator, but the rule is the one the next iteration (real agents) needs:

- It is stored verbatim and only ever passed to the database as bound values — never concatenated into
  SQL, never used as an identifier, never evaluated by a database function.
- `jsonb` payloads are data; no column, trigger or migration executes their content.
- `result_link` is stored as plain text; the database layer never resolves or fetches it.

## Open questions

Recommended defaults are already applied in this spec; each needs only a confirm.

- [x] ~~ADR-0009 `events` columns differ from the shared vocabulary~~ — closed: ADR-0009 now uses the shared column vocabulary.
- [x] ~~Journal `agent.heartbeat` on every step?~~ — closed by SPEC-server-api §C5 / AC-39: yes, one journal-only `agent.heartbeat` per refreshed agent per clock advance; feeds exclude it.
- [x] ~~Event type names beyond the Round-2 list~~ — closed by SPEC-server-api §C5: categories stay `ticket` / `agent` / `tool`; added types `ticket.updated`, `ticket.answer_read`, `ticket.comment_read`, `agent.refused`, `agent.connected`, `agent.health_changed`, `simulation.stepped`, `simulation.play_changed` (category `agent`); self-claim = `ticket.assigned` with `source = agent_report`, `payload.claim = true`. The schema accepts all of them (AC-22, AC-31).
- [x] ~~Reset while the server runs~~ — closed by SPEC-server-api AC-66: refused with "Stop the server first" (AC-40).
- [x] ~~Fixture timezone~~ — closed: fixture times are UTC (`2026-10-24T14:32:00Z`) and the UI shows simulation time in UTC (SPEC-web-ui AC-138).
- [x] ~~Reset vs. `seq` continuity~~ — closed by SPEC-server-api AC-65: reads equal a clean start while new `seq` values stay above every earlier one and the floor moves (AC-39).
- [NEEDS CLARIFICATION: Cap on `tool_output` size. **Default:** no database cap; NFR-07 scale makes it harmless; revisit with live capture (next iteration).] — owner
- [NEEDS CLARIFICATION: Fixture delivery — port the prototype generator to server code, or commit a generated data file. **Default:** committed generated data file plus the golden-total test of AC-9/AC-10 (no PRNG port to keep in sync); planner's call.] — implementation-planner
- [NEEDS CLARIFICATION: Test database isolation (one database per test file vs. transaction rollback per test). **Default:** per ADR-0012 once drafted.] — ADR-0012
