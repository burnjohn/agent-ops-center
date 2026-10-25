# Workflow Retro — mvp-run-plan (2026-10-24)

Retrospective of the first full Spec-Driven Development run in this repository: one unified
implementation plan for three layer specs, executed by `run-plan` with parallel sub-agents, gated by
`architecture-reviewer` + `plan-verifier`, and closed with two fix-loop iterations.

| | |
|---|---|
| **Specs** | `docs/specs/database.md` (SPEC-database), `docs/specs/server-api.md` (SPEC-server-api), `docs/specs/web-ui.md` (SPEC-web-ui) |
| **Plan** | `docs/plans/mvp.md` — 68 tasks, 6 phases, 16 DAG layers |
| **Decisions** | ADR-0002, 0004, 0008, 0009, 0010, 0011, 0012; PDR-0004, 0006–0011 (accepted at the start of the run) |
| **Branch** | `feat/mvp` (work left uncommitted after `c83c49d` for review) |
| **Agents** | 84 sub-agents, all depth 1 (no nested sub-agents) |
| **Concurrency** | multi-agent, cap 5 concurrent, max 3 per module |
| **Data source** | deep — sub-agent JSONL journals parsed with `.claude/skills/workflow-retro/scripts/analyze_journals.py` |
| **Outcome** | **PASS after 2 fix iterations** (~35 findings fixed) |

## 1. Outcome

| Check | Result |
|---|---|
| lint / typecheck / prettier | pass / pass / pass |
| `shared` tests | 90 / 90 |
| `server` tests (unit + integration on real Postgres) | 409 / 409 |
| `web` tests (Vitest + RTL) | 354 / 354 |
| `web` e2e (Playwright) | 56 / 56 |
| `drizzle-kit check` | clean |
| Remaining `it.fails` / `test.fail()` | 0 |
| Benchmarks (`server/bench/run.ts`) | 28 / 28 NFR budgets met (slowest read 98 ms vs 300 ms budget) |
| architecture-reviewer | FAIL (2 high) → **PASS** after fix loop 1 |
| plan-verifier (3 specs) | FAIL (0 missing, 17 partial) → **PASS** after fix loops 1–2 |

## 2. Metrics

### 2.1 Totals

| Metric | Value |
|---|---|
| Agents | 84 (55 implementer, 21 test-writer, 4 plan-verifier, 2 architecture-reviewer, 1 implementation-planner, 1 doc-writer) |
| Input-side tokens | 203.8 M (uncached 4.4 k · cache-read 190.6 M · cache-write 13.2 M) |
| Output tokens | 186.8 k |
| Cache hit ratio | 93.5 % |
| Tool calls | 2 759 |
| Wall-clock (first agent start → last agent end) | 7 004 s (1 h 57 m) |
| Σ agent spans | 14 720 s (4 h 05 m) |
| Parallelism factor | 2.1× (cap was 5) |
| Median agent | 116 s, 31 tool calls |
| Cost | n/a (per-model prices not verified) |

### 2.2 By agent type

| Agent type | Model | Count | Input-side tokens | Output | Tool calls | Σ span |
|---|---|---|---|---|---|---|
| implementer | claude-sonnet-5-5 | 55 | 103.0 M | 67.0 k | 1 494 | 6 496 s |
| test-writer | claude-sonnet-5-5 | 21 | 84.4 M | 102.1 k | 979 | 6 232 s |
| plan-verifier | claude-sonnet-5-5 | 4 | 7.1 M | 1.3 k | 132 | 516 s |
| implementation-planner | claude-opus-5-5 | 1 | 5.0 M | 0.8 k | 37 | 1 294 s |
| architecture-reviewer | claude-sonnet-5-5 | 2 | 2.6 M | 6.5 k | 88 | 87 s |
| doc-writer | claude-sonnet-5-5 | 1 | 1.8 M | 9.1 k | 29 | 96 s |

### 2.3 Longest agents and lowest cache hit

| Agent | Span | Tool calls | Note |
|---|---|---|---|
| implementation-planner (unified plan) | 1 294 s | 37 | stopped once by the user, then finished |
| T65 core e2e flows | 1 276 s | 101 | real server + Postgres per worker |
| T66 a11y / theme / layout e2e | 800 s | 59 | axe on 7 screens × 2 themes |
| Fix loop G2 (database and lock) | 540 s | 45 | migration 0002 + TCP-proxy outage test |
| T41 simulation integration tests | 510 s | 53 | |
| T59 RTL tests shell / UI kit / simulation | 395 s | 97 | |

Lowest cache hit: architecture re-review 52 %, plan re-verification 70 %, planner 75 % — short or
one-shot agents with little prefix reuse.

### 2.4 Launch order and critical path

```
planner → T01 → (T02 ‖ T03 ‖ T04) → T05 → (T06 ‖ T13) → (T07 ‖ T08) → T09 → T10
  → [ server chain T11 … T32  ‖  web chain T43 … T56 ]
  → server integration tests T33–T42  ‖  web RTL tests T57–T63
  → T64 → T65
  → review gate (architecture-reviewer ‖ 3 × plan-verifier ‖ T41/T42/T65)
  → fix loop 1 (G1 ‖ G2 ‖ G3, then G4) → T66 ‖ re-review
  → fix loop 2 (G5 ‖ G6)
```

Critical path: T01 → T05 → shared T06–T10 → T11 → T15 → T21 → T24 → T25/T26 → T29/T31 → T32 → T64 →
T65 → fix loops. Three ad-hoc fixes ran mid-run (see 3.2).

## 3. Why 55 implementer agents

`run-plan` dispatches **one fresh agent per plan task**, so each agent works only inside that task's
owned paths and agents can run concurrently without edit conflicts. Test tasks go to `test-writer`,
documentation to `doc-writer`; everything else goes to `implementer`.

| Source | Count | Tasks |
|---|---|---|
| Non-test plan tasks | **47** | T01–T32, T43–T56 (code), T68 (benchmarks) |
| Ad-hoc fixes during the run | **3** | cross-lane gaps reported by agents |
| Fix loop after the review gate | **5** | G1, G2, G3 (iteration 1), G5, G6 (iteration 2) |
| **Total** | **55** | |

Not implementers: T33–T42, T57–T66 and fix group G4 (`test-writer`), T67 (`doc-writer`).

### 3.1 Implementer agents — plan tasks

**Phase 0 — scaffold**

| # | Task | What it did | Span | Tools | Input tokens |
|---|---|---|---|---|---|
| 1 | T01 | pnpm workspace, tsconfig, ESLint/Prettier, `compose.yaml` (Postgres 18); all MVP dependencies installed once, lockfile frozen afterwards | 138 s | 35 | 2.1 M |
| 2 | T02 | `shared/` module: tsconfig, vitest, `AGENTS.md`, `insights/` | 22 s | 7 | 0.25 M |
| 3 | T03 | `server/` module: tsconfig, two vitest projects (unit / int), onion layer skeleton | 48 s | 17 | 0.8 M |
| 4 | T04 | `web/` module: Vite, vitest + jsdom, Playwright config, `tokens.css` import | 34 s | 7 | 0.3 M |
| 5 | T05 | AGENTS.md Modules table with real test / typecheck commands | 26 s | 11 | 0.5 M |

**Phase 1 — `shared/` contracts**

| # | Task | What it did | Span | Tools | Input tokens |
|---|---|---|---|---|---|
| 6 | T06 | Zod enums §C1, resources §C2, error codes §C3 | 60 s | 11 | 0.55 M |
| 7 | T07 | 26 event types §C5, SSE messages §C8 incl. keepalive | 59 s | 11 | 0.55 M |
| 8 | T08 | 5×5 transition table §C4; health, cost and token-activity rules | 61 s | 17 | 1.0 M |
| 9 | T09 | Request / response schemas for every endpoint §C6, `AgentScript` §C7 | 63 s | 11 | 0.6 M |
| 10 | T10 | Barrel `index.ts`; check that server and web see the contracts | 30 s | 11 | 0.6 M |

**Phase 2 — server domain and database**

| # | Task | What it did | Span | Tools | Input tokens |
|---|---|---|---|---|---|
| 11 | T11 | Domain: Ticket / Agent / Session entities, `DomainRefusal`, event builders, token generation | 166 s | 39 | 3.1 M |
| 12 | T12 | Drizzle schema (9 tables), migrations, append-only trigger on `events` | 114 s | 30 | 2.1 M |
| 13 | T13 | Config from env, pg client, migrations on start, advisory locks | 192 s | 21 | 1.2 M |
| 14 | T14 | Fixture generator running the prototype's code in `node:vm`; committed `fixture.json` | 176 s | 41 | 3.4 M |
| 15 | T15 | Application ports and in-memory fakes for unit tests | 140 s | 27 | 2.2 M |
| 16 | T16 | Unit of work (lock → state + events → COMMIT → publish), snapshot with `asOfSeq`, constraint-error mapping | 116 s | 35 | 2.3 M |
| 17 | T17 | Six state repositories, no delete methods | 84 s | 19 | 1.4 M |
| 18 | T18 | Read queries A: tickets, agents, agent page, overview | 102 s | 23 | 1.6 M |
| 19 | T19 | Read queries B: sessions, session detail, usage, model prices | 93 s | 23 | 1.5 M |
| 20 | T20 | Fixture load-if-empty and reset in one transaction | 67 s | 19 | 1.3 M |

**Phase 3 — server commands, simulation, HTTP**

| # | Task | What it did | Span | Tools | Input tokens |
|---|---|---|---|---|---|
| 21 | T21 | Ticket-work service; create and move commands (release, reopen, mark done, approve) | 150 s | 37 | 3.0 M |
| 22 | T22 | Assign, request-changes and answer commands | 96 s | 21 | 1.3 M |
| 23 | T23 | Simulation clock advance, heartbeats, health transitions | 63 s | 17 | 0.9 M |
| 24 | T24 | Simulation core: PRNG, agent scripts, `agentAct` (7 decision branches), step availability | 239 s | 49 | 4.7 M |
| 25 | T25 | Simulation commands: step, run to next stage, step all, play / pause, holds | 101 s | 23 | 1.4 M |
| 26 | T26 | Application queries A: tickets, agents, overview, events, simulation state, said vs did | 137 s | 33 | 2.7 M |
| 27 | T27 | Application queries B: sessions, usage, prices (cost computed in the application layer) | 108 s | 33 | 2.3 M |
| 28 | T28 | Fastify core: `buildApp`, error mapping, validation, `X-As-Of-Seq`, `/healthz` | 78 s | 21 | 1.2 M |
| 29 | T29 | Ticket routes and every read endpoint | 82 s | 31 | 2.0 M |
| 30 | T30 | SSE fan-out and `/api/stream`: hello, resume, resync, keepalive | 55 s | 19 | 1.0 M |
| 31 | T31 | Simulation routes | 36 s | 13 | 0.8 M |
| 32 | T32 | Composition root, `main.ts`, reset CLI, live smoke (found the SQL bug, see #50) | 208 s | 51 | 4.4 M |

**Phase 4 — web**

| # | Task | What it did | Span | Tools | Input tokens |
|---|---|---|---|---|---|
| 33 | T43 | API client (the only `fetch` caller), TanStack query keys, queries, commands | 65 s | 19 | 1.3 M |
| 34 | T44 | SSE stream, 30 s watchdog, reconnect with `since`, cache updates from events | 73 s | 9 | 0.5 M |
| 35 | T45 | UI kit: Button with disabled reason, controls, Modal, Toast, Tooltip | 94 s | 19 | 1.2 M |
| 36 | T46 | Display components (KPI, health, event row, table, chart) and `lib/format` | 136 s | 19 | 1.3 M |
| 37 | T47 | Simulation panel: PLAY / PAUSE / STEP, clock, holds | 51 s | 17 | 1.0 M |
| 38 | T48 | App shell: router, header, connection-lost banner, ActionGate, theme, history | 143 s | 65 | 3.8 M |
| 39 | T49 | Moves: transition reactions, drag & drop, assign / confirm / request-changes / new-ticket modals | 122 s | 43 | 2.6 M |
| 40 | T50 | Agent console | 111 s | 31 | 1.9 M |
| 41 | T51 | Board screen | 100 s | 23 | 1.9 M |
| 42 | T52 | Ticket page | 142 s | 39 | 3.2 M |
| 43 | T53 | Mission Control | 99 s | 27 | 1.9 M |
| 44 | T54 | Agent page | 67 s | 27 | 1.7 M |
| 45 | T55 | Usage & Cost | 88 s | 23 | 1.5 M |
| 46 | T56 | Session Log | 125 s | 25 | 1.9 M |

**Phase 5**

| # | Task | What it did | Span | Tools | Input tokens |
|---|---|---|---|---|---|
| 47 | T68 | Benchmarks: fixture × 10 + 100 000 events, 28 NFR budgets | 190 s | 33 | 2.8 M |

### 3.2 Implementer agents — ad-hoc fixes during the run

| # | Fix | Why | Span | Tools | Input tokens |
|---|---|---|---|---|---|
| 48 | Emit `log.appended` | T21, T22 and T24 each skipped the event, so the console did not update live | 88 s | 35 | 2.1 M |
| 49 | `AgentRow.sim`, `request-changes` event, `nextTicketId` from the counter | Found by T26: the port lacked data, «Next step» was disabled for idle agents | 61 s | 27 | 1.7 M |
| 50 | Qualified column reference in a correlated subquery | T32's live smoke: `POST /api/simulation/step` returned 500 on a real database | 106 s | 35 | 1.9 M |

### 3.3 Implementer agents — fix loop

| # | Group | What it fixed | Span | Tools | Input tokens |
|---|---|---|---|---|---|
| 51 | G1 (iter. 1) | Simulation: offline-agent sessions (AC-41), stale sim-2 (AC-40), `new Date` (ADR-0008), AC-53 property test | 323 s | 35 | 2.3 M |
| 52 | G2 (iter. 1) | Database: migration 0002 (AC-16, AC-20), server-lock reconnect (AC-40/66), concurrent pg queries, AC-32 / AC-33 tests | 540 s | 45 | 3.2 M |
| 53 | G3 (iter. 1) | 10 web findings: simulation-panel gating, hello race, Event Log filters, OCT 4 label, 1180 px breakpoint, … | 168 s | 50 | 4.2 M |
| 54 | G5 (iter. 2) | Accessibility: theme-toggle accessible name, contrast, hit areas ≥ 40 px | 362 s | 66 | 5.2 M |
| 55 | G6 (iter. 2) | Event Log keeps its rows frozen while paused (AC-102) | 100 s | 19 | 1.1 M |

## 4. Other agents

### 4.1 Planning and docs

| Agent | What it did | Span | Tools | Input tokens |
|---|---|---|---|---|
| implementation-planner | Unified plan `docs/plans/mvp.md`: 68 tasks, owned paths, DAG, traceability; raised Q1–Q3 | 1 294 s | 37 | 5.0 M |
| doc-writer — T67 | `docs/architecture/README.md` (4 Mermaid diagrams) and README quick start | 96 s | 29 | 1.8 M |

### 4.2 Test-writer agents

| # | Task | What it tested | Span | Tools | Input tokens | Real bugs found |
|---|---|---|---|---|---|---|
| 1 | T33 | Server integration harness: per-agent DB, fixture reload, SSE reader | 64 s | 17 | 1.0 M | — |
| 2 | T34 | Migrations and schema constraints | 185 s | 25 | 1.7 M | 2 (`S-10000`, whitespace titles) |
| 3 | T35 | Unit of work (ADR-0009 check), snapshot, events journal, read queries | 236 s | 53 | 4.9 M | — |
| 4 | T36 | Fixture golden totals and reset | 106 s | 15 | 0.9 M | — |
| 5 | T37 | Architecture import scan (ADR-0008/0009/0010) | 76 s | 13 | 0.6 M | 1 (`new Date` in simulation) |
| 6 | T38 | HTTP command integration tests (25-pair move table) | 200 s | 39 | 2.8 M | — |
| 7 | T39 | SSE stream: resume, resync, keepalive, no gap / duplicate at hand-over | 257 s | 31 | 2.4 M | — |
| 8 | T40 | Every read endpoint, golden totals, `X-As-Of-Seq` | 216 s | 27 | 2.0 M | — |
| 9 | T41 | Simulation over HTTP, scenarios, determinism | 510 s | 53 | 4.3 M | 2 (AC-40, AC-41) |
| 10 | T42 | Runtime: start-up, lock, DB outage via TCP proxy, shutdown | 192 s | 33 | 2.4 M | 1 (lock lost after outage) |
| 11 | T57 | Web RTL harness: fake `fetch` / `EventSource`, contract-valid fixtures | 143 s | 37 | 3.0 M | — |
| 12 | T58 | API layer: event cache (ADR-0011 check), client, stream | 142 s | 37 | 2.3 M | — |
| 13 | T59 | Shell, UI kit, simulation panel | 395 s | 97 | 10.6 M | 1 (AC-30) + hello race |
| 14 | T60 | Board and moves (all 20 transitions) | 226 s | 47 | 4.2 M | — |
| 15 | T61 | Ticket page and console | 200 s | 57 | 4.6 M | — |
| 16 | T62 | Mission Control and Agent page | 267 s | 51 | 4.8 M | 1 (`MOCK DATA`) |
| 17 | T63 | Usage & Cost and Session Log | 320 s | 59 | 6.0 M | 1 (OCT 4 label) |
| 18 | T64 | Playwright harness and smoke | 126 s | 31 | 1.7 M | — |
| 19 | T65 | Core e2e flows: keyboard, release, two tabs, reconnect | 1 276 s | 101 | 10.9 M | — |
| 20 | T66 | e2e: axe, theme, time zone, layout, navigation | 800 s | 59 | 5.5 M | 3 classes (contrast, hit areas, AC-102) |
| 21 | G4 (fix iter. 1) | Removed `querySelector` (ADR-0012), server-like fakes | 294 s | 97 | 8.0 M | — |

### 4.3 Review gate

| Agent | Pass | Span | Tools | Input tokens | Verdict |
|---|---|---|---|---|---|
| architecture-reviewer | initial | 65 s | 65 | 2.0 M | FAIL — 2 high, 3 medium, 4 low |
| plan-verifier — SPEC-database | initial | 145 s | 37 | 1.5 M | FAIL — 39 / 42 done |
| plan-verifier — SPEC-server-api | initial | 84 s | 33 | 1.7 M | FAIL — 66 / 73 done |
| plan-verifier — SPEC-web-ui | initial | 170 s | 47 | 3.6 M | FAIL — ~118 / 138 done |
| architecture-reviewer | re-review | 22 s | 23 | 0.55 M | PASS |
| plan-verifier | re-verify | 116 s | 15 | 0.3 M | PASS (AC-137 pending e2e, then proven by T66) |

## 5. What went well

- **Contracts first.** `shared/` (T06–T10) was finished before any server or web code; 90 contract
  tests made later lanes cheap to integrate, and web ran fully parallel to server on top of them.
- **Owned paths held.** 68 tasks, zero edit conflicts between concurrent agents; explicit
  "except …" exclusions in the plan worked.
- **`it.fails` discipline.** Test agents never fixed source; they marked ~20 real defects with
  `it.fails` / `test.fail()` and `file:line`, which became a precise fix backlog and turned green as
  the proof of each fix.
- **Real-database and live checks paid off.** T32's live smoke found the 500 on step (missed by 200+
  unit tests on fakes); T42's TCP-proxy test found server-lock loss after an outage; T66's axe and
  hit-area checks found three accessibility bug classes.
- **Fixture golden numbers** (44 events, 121 sessions, $305.19) matched on the first generation and
  were re-checked by five independent agents.
- **Cache efficiency 93.5 %** despite 84 fresh agents reading the same AGENTS.md, plan and specs.

## 6. What was hard or wasteful

| # | Problem | Evidence | Impact |
|---|---|---|---|
| 1 | Stray writes to the repo root | 5 agents (T43, T45, T47, T28, one more): a failed `cd` followed by heredocs wrote files into `/` | extra tool calls, risk of cross-lane clobbering; mitigated mid-run by an "absolute paths" rule in briefs |
| 2 | Integration gaps between lanes found late | `log.appended` skipped by T21/T22/T24; `ReadQueries` port lacked `AgentRow.sim` and the counter; SQL bug invisible until T32 | 3 ad-hoc fixes; a port change broke T35's factories |
| 3 | Bugs found long after implementation | ~35 fix-loop findings, mostly in code written 1–3 h earlier; UI tasks had typecheck-only acceptance | 8 of 55 implementer agents (15 %) were fixes |
| 4 | Self-verify always ran whole suites | `pnpm --filter … test -- <filter>` does not filter (reported by ≥ 5 agents); scratch files `probe40.int.test.ts`, `scratch41.int.test.ts` gave neighbours false reds | longer agents, noisy reports |
| 5 | Formatting outside the loop | no task ran `prettier --check`; final `pnpm format` rewrote `docs/` and `.claude/` (no `.prettierignore`) | manual revert; `.prettierignore` added |
| 6 | Per-module cap left slots idle | several batches ran with 3–4 agents while server-ready tasks waited | parallelism 2.1× vs cap 5 |
| 7 | Duplicated orientation | every agent read AGENTS.md, gotchas, plan conventions and its task block in a 1 921-line plan | ~5–10 orientation tool calls per agent (cache absorbed the token cost) |
| 8 | Slow planner | 21 min, one user stop; plan is 1 921 lines | longest single step |

## 7. What was missed until late

- Accessibility contrast and hit areas (AC-133 / AC-134) — only in T66, the last task. One fix
  (dropping the offline card's 75 % opacity) now conflicts with `docs/design/components.md` and needs
  an owner decision.
- `client.query() already executing` pg warning — visible in T18, surfaced only via the bench (T68).
- Three unrecorded architectural decisions (static hosting of `web/dist`, single-server advisory lock,
  in-memory Play and holds) — flagged only by the final architecture review.

## 8. Recommendations

| # | Target | Change | Expected effect |
|---|---|---|---|
| 1 | Plan template / `implementation-planner` | Pair every infra / repository / route task with a real-DB integration check in the same task or the next batch | SQL bugs, port gaps and missing events surface within minutes, not hours |
| 2 | `.claude/agents/implementer.md`, `test-writer.md` | "Write files only with Write/Edit and absolute paths; never `cd … && cat > file`" (+ `insights/gotchas.md` entry) | removes the stray-root-write failure class |
| 3 | `server/AGENTS.md`, `web/AGENTS.md` | Document a working narrow test command (`pnpm --filter @agent-ops/<m> exec vitest run --project unit <path>`); state that `pnpm test -- <filter>` does not filter | shorter self-verify, fewer false reds |
| 4 | Agent rules | Throwaway probes go to the session scratchpad, never under `src/` | no cross-lane false reds |
| 5 | Self-verify checklist | Add `prettier --check` on owned paths (keep `.prettierignore`) | no end-of-run mass reformat |
| 6 | Port-defining tasks | Acceptance lists every consumer's needs (step availability, counters, log events) | no mid-run port churn |
| 7 | `run-plan` concurrency | Raise the server per-module cap to 4 once shared contracts are stable, or interleave test tasks into server batches | parallelism closer to 3× |
| 8 | Orchestrator briefs | Inline each task's block (script-extracted) instead of "search the plan" | fewer orientation tool calls |
| 9 | UI task acceptance | Require one RTL smoke test and a jsdom axe check per screen | accessibility issues found before the final e2e |

## 9. Open items for the owner

| # | Item | Decision needed |
|---|---|---|
| 1 | Offline agent card: `components.md` says "`--bg-sub` + 75 % opacity"; opacity was removed to meet WCAG AA | update `components.md` or choose another treatment |
| 2 | Three unrecorded architectural decisions (static hosting, advisory-lock single-server guard that exits on lock loss, in-memory Play / holds) | draft them as `proposed` ADRs? |
| 3 | API-AC-5: assigning a Review ticket returns a generic «Assign refused.» — the spec gives no reason text | extend the spec or accept |
| 4 | Event Log: frozen rows are lost when leaving Mission Control while paused (pause itself survives) | accept or schedule |
| 5 | Local Node 22.17 is below Fastify 5.12's `>=22.22`; react-router is pinned to v7 for the same reason | upgrade Node |
| 6 | Nothing committed after `c83c49d` | approve commits, then run `pr-self-review` before push |
