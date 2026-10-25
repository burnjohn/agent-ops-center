# Implementation Plan: Agent Ops MVP (database + server API + web UI)
Spec: `docs/specs/database.md` (SPEC-database), `docs/specs/server-api.md` (SPEC-server-api),
`docs/specs/web-ui.md` (SPEC-web-ui). Product source of truth: `docs/specs/abstract-project-spec.md`.

## Overview
Build the simulation-only MVP of Agent Ops (PDR-0008): a TypeScript pnpm monorepo with `shared/`
(Zod contracts), `server/` (onion Fastify server over PostgreSQL with a transactional `events`
journal, an SSE stream and an on-demand simulator), and `web/` (React 19 SPA: Board, ticket page
with Agent console, Mission Control, Agent page, Usage & Cost, Session Log). The three approved layer
specs define the behaviour; this plan sequences it so that `web/` can be built in parallel with the
database and server on top of the shared contracts.

## Execution mode
multi-agent (parallel) — chosen by the owner; executed by the `run-plan` skill. Tasks are phased,
owned paths are disjoint for every pair of tasks that can run at the same time, and the DAG is
explicit (see *Parallelism*).

## Requirements (verified)
AC ids are prefixed by spec: `DB-AC-n` = SPEC-database, `API-AC-n` = SPEC-server-api, `UI-AC-n` = SPEC-web-ui.

- R1: Monorepo scaffold — root workspace, strict tsconfig base, lint/format, Vitest/Playwright tooling,
  `compose.yaml` Postgres (owner ordering; ADR-0002, ADR-0009, ADR-0012).
- R2: Module bootstrap — `shared/`, `server/`, `web/` each get `AGENTS.md`, `insights/INSIGHTS.md`,
  `insights/gotchas.md`, and a Modules-table row with real Test and Typecheck commands (owner; AGENTS.md).
- R3: Shared contracts §C1–§C8 as Zod schemas + pure rules (transition table, health, cost, token
  activity) in `shared/` (API Contracts; API-AC-2; ADR-0010).
- R4: Schema and migrations — DB-AC-1…DB-AC-5, API-AC-73.
- R5: Seed fixture reproducing the prototype exactly — DB-AC-6…DB-AC-14, API-AC-63.
- R6: Integrity constraints — DB-AC-15…DB-AC-24.
- R7: Event journal — DB-AC-25…DB-AC-32.
- R8: Screen reads at the DB layer — DB-AC-33…DB-AC-36.
- R9: Persistence, reset, retention — DB-AC-37…DB-AC-42, API-AC-64…API-AC-66.
- R10: Validation, errors, atomicity, constraint mapping — API-AC-1…API-AC-6, API-AC-72.
- R11: Ticket commands — API-AC-7…API-AC-22.
- R12: Read API — API-AC-23…API-AC-31.
- R13: Cost and usage — API-AC-32…API-AC-37, API-AC-67.
- R14: Health — API-AC-38…API-AC-42.
- R15: Simulation engine — API-AC-43…API-AC-57.
- R16: Live stream and consistent reads — API-AC-58…API-AC-62, API-AC-71.
- R17: Runtime — API-AC-68…API-AC-70, API-AC-73.
- R18: App shell and navigation — UI-AC-1…UI-AC-17.
- R19: Toasts and command feedback — UI-AC-18…UI-AC-22.
- R20: Live updates, loading, errors, connection — UI-AC-23…UI-AC-34.
- R21: Agent Board — UI-AC-35…UI-AC-44.
- R22: Moves by the transition table — UI-AC-45…UI-AC-51.
- R23: Modals incl. New ticket — UI-AC-52…UI-AC-61, UI-AC-88…UI-AC-90.
- R24: Ticket page — UI-AC-62…UI-AC-76.
- R25: Agent console — UI-AC-77…UI-AC-87.
- R26: Mission Control and event text — UI-AC-91…UI-AC-105.
- R27: Agent page — UI-AC-106…UI-AC-109.
- R28: Usage & Cost — UI-AC-110…UI-AC-120.
- R29: Session Log — UI-AC-121…UI-AC-130.
- R30: Accessibility, theme, layout, UTC time — UI-AC-131…UI-AC-138.
- R31: Prototype deviations D-1…D-15 (abstract spec «Прототип і специфікація») and U-1…U-18
  (SPEC-web-ui «Prototype deviations») win over `docs/design/prototype/app.dc.html`.
- R32: Non-functional budgets — NFR-DB-1…NFR-DB-7, SPEC-server-api *Non-functional*, SPEC-web-ui
  *Non-functional* (measured by T68 + e2e; not every budget is a hard gate — see Risks).
- R33 (assumed default — confirm, Q1): the stream carries a liveness message that the browser's
  `EventSource` can observe, so UI-AC-29 is implementable.

## Decisions
- Constraining (all accepted 2026-10-24):
  - ADR-0001 MADR format — format only.
  - ADR-0002 pnpm monorepo `web/`, `server/`, `shared/` — exactly three packages, Node ≥22, pinned pnpm,
    strict TS, ESM, no `web→server` or `shared→*` imports, no `mcp/`/`telemetry/`.
  - ADR-0004 Fastify 5 + REST + one SSE endpoint `/api/stream` — Zod-validated POST bodies from shared,
    GET never calls a command, `id: <seq>`, exact resume; check file `server/src/presentation/http/stream.test.ts`.
  - ADR-0008 simulation through the command layer — no repositories/Drizzle/`events` writes in
    `server/src/application/simulation/**`, seeded PRNG only, time only via `Clock` port, auto-play off
    after boot; check files `simulation.test.ts`, `determinism.test.ts` in that folder.
  - ADR-0009 Postgres + Drizzle, transactional append-only `events`, advisory lock, drizzle-kit migrations,
    `postgres:18-alpine`, `DATABASE_URL` from env only; check file `unit-of-work` test.
  - ADR-0010 onion layers with inward-only imports, adapters built only in `container.ts`, Zod contracts
    only in `shared/`, `shared/` imports only `zod`; check file `server/src/architecture.test.ts`.
  - ADR-0011 React 19 + Vite + react-router + CSS Modules over `docs/design/tokens.css` + TanStack Query
    v5 fed by SSE; no Tailwind/CSS-in-JS/Next; only `web/src/api/**` calls `fetch`/`EventSource`;
    check file `web/src/api/eventCache.test.ts`.
  - ADR-0012 Vitest everywhere, RTL by role/label, real Postgres (`*.int.test.ts`, serial), Playwright in `web/e2e/`.
  - PDR-0004 (no WIP limit), PDR-0006 (release → Ready with confirm + refusal), PDR-0007 (mock cost/log data,
    `MOCK` labels), PDR-0008 (simulated agents only), PDR-0009 (Operator assigns/moves within guards),
    PDR-0010 (Offline agents stay in grid, last), PDR-0011 (30 s / 120 s / 10 min tool grace, heartbeat).
- Out of scope: ADR-0006 (MCP), ADR-0007 (telemetry) — proposed; nothing in this plan creates `mcp/` or `telemetry/`.
- Proposed by this plan: none. No new architectural decision was needed. Choices this plan makes inside
  the accepted ADRs (convention level, reversible within one module) are listed under *Architecture changes*.

## Open questions & recommendations

> **Resolved 2026-10-24 by the owner:** Q1–Q3 take the defaults below. The specs (server-api AC-62 / §C8,
> web-ui AC-29 / AC-101) and ADR-0009's CHECK path were updated to match.
- **Q1 (spec gap, blocks nothing if default accepted):** UI-AC-29 needs the browser to notice "no
  message or keepalive comment for 30 s", but API-AC-62 / §C8 send the keepalive as an SSE **comment**
  (`: keepalive`), and the browser `EventSource` API that ADR-0011 picks never shows comments to
  JavaScript. → **default:** the server sends `: keepalive` **and** an id-less `event: keepalive`
  (`data: {}`) every 15 s. `shared/src/stream.ts` models the extra message; the UI watchdog listens
  for it. This adds one message type to §C8; the owner or `spec-creator` should add it to
  SPEC-server-api §C8/AC-62. The other way out — read the stream with `fetch` instead of `EventSource`,
  so comments are visible — would go against ADR-0011's "one EventSource per tab" and would need a
  superseding ADR. T07, T30 and T44 are planned on the default.
- **Q2 (spec contradiction):** UI-AC-101 says "seed has 44 events → button visible, 4 more after click".
  But one of the 44 fixture events is the non-feed `agent.heartbeat` «Checked review status»
  (DB §4.5, API §C5, UI-AC-103), so the Event Log has 43 feed events and `Show 40 more` adds **3**.
  → default: T62 checks 40 + 3, plus the general rule that the second page holds (feed count − 40)
  rows. The spec's observable note should be fixed.
- **Q3 (ADR wording):** ADR-0009 names its check file `server/src/infrastructure/db/unit-of-work.test.ts`,
  but the test needs a real Postgres, and ADR-0012 names such tests `*.int.test.ts`. → default:
  `unit-of-work.int.test.ts` counts as ADR-0009's check. Recommend a typo-level in-place fix of
  ADR-0009's CHECK path.
- **Q4 (open in abstract spec, D-13):** should `alpha`/`bravo`/`charlie` show `REAL · CLAUDE CODE`? →
  default per UI-AC-93: show the kind from data (fixture `real`), as the spec says.
- **Q5:** fixture delivery (DB open question, "planner's call") → **decided:** generate it once from the
  prototype with a script that runs the prototype's own generator code in `node:vm` (no PRNG port to keep
  in sync), commit the generated `server/fixture/fixture.json`, and guard it with the AC-9/AC-10 golden-total
  tests. Tool-output size cap (DB open question) → default: no cap.
- **Q6:** test-database isolation (DB open question) → **decided by ADR-0012:** one test database,
  migrated once per run, each file truncates and re-seeds, run serially. This plan adds a per-agent
  database-name suffix so concurrent agents don't clash (see *Parallelism*).
- **Rec-1:** Install every dependency in Phase 0 (T01) and treat `package.json` / `pnpm-lock.yaml` as
  frozen afterwards. Concurrent agents editing the lockfile is the most likely cause of a broken
  parallel run. A later task that finds it needs a dependency must stop and report, not install.
- **Rec-2:** Add a GitHub Actions CI workflow (typecheck + unit + int with a Postgres service + e2e) as a
  follow-up. The specs don't ask for it, so it isn't a task here.
- **Rec-3:** Many UI ACs say "observable: e2e". To keep the Playwright set small, as the owner asked,
  they are checked with RTL against a faked network boundary where one tab and no real timing is
  enough, and with Playwright only for cross-tab, connection, real-browser drag, keyboard, axe, timezone
  and viewport checks. The traceability table shows which level covers each AC.

## Affected modules & contracts
- `shared/` (new, `@agent-ops/shared`) — Zod contracts §C1–§C8 and pure rules.
- `server/` (new, `@agent-ops/server`) — domain, application (commands, queries, simulator), infrastructure
  (Drizzle schema/migrations, unit of work, repositories, read queries, fixture, SSE fan-out, scheduler),
  presentation (Fastify routes, stream), composition root, reset CLI.
- `web/` (new, `@agent-ops/web`) — SPA, API module, design-system components, features per screen, e2e.
- Contracts: all new files under `shared/src/` (no existing contracts to break). Once T10 lands, any
  edit to a `shared/src/` file is a cross-module change: the editing task must keep `server` and `web`
  typechecking or stop and report.

## Architecture changes
Repository root: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`,
`.prettierrc.json`, `.nvmrc`, `.env.example`, `compose.yaml`, `docker/postgres-init/01-databases.sql`.

`shared/src/` — `enums.ts`, `primitives.ts`, `resources.ts`, `errors.ts`, `events.ts`, `stream.ts`,
`transitions.ts`, `rules/{health,cost,token-activity}.ts`, `api.ts`, `script.ts`, `index.ts` (barrel).
Consumed as TypeScript source (`"exports": { ".": "./src/index.ts" }`), no build step.

`server/` (ADR-0010 layers):
- `src/domain/**` — entities `ticket.ts`, `agent.ts`, `session.ts`; `ids.ts`, `time.ts`, `errors.ts`
  (`DomainRefusal`), `event-builders.ts` (event rows with §C5 summaries), `token-generation.ts`
  (deterministic `hashK`/`toolTok`/`ctxTok`/`toolOut` from the prototype).
- `src/application/ports/**` (UnitOfWork + TxContext, repositories, read-query ports, `Clock`,
  `Scheduler`, `EventPublisher`/`EventSubscriber`, `ServerLock`, `DbUnavailableError`),
  `src/application/testing/**` (in-memory fakes), `src/application/services/ticket-work.ts`,
  `src/application/commands/tickets/**`, `src/application/simulation/**`, `src/application/queries/**`.
- `src/infrastructure/` — `config.ts`; `db/{client,schema,migrate,locks,server-lock,unit-of-work,snapshot,constraint-errors}.ts`;
  `repositories/*.repository.ts`; `queries/*.ts`; `fixture/{fixture-data,load-fixture,reset}.ts`;
  `sse/fan-out.ts`; `scheduler/interval-scheduler.ts`.
- `src/presentation/http/` — `app.ts`, `errors.ts`, `validate.ts`, `as-of-seq.ts`, `routes/*.ts`,
  `stream.ts`, `simulation/*.ts`.
- `src/container.ts`, `src/main.ts`, `src/cli/reset.ts` (calls a factory exported by `container.ts`).
- `drizzle/**` (generated + one `--custom` migration for triggers), `drizzle.config.ts`,
  `scripts/generate-fixture.ts`, `fixture/fixture.json`, `test/int/**` (integration harness), `bench/**`.

`web/` (ADR-0011):
- `src/api/**` — `client.ts`, `queries.ts`, `commands.ts`, `keys.ts`, `stream.ts`, `eventCache.ts`.
- `src/ui/**` — design-system components from `docs/design/components.md`; `src/lib/**` — formatters
  (UTC), display labels.
- `src/app/**` — router, providers, shell (header, nav, theme, back bar + visit history, connection
  banner, action gate, not-found, screen frame).
- `src/features/{simulation,moves,board,ticket,console,mission-control,agent,usage,session-log}/**`.
- `src/test/**` — fakes at the network boundary (`fetch` stub + `FakeEventSource`), seed-like builders.
- `e2e/**`, `playwright.config.ts`.

Choices this plan makes inside the ADRs (not ADR-level, per the architecture-decisions skill "Not an ADR"):
`pg` (node-postgres) as the Drizzle driver; ESLint 9 flat config + typescript-eslint + Prettier; server
runs through `tsx` in dev and start (local product, no build of `shared`); `moduleResolution: "Bundler"`;
native HTML5 drag & drop (no DnD library); hand-built SVG/CSS bar chart (no chart library); Fastify
validation with an explicit `safeParse` helper (no type-provider plugin); `@fastify/static` serves
`web/dist`; dependency-free import-scan architecture test; no MSW (tests stub `fetch` and `EventSource`
directly); reset-vs-running-server detection through a session-level advisory lock that the server holds
while it runs.

## Phased tasks

Conventions for every task:
- **Self-verify** = the module's Test + Typecheck commands from the AGENTS.md Modules table (filled in by
  T05) plus `pnpm lint`. Integration tests need `docker compose up -d`.
- **Frozen manifests:** after T01, no task edits any `package.json` or `pnpm-lock.yaml` (Rec-1).
- **Colocated unit tests:** an implementer task owns `<file>.test.ts` next to the files it creates. The
  `*.int.test.ts`, `*.test.tsx` and `web/e2e/**` files belong to the `Type: test` tasks listed.
- **Copy and behaviour:** UI copy comes from SPEC-web-ui verbatim. The prototype
  (`docs/design/prototype/app.dc.html`) is the layout/behaviour reference **except** where D-1…D-15 /
  U-1…U-18 say otherwise. Styling uses only `docs/design/tokens.css` custom properties and `docs/design/components.md`.
- Every task carries `engineering-insights` and `security` in its skills. They are left out of the
  lists below to save space.

### Phase 0 — Monorepo scaffold and module bootstrap

- **T01**
  - **Action:** Create the root pnpm workspace and install **all** dependencies of the MVP at once.
    Root `package.json` (`"type": "module"`, `"engines": {"node": ">=22"}`, `packageManager` pinning pnpm 10.x,
    scripts `lint`, `format`, `typecheck` = `pnpm -r typecheck`, `test` = `pnpm -r test`); `pnpm-workspace.yaml`
    listing exactly `shared`, `server`, `web`; `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`,
    `module: ESNext`, `moduleResolution: Bundler`, `target: ES2023`, `verbatimModuleSyntax`);
    `eslint.config.js` (typescript-eslint, react-hooks for `web/**`); `.prettierrc.json`; `.nvmrc` (22);
    `.env.example` (`DATABASE_URL=postgres://agent_ops:agent_ops@127.0.0.1:5432/agent_ops`, `PORT=3000`,
    `DATABASE_URL_TEST_BASE`); `compose.yaml` (`postgres:18-alpine`, port bound to `127.0.0.1:5432`, named
    volume, healthcheck, mounts `docker/postgres-init/`); `docker/postgres-init/01-databases.sql` (creates
    `agent_ops`, `agent_ops_test`, `agent_ops_e2e`). Package manifests with every dependency and script:
    `shared/package.json` (`zod`; dev `vitest`, `typescript`); `server/package.json` (`fastify`,
    `@fastify/static`, `drizzle-orm`, `pg`, `zod`, `@agent-ops/shared: workspace:*`; dev `drizzle-kit`,
    `@types/pg`, `tsx`, `vitest`, `typescript`, `@types/node`; scripts `dev`, `start`
    (`tsx src/main.ts`), `test` (unit + int projects), `test:unit`, `test:int`, `typecheck`, `db:generate`,
    `db:check`, `reset` (`tsx src/cli/reset.ts`), `fixture:generate`, `bench`); `web/package.json`
    (`react@19`, `react-dom@19`, `react-router`, `@tanstack/react-query@5`, `zod`, `@agent-ops/shared`;
    dev `vite`, `@vitejs/plugin-react`, `vitest`, `jsdom`, `@testing-library/react`,
    `@testing-library/user-event`, `@testing-library/jest-dom`, `@testing-library/dom`, `@playwright/test`,
    `@axe-core/playwright`, `@types/react`, `@types/react-dom`, `typescript`; scripts `dev`, `build`,
    `test`, `typecheck`, `e2e`). Pin exact current stable versions. Run `pnpm install` once to produce
    `pnpm-lock.yaml`. Extend `.gitignore` only if something is missing (it already covers `.env`, `dist/`,
    `playwright-report/`).
  - **Module:** root (+ manifests of shared, server, web)
  - **Type:** infra
  - **Skills to use:** dependency-checker, git-workflow, typescript-expert, architecture-decisions
  - **Owned paths:** `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.nvmrc`, `.env.example`, `.gitignore`, `compose.yaml`, `docker/**`, `shared/package.json`, `server/package.json`, `web/package.json`
  - **Depends-on:** none
  - **Covers:** R1; ADR-0002, ADR-0009 (compose), ADR-0011 (deps), ADR-0012 (runner)
  - **Risk:** medium
  - **Known gotchas:** ADR-0002 forbids any `mcp/`/`telemetry/` package. ADR-0011 forbids `tailwindcss`,
    `styled-components`, `@emotion/*`, `next`. ADR-0012 forbids `jest`, `mocha`, `cypress`, `ts-jest`,
    `pg-mem`, `pglite`. No `latest` image tag. The DB port is bound to loopback only (NFR-DB-7). Do not
    commit `.env`. This is the only task that may touch the lockfile.
  - **Acceptance:** `pnpm install --frozen-lockfile` exits 0; `docker compose up -d && docker compose exec postgres psql -U agent_ops -lqt | cut -d\| -f1 | grep -cE "agent_ops(_test|_e2e)?\s*$"` prints 3;
    `cat pnpm-workspace.yaml; ls -d mcp telemetry 2>/dev/null` shows the 3 packages and no extra dirs;
    `grep -n '"node"\|packageManager' package.json` matches both; `grep -n "image: postgres" compose.yaml` shows `postgres:18-alpine`;
    `grep -nE '"(tailwindcss|styled-components|@emotion/[a-z-]+|next)"' web/package.json` and
    `grep -rnE '"(jest|mocha|cypress|ts-jest)"' package.json */package.json` print nothing.

- **T02**
  - **Action:** Bootstrap `shared/`: `tsconfig.json` (extends base, strict), `vitest.config.ts`
    (`passWithNoTests: true`, node env), placeholder `src/index.ts` (`export {}`), `AGENTS.md` (purpose,
    "imports only `zod`", contract-change rule, commands), `insights/INSIGHTS.md` and `insights/gotchas.md`
    (templates from the engineering-insights skill).
  - **Module:** shared
  - **Type:** infra
  - **Skills to use:** typescript-expert, zod
  - **Owned paths:** `shared/tsconfig.json`, `shared/vitest.config.ts`, `shared/src/index.ts`, `shared/AGENTS.md`, `shared/insights/**`
  - **Depends-on:** T01
  - **Covers:** R1, R2
  - **Risk:** low
  - **Known gotchas:** ADR-0010: `shared/src/**` imports only `zod` and relative paths.
  - **Acceptance:** `pnpm --filter @agent-ops/shared test` and `pnpm --filter @agent-ops/shared typecheck` exit 0.

- **T03**
  - **Action:** Bootstrap `server/`: `tsconfig.json`; `vitest.config.ts` with two projects — `unit`
    (`src/**/*.test.ts`, excluding `*.int.test.ts`) and `int` (`src/**/*.int.test.ts`, `fileParallelism: false`,
    `pool: 'forks'`, `singleFork`), `passWithNoTests: true`; empty layer folders with `.gitkeep`
    (`src/domain`, `src/application`, `src/infrastructure`, `src/presentation`); placeholder `src/main.ts`;
    `AGENTS.md` (layer table and import allow-list from ADR-0010, "Docker must be up for `test`",
    `AGENT_OPS_TEST_DB_SUFFIX` rule, commands); `insights/INSIGHTS.md`, `insights/gotchas.md` (seed it with
    the gotchas from this plan's Risks that concern the server).
  - **Module:** server
  - **Type:** infra
  - **Skills to use:** onion-architecture, typescript-expert, fastify-best-practices
  - **Owned paths:** `server/tsconfig.json`, `server/vitest.config.ts`, `server/src/main.ts`, `server/src/*/.gitkeep`, `server/AGENTS.md`, `server/insights/**`
  - **Depends-on:** T01
  - **Covers:** R1, R2
  - **Risk:** low
  - **Known gotchas:** The onion-architecture skill describes a `modules/<name>/` layout. **ADR-0010's
    `server/src/{domain,application,infrastructure,presentation}` layout wins.**
  - **Acceptance:** `pnpm --filter @agent-ops/server test` and `pnpm --filter @agent-ops/server typecheck` exit 0.

- **T04**
  - **Action:** Bootstrap `web/`: `tsconfig.json` (DOM libs, `jsx: react-jsx`); `vite.config.ts` (React
    plugin; `server.proxy['/api']` → `http://127.0.0.1:3000` with SSE passthrough; `server.fs.allow` incl.
    repo root so `docs/design/tokens.css` can be imported); `vitest.config.ts` (jsdom,
    `setupFiles: ['src/test/setup.ts']`, `passWithNoTests`); `src/test/setup.ts` (jest-dom); `index.html`;
    placeholder `src/main.tsx` that imports `../../docs/design/tokens.css` once and renders a stub;
    `playwright.config.ts` skeleton (Chromium, `testDir: 'e2e'`); `AGENTS.md` (ADR-0011 rules: CSS Modules,
    tokens only, API access only via `src/api`, RTL query rules, e2e command `pnpm --filter @agent-ops/web e2e`);
    `insights/INSIGHTS.md`, `insights/gotchas.md`.
  - **Module:** web
  - **Type:** infra
  - **Skills to use:** react-best-practices, frontend-architecture (only its non-Next parts), react-testing-library, typescript-expert
  - **Owned paths:** `web/tsconfig.json`, `web/vite.config.ts`, `web/vitest.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/test/setup.ts`, `web/playwright.config.ts`, `web/AGENTS.md`, `web/insights/**`
  - **Depends-on:** T01
  - **Covers:** R1, R2
  - **Risk:** low
  - **Known gotchas:** ADR-0011: `tokens.css` is imported exactly once, at the entry. The
    `frontend-architecture` skill is written for Next.js App Router. Ignore its Next-specific rules (no
    RSC, no `app/` file conventions).
  - **Acceptance:** `pnpm --filter @agent-ops/web test`, `pnpm --filter @agent-ops/web typecheck` and
    `pnpm --filter @agent-ops/web build` exit 0; `grep -rn "tokens.css" web/src` prints exactly one line.

- **T05**
  - **Action:** Fill the AGENTS.md **Modules** table with three real rows — shared
    (`pnpm --filter @agent-ops/shared test` / `pnpm --filter @agent-ops/shared typecheck`), server
    (`pnpm --filter @agent-ops/server test` — unit + int, needs `docker compose up -d` / `pnpm --filter @agent-ops/server typecheck`),
    web (`pnpm --filter @agent-ops/web test` / `pnpm --filter @agent-ops/web typecheck`; e2e command in the
    Purpose cell). Replace the "stack is not chosen yet" paragraph in AGENTS.md *Project* with a pointer to
    ADR-0002/0004/0008–0012. In `insights/gotchas.md`, replace the obsolete "The stack is not chosen yet"
    trap (gotchas.md is curated, not append-only) with "Stack fixed by ADR-0002…0012; only T01 adds
    dependencies". Run every command in the table once.
  - **Module:** root docs
  - **Type:** docs
  - **Skills to use:** architecture-decisions
  - **Owned paths:** `AGENTS.md`, `insights/gotchas.md`
  - **Depends-on:** T02, T03, T04
  - **Covers:** R2; ADR-0012 rule "commands listed in the Modules table"
  - **Risk:** low
  - **Known gotchas:** run-plan reads commands from this table. Keep the column layout unchanged.
  - **Acceptance:** the table has 3 rows with no `—`; each of the 6 commands exits 0 when run from the repo root.

### Phase 1 — Shared contracts (`shared/`)

- **T06**
  - **Action:** `shared/src/enums.ts` (§C1 enums as `z.enum` + value arrays: TicketStatus, Priority,
    AgentStage, AgentHealth, AgentKind, SessionStatus, LogEntryType, TokenActivity, EventSource,
    EventCategory, Period, StepMode, StepStop); `primitives.ts` (TicketId `T-<n>` regex without leading zeros,
    SessionId `S-\d{4,}`, AgentId `[a-z0-9-]+`, IsoTimestamp, non-negative int, money); `resources.ts` (§C2:
    TokenUsage, Ticket, ToolRef, LastTool, Agent incl. `step`, SessionSummary, LogEntry, SessionDetail,
    ModelPrice, SimulationState incl. `healthThresholds` and `nextTicketId`, CommandResult); `errors.ts`
    (§C3 `ErrorCode` enum, `ErrorResponse` schema, `errorHttpStatus` map). All object schemas `.strict()`.
    Colocated unit tests.
  - **Module:** shared
  - **Type:** core/library
  - **Skills to use:** zod, typescript-expert, architecture-patterns
  - **Owned paths:** `shared/src/enums.ts`, `shared/src/primitives.ts`, `shared/src/resources.ts`, `shared/src/errors.ts`, `shared/src/{enums,primitives,resources,errors}.test.ts`
  - **Depends-on:** T05
  - **Covers:** R3; API-AC-2 (envelope shape); DB-AC-22 (enum values are the single source)
  - **Risk:** medium
  - **Known gotchas:** `Event.seq` is a JS number (§C2). Money is unrounded. Field names are camelCase.
    Do not add display names here (they are UI-owned, `web/src/lib`).
  - **Acceptance:** shared Test + Typecheck green; tests show `T-01`/`X-3` rejected, `S-0416`/`S-10000`
    accepted, `S-12` rejected, and every `ErrorCode` mapped to the HTTP status of §C3.

- **T07**
  - **Action:** `shared/src/events.ts` (§C5): `EventType` enum covering every catalogue row; per-type
    payload schemas (always `summary: string`); an `EVENT_CATALOGUE` record type → `{source, category,
    warn rule, feed}`; a discriminated `Event` schema with the §C2 columns; `isFeedEvent(event)`.
    `shared/src/stream.ts` (§C8): `HelloMessage`, `ResyncMessage` (`reason`: `ahead|below_floor|too_far_behind`),
    `KeepaliveMessage` (Q1 default: `event: keepalive`, `data: {}`), the stream event-name constants.
    Colocated tests.
  - **Module:** shared
  - **Type:** core/library
  - **Skills to use:** zod, typescript-expert
  - **Owned paths:** `shared/src/events.ts`, `shared/src/stream.ts`, `shared/src/events.test.ts`, `shared/src/stream.test.ts`
  - **Depends-on:** T06
  - **Covers:** R3, R16, R33; UI-AC-103/104/105 vocabulary
  - **Risk:** medium
  - **Known gotchas:** `ticket.assigned` has two variants (`source operator, claim:false` / `agent_report,
    claim:true`). `simulation.*` events use category `agent`. `agent.health_changed` is `warn` unless
    `to = online`. `session.ended` is `warn` if `failed`. Fixture events keep the prototype text as their
    `summary`. The Q1 keepalive message is an assumed default — call it out in the file header.
  - **Acceptance:** shared Test + Typecheck green; a test iterates `EventType.options`: each has a catalogue
    entry, and exactly the 7 types listed as hidden in UI-AC-103 have `feed: false`.

- **T08**
  - **Action:** `shared/src/transitions.ts` (§C4): the 5×5 table as data + `operatorTransition(from, to)
    → { kind, confirm, reason }` with the verbatim refusal reasons, plus `needs_input` reasons from API-AC-11.
    `shared/src/rules/health.ts` (`deriveHealth({lastSeenAt, currentTool}, now, thresholds)`, constants
    30/120/600 s, API-AC-38). `shared/src/rules/cost.ts` (`entryCostUsd(tokens, price)`, exact formula
    API-AC-32; `sumTokens`). `shared/src/rules/token-activity.ts` (§C1 mapping). Colocated tests.
  - **Module:** shared
  - **Type:** core/library
  - **Skills to use:** zod, typescript-expert, architecture-patterns
  - **Owned paths:** `shared/src/transitions.ts`, `shared/src/rules/**`
  - **Depends-on:** T06
  - **Covers:** R3, R11, R14, R13, R22; API-AC-10, API-AC-38, API-AC-32; UI-AC-45; D-1, D-2, D-3, D-4
  - **Risk:** medium
  - **Known gotchas:** The table follows SPEC-server-api §C4, **not** the prototype (D-1…D-4). The UI drop-hint
    copy (`↓ DROP — …`) is UI-owned and must not go here. Rules are pure: no `Date.now()`; `now` is a parameter.
  - **Acceptance:** shared Test + Typecheck green; a table-driven test covers all 25 cells (20 off-diagonal +
    5 "Already here"); health boundaries at 29/30/119/120 s and tool 599/600 s; 1 000 000 input tokens at
    $3/M → exactly 3.

- **T09**
  - **Action:** `shared/src/api.ts` (§C6): request schemas for every endpoint (bodies, path params, query
    strings with coercion and defaults: `limit` 40/200, sessions `limit` 12/100, `period` default `30d`,
    `sort`), text limits as exported constants (title 200, description 10 000, criteria 50×500,
    answer/comment 4 000), validation messages ("Title is required.", "A comment is required — tell the agent
    what to change.", "Write an answer before unblocking."), response schemas (ticket detail, agent page incl.
    `saidVsDid`, overview, events page, sessions page, usage, model prices, hold, step results), the
    `X-As-Of-Seq` header name. `shared/src/script.ts` (§C7 `AgentScript` v1, `ScriptAction` union). Colocated tests.
  - **Module:** shared
  - **Type:** core/library
  - **Skills to use:** zod, typescript-expert
  - **Owned paths:** `shared/src/api.ts`, `shared/src/script.ts`, `shared/src/api.test.ts`, `shared/src/script.test.ts`
  - **Depends-on:** T07
  - **Covers:** R3, R10; API-AC-1, API-AC-8, API-AC-18, API-AC-21 (messages); UI-AC-88 (limits)
  - **Risk:** medium
  - **Known gotchas:** Strict schemas reject unknown fields (API edge case). Every cost-bearing response has
    `dataSource: "mock"` (API-AC-37). Trimming: the title is valid only if non-empty **after trim**.
  - **Acceptance:** shared Test + Typecheck green; tests show `{"title":"   "}` fails with that exact message
    at path `title`, and an unknown field fails.

- **T10**
  - **Action:** Replace `shared/src/index.ts` with the barrel re-exporting every module, and add
    `shared/src/index.test.ts` (contract consistency: every §C6 response that carries `dataSource` parses a
    sample; the barrel exposes the rule functions).
  - **Module:** shared
  - **Type:** core/library
  - **Skills to use:** zod, typescript-expert, architecture-decisions
  - **Owned paths:** `shared/src/index.ts`, `shared/src/index.test.ts`
  - **Depends-on:** T07, T08, T09
  - **Covers:** R3; ADR-0010 contract rule
  - **Risk:** low
  - **Known gotchas:** After this task, any `shared/src` change is a cross-module change (see *Affected modules*).
  - **Acceptance:** shared Test + Typecheck green;
    `grep -rnE "from ['\"]" shared/src | grep -vE "from ['\"](zod|\./|\.\./)"` prints nothing (ADR-0010).

### Phase 2 — Server core contracts and database (`server/`)

- **T11**
  - **Action:** Domain layer: `ticket.ts`, `agent.ts`, `session.ts` (entities with intention methods —
    create, setStatus, assignTo, release, reopen, markDone, approve, requestChanges, answer, block, submit,
    update; agent stage/tool/seen mutations; session start/append/end incl. per-session ordinal), `ids.ts`
    (format/parse `T-<n>`, `S-<nnnn>`), `time.ts` (ISO add-seconds, UTC day), `errors.ts` (`DomainRefusal`
    with code + reason + message), `event-builders.ts` (builds event drafts with §C5 source/category/warn
    and summary text), `token-generation.ts` (port `hashK`, `toolTok`, `ctxTok`, `toolOut` from the
    prototype exactly). Colocated unit tests.
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** onion-architecture, architecture-patterns, typescript-expert, architecture-decisions
  - **Owned paths:** `server/src/domain/**`
  - **Depends-on:** T10
  - **Covers:** R11, R15 (building blocks); API-AC-22 (`updatedAt`); API-AC-57 (token derivation from content + clock)
  - **Risk:** medium
  - **Known gotchas:** ADR-0010: domain imports nothing outside `domain/` except **`import type`** from
    `@agent-ops/shared`. So the runtime transition table and health rule are applied in
    `application/`, not here, and there are no `zod`/`node:`/`fastify`/`drizzle-orm` imports. Event summaries
    use display names ("In Progress"); keep a domain-local status label map.
  - **Acceptance:** server Test + Typecheck green; `grep -rnE "from ['\"](fastify|drizzle-orm|zod|pg|node:)" server/src/domain`
    prints nothing; `grep -rn "from '@agent-ops/shared'" server/src/domain | grep -v "import type"` prints nothing.

- **T12**
  - **Action:** Drizzle schema `server/src/infrastructure/db/schema.ts` for all tables of DB Contracts §1
    (`tickets`, `agents`, `sessions`, `session_log_entries`, `model_prices`, `events`, `simulation_state`,
    `agent_sim_state`, `id_counters`). Include check constraints (id formats, `number` = id integer, trimmed
    title, all-or-none tool/last-tool triples, session status/ended_at rules, token all-or-none and ≥ 0,
    tokens only on agent/tool/system, activity iff tokens, enum value checks built from shared value arrays,
    event `type` regex, `simulation_state.id = 1`), FKs with `RESTRICT`, the partial unique indexes
    (tickets `assignee_id` where status in in_progress/review; sessions `agent_id` where running), unique
    `agents.current_ticket_id`/`current_session_id`, and the §2 indexes. `numeric` prices, `bigint` tokens,
    `events.seq` `generated always as identity`. `server/drizzle.config.ts`. Generate the migration with
    `drizzle-kit generate`, then add a `drizzle-kit generate --custom` migration with a
    `BEFORE UPDATE OR DELETE ON events` trigger that raises.
  - **Module:** server
  - **Type:** data
  - **Skills to use:** postgresql-table-design, drizzle-orm-patterns, architecture-decisions
  - **Owned paths:** `server/src/infrastructure/db/schema.ts`, `server/drizzle/**`, `server/drizzle.config.ts`
  - **Depends-on:** T10
  - **Covers:** R4, R6, R7; DB-AC-4, DB-AC-14, DB-AC-15…DB-AC-22, DB-AC-24, DB-AC-25, DB-AC-31, DB-AC-38 (no auto-play column)
  - **Risk:** high
  - **Known gotchas:** ADR-0009: no `drizzle-kit push`; schema and migration are committed together.
    Category is only `ticket|agent|tool` (DB-AC-22). No token/cost column on `sessions` (DB-AC-14). The
    append-only trigger must not fire on `TRUNCATE` (reset relies on `TRUNCATE … CONTINUE IDENTITY`, see
    T20). Name every constraint explicitly, because T16 maps constraint names to API errors (API §C3 Constraint mapping).
  - **Acceptance:** server Typecheck green; `pnpm --filter @agent-ops/server exec drizzle-kit check` exits 0;
    `ls server/drizzle/*.sql` shows the generated migration and the custom trigger migration.

- **T13**
  - **Action:** `infrastructure/config.ts` (reads `DATABASE_URL`, `PORT` default 3000, host fixed `127.0.0.1`;
    `describeTarget()` returns `host:port/db` with no password); `db/client.ts` (`pg.Pool` + Drizzle;
    wraps connection-refused/terminated errors into `DbUnavailableError`, which this task defines in the
    tiny application-layer file `application/ports/db-errors.ts` (no imports)); `db/migrate.ts` (Drizzle migrator; on failure
    throws with the failing migration's name); `db/locks.ts` (events advisory-lock key, server-lock key
    constants); `db/server-lock.ts` (session-level `pg_try_advisory_lock` held by the running server; a
    `isServerRunning()` probe for reset). Colocated unit tests for config parsing.
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** drizzle-orm-patterns, typescript-expert, onion-architecture
  - **Owned paths:** `server/src/infrastructure/config.ts`, `server/src/infrastructure/db/{client,migrate,locks,server-lock}.ts`, `server/src/infrastructure/config.test.ts`, `server/src/application/ports/db-errors.ts`
  - **Depends-on:** T05
  - **Covers:** R4, R17; DB-AC-1, DB-AC-2, DB-AC-3, DB-AC-5, API-AC-73, API-AC-68 (host); NFR-DB-7
  - **Risk:** medium
  - **Known gotchas:** ADR-0009: `DATABASE_URL` is read only here; never commit a connection string. Error
    messages show host:port and never the password. `DbUnavailableError` lives in `application/ports/db-errors.ts`
    so that presentation (T28) maps it without importing infrastructure (ADR-0010).
  - **Acceptance:** server Test + Typecheck green; unit test shows that a missing `DATABASE_URL` throws a
    message naming the variable, and that `describeTarget('postgres://u:secret@h:5432/d')` contains `h:5432`
    and not `secret`; `grep -rn "postgres://\|postgresql://" --include=*.ts server/src` matches only `*.test.ts`.

- **T14**
  - **Action:** `server/scripts/generate-fixture.ts`: read `docs/design/prototype/app.dc.html`, extract the
    `class Component extends DCLogic { … }` block, evaluate it in `node:vm` with a stub `DCLogic`, call
    `seed()` (which calls `history()`/`todaySessions()`/`enrich()`), and map the result per DB Contracts
    §4.1–§4.6 into a `FixtureData` document: agents (§4.2 table incl. model, current tool, last tool,
    last_seen), model prices, 16 tickets with §4.4 times, 121 sessions + log entries with ordinals, kinds,
    tool columns, tokens and stored token activity (§C1 mapping), the 44 events (§4.5 pattern → type,
    payload parsed from the text + verbatim `summary`, `session_id` = the agent's session covering that
    time), `agent_sim_state` (prototype `queue` → §C7 `AgentScript` with `askedTicketIds`, `silent` for
    sim-3, PRNG state from seed 20261024), counters (ticket 17, session 416), clock `2026-10-24T14:32:00Z`,
    seed. Validate every payload/script with the shared schemas. Write `server/fixture/fixture.json`. Define
    the `FixtureData` type + Zod parser in `server/src/infrastructure/fixture/fixture-data.ts`. `--check`
    prints the golden numbers.
  - **Module:** server
  - **Type:** data
  - **Skills to use:** zod, typescript-expert, postgresql-table-design
  - **Owned paths:** `server/scripts/generate-fixture.ts`, `server/fixture/**`, `server/src/infrastructure/fixture/fixture-data.ts`
  - **Depends-on:** T10
  - **Covers:** R5; DB-AC-8, DB-AC-9, DB-AC-10, DB-AC-11, DB-AC-12, DB-AC-13 (deterministic content); API-AC-63 (content)
  - **Risk:** high
  - **Known gotchas:** Times are `2026-10-24T00:00:00Z − day × 1 day + seconds` (UTC). Tickets
    `created_at` = 08:00:00 + number seconds, except T-7 = 09:12:00. The `asked` flags go into the holding
    agent's `script.askedTicketIds`, not into `tickets`. «Checked review status» maps to `agent.heartbeat`
    (non-feed). `Claimed T-x` maps to `ticket.assigned` with `source agent_report`, `claim: true`,
    `from: "ready"`. The prototype is trusted repo content, but run it with an empty `vm` context (no
    `require`, no `process`). The script is dev tooling outside `server/src`; the JSON is committed.
  - **Acceptance:** `pnpm --filter @agent-ops/server fixture:generate -- --check` prints exactly: 6 agents,
    16 tickets, 3 prices, 121 sessions (4 running, 9 failed, 19 without ticket, 10 with a failed tool call,
    longest 23 entries, only S-0409 with output > 4 lines), 1 918 entries / 1 670 with tokens, totals
    10 753 797 / 1 844 687 / 179 299 980 / 8 523 948, cost $305.19, 44 events; re-running produces a
    byte-identical `fixture.json` (`git diff --exit-code server/fixture`).

- **T15**
  - **Action:** Application ports and fakes: `application/ports/unit-of-work.ts` (`run<T>(fn: (tx) => …)`;
    `TxContext` exposes repositories, `appendEvents(drafts) → Event[]`, `nextNumber('ticket'|'session')`,
    `clock.now()/advance(sec)`), `repositories.ts` (Tickets, Agents, Sessions+LogEntries, SimState,
    ModelPrices, SimulationState), `read-queries.ts` (raw read ports for T18/T19, each run inside
    `SnapshotReader.read(fn) → {data, asOfSeq}`), `event-journal.ts` (since, page, latestForTicket/Agent,
    floor, lastSeq), `publisher.ts` (`EventPublisher.publish(events)`, `EventSubscriber.subscribe`),
    `clock.ts`, `scheduler.ts` (`every(ms, fn) → cancel`), `server-lock.ts`, `errors.ts`
    (`ConstraintRace` typed failures; `DbUnavailableError` stays in T13's `db-errors.ts`). In-memory fakes of every port in
    `application/testing/**` (fake UoW that rolls back on throw, fake clock, fake scheduler, recording publisher).
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** onion-architecture, architecture-patterns, typescript-expert, architecture-decisions
  - **Owned paths:** `server/src/application/ports/**` (except `db-errors.ts`, owned by T13), `server/src/application/testing/**`
  - **Depends-on:** T11
  - **Covers:** R7, R10, R16 (contract-first for T16–T32)
  - **Risk:** high
  - **Known gotchas:** ADR-0010: no imports from `infrastructure/`, `presentation/`, `fastify`,
    `drizzle-orm`. Ports carry domain entities and shared types, never Drizzle row types.
  - **Acceptance:** server Test + Typecheck green;
    `grep -rnE "infrastructure/|presentation/|from ['\"](fastify|drizzle-orm)" server/src/application` prints nothing.

- **T16**
  - **Action:** `infrastructure/db/unit-of-work.ts` (BEGIN → `pg_advisory_xact_lock(EVENTS_LOCK)` as the
    **first** statement → `fn(tx)` → insert events → COMMIT → `publisher.publish(committed)`; any throw →
    ROLLBACK, nothing published); `db/snapshot.ts` (REPEATABLE READ read-only tx returning `{data, asOfSeq =
    max(seq)}`); `db/constraint-errors.ts` (map `pg` error code + constraint name → §C3 constraint mapping:
    agent-busy race, counter collision → one retry then internal, empty title → validation, others →
    internal, serialization/lock timeout → stale_state); `repositories/events.repository.ts` (append,
    `since(seq, limit)`, feed page with keyset `beforeSeq` + source/category/agent/ticket filters,
    latest-30-for-ticket, latest-16 agent report/telemetry for agent, `lastSeq`, `journalFloor`, per-minute
    counts for 12 minutes on `at`); counter increment inside the tx.
  - **Module:** server
  - **Type:** data
  - **Skills to use:** drizzle-orm-patterns, postgresql-table-design, onion-architecture
  - **Owned paths:** `server/src/infrastructure/db/{unit-of-work,snapshot,constraint-errors}.ts`, `server/src/infrastructure/repositories/events.repository.ts`, `server/src/infrastructure/db/constraint-errors.test.ts`
  - **Depends-on:** T12, T13, T15
  - **Covers:** R7, R8, R10; DB-AC-23, DB-AC-26, DB-AC-27, DB-AC-28, DB-AC-29, DB-AC-30, DB-AC-33, DB-AC-34; API-AC-4, API-AC-72 (mapping)
  - **Risk:** high
  - **Known gotchas:** ADR-0009: never `update(events)`/`delete(events)`. Publish only **after** COMMIT
    resolves. `seq` gaps from rollbacks are allowed. The UoW gets a `repoFactory(tx)` injected from
    `container.ts`, so it does not import T17's files directly (they are built in parallel).
  - **Acceptance:** server Test + Typecheck green; `grep -rnE "update\(events\)|delete\(events\)|UPDATE events|DELETE FROM events" server/src`
    prints nothing; unit test of `constraint-errors` maps each named constraint from T12 to its §C3 outcome.

- **T17**
  - **Action:** State repositories under `infrastructure/repositories/`: `tickets`, `agents`, `sessions`
    (+ log entries, ordinal assignment, token activity stored on write), `sim-state` (`agent_sim_state`,
    script JSON validated with shared `AgentScript`), `model-prices`, `simulation-state` (clock, seed, floor).
    Include row ↔ domain mappers. Every method takes the tx handle.
  - **Module:** server
  - **Type:** data
  - **Skills to use:** drizzle-orm-patterns, postgresql-table-design, onion-architecture
  - **Owned paths:** `server/src/infrastructure/repositories/{tickets,agents,sessions,sim-state,model-prices,simulation-state}.repository.ts`, `server/src/infrastructure/repositories/mappers.ts`
  - **Depends-on:** T12, T13, T15
  - **Covers:** R6, R7, R9; DB-AC-14, DB-AC-21, DB-AC-35, DB-AC-41 (no delete paths)
  - **Risk:** medium
  - **Known gotchas:** Values are always bound parameters (DB *Untrusted inputs*). No delete methods at
    all (DB-AC-41). `bigint` token columns map to JS numbers.
  - **Acceptance:** server Test + Typecheck green; `grep -rnE "\.delete\(" server/src/infrastructure/repositories` prints nothing.

- **T18**
  - **Action:** Read queries A in `infrastructure/queries/`: `tickets.ts` (all tickets in API-AC-23 order,
    ticket by id), `ticket-detail.ts` (ticket + its sessions with per-session token sums by type + model +
    entry count), `agents.ts` (agents in fixture order + today's token sums per model, current/last session ids,
    pending refusal), `agent-page.ts` (sessions in the last 7 days, done tickets as assignee, tool calls in
    today's sessions, 7-day token sums, 10 newest sessions + total, tickets with events or assignment),
    `overview.ts` (online inputs, blocked count, review count).
  - **Module:** server
  - **Type:** data
  - **Skills to use:** drizzle-orm-patterns, postgresql-table-design
  - **Owned paths:** `server/src/infrastructure/queries/{tickets,ticket-detail,agents,agent-page,overview}.ts`
  - **Depends-on:** T12, T13, T15
  - **Covers:** R8, R12; DB-AC-34, DB-AC-36 (agent/today parts)
  - **Risk:** medium
  - **Known gotchas:** Return token sums **with the model**, so cost is computed once in the application
    with the shared `entryCostUsd`. "Today" = UTC date of the simulation clock, never the wall clock.
  - **Acceptance:** server Test + Typecheck green (behaviour is verified by T35/T40).

- **T19**
  - **Action:** Read queries B in `infrastructure/queries/`: `sessions.ts` (period by UTC day of
    `started_at` on the sim clock, `agentId`, `model`, sort by start or a token type/cost, limit/offset, total),
    `session-detail.ts` (header + entries by ordinal), `usage.ts` (period session set; token sums grouped by
    agent, ticket incl. null, model, activity — each with model; per-day sums for 30 days; per-session sums
    for mean/median), `model-prices.ts`.
  - **Module:** server
  - **Type:** data
  - **Skills to use:** drizzle-orm-patterns, postgresql-table-design
  - **Owned paths:** `server/src/infrastructure/queries/{sessions,session-detail,usage,model-prices}.ts`
  - **Depends-on:** T12, T13, T15
  - **Covers:** R8, R13; DB-AC-35, DB-AC-36; NFR-DB-3, NFR-DB-4
  - **Risk:** medium
  - **Known gotchas:** Sorting by `cost` needs a price join (`SUM(tokens × price)`). Keep `numeric`
    precision until the final conversion. Order entries by `ordinal`, never by `at` (DB-AC-35).
  - **Acceptance:** server Test + Typecheck green (behaviour is verified by T35/T40).

- **T20**
  - **Action:** `infrastructure/fixture/load-fixture.ts`: `loadFixtureIfEmpty(db)` (only when `agents` is
    empty; one tx under the events advisory lock; inserts all rows from `fixture.json` parsed with
    `FixtureData`; events in prototype order; sets `journal_floor_seq` = first inserted `seq`, `seeded_at` =
    wall clock). `infrastructure/fixture/reset.ts`: `resetToFixture(db)` (refuses with "Stop the server
    first" when `isServerRunning()` is true; one tx: lock, `TRUNCATE <all tables> CONTINUE IDENTITY`, reload
    fixture, floor = first new `seq`; any error → rollback).
  - **Module:** server
  - **Type:** data
  - **Skills to use:** drizzle-orm-patterns, postgresql-table-design
  - **Owned paths:** `server/src/infrastructure/fixture/{load-fixture,reset}.ts`
  - **Depends-on:** T12, T13, T14
  - **Covers:** R5, R9; DB-AC-6, DB-AC-7, DB-AC-11, DB-AC-12, DB-AC-39, DB-AC-40, DB-AC-42 (floor stored); API-AC-63, API-AC-65, API-AC-66
  - **Risk:** high
  - **Known gotchas:** `TRUNCATE` of tables that reference each other must name them all in **one** statement.
    `CONTINUE IDENTITY` keeps `seq` rising past every earlier value (DB-AC-39). Auto-play is never persisted
    (DB-AC-38). Load and reset take the same `EVENTS_LOCK` from `db/locks.ts`.
  - **Acceptance:** server Test + Typecheck green (behaviour is verified by T36/T42).

### Phase 3 — Server application, presentation, composition (`server/`)

- **T21**
  - **Action:** `application/services/ticket-work.ts` (shared orchestration: `startWork(ticket, agent,
    source)`, `endOpenSession(agent, status, systemText?)`, `freeAgent(agent)`) and ticket commands A in
    `application/commands/tickets/`: `create-ticket.ts` (API-AC-7) and `move-ticket.ts`, which resolves the
    cell with shared `operatorTransition` and dispatches `move`, `release`, `reopen`, `mark_done`, `approve`
    (or `needs_input`, `confirmation_required`, `transition_refused`) with an `expectedStatus` check. Effects
    and events per API-AC-9, AC-12…AC-16, AC-22. Colocated unit tests on the in-memory fakes.
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** onion-architecture, architecture-patterns, zod, typescript-expert, architecture-decisions
  - **Owned paths:** `server/src/application/services/**`, `server/src/application/commands/tickets/{create-ticket,move-ticket}.ts`, `server/src/application/commands/tickets/{create-ticket,move-ticket}.test.ts`
  - **Depends-on:** T15
  - **Covers:** R11; API-AC-4, AC-5, AC-6, AC-7, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-22; D-1, D-2, D-3, D-4
  - **Risk:** high
  - **Known gotchas:** Release sets a pending refusal + 4-step cooldown and ends the session `completed`
    with the system entry (API-AC-13, PDR-0006). Mark done of a Blocked ticket clears the block. Operator
    commands **do not advance the clock** (API open question, default). Stamp with `clock.now()`. One
    command = one `uow.run` (ADR-0009).
  - **Acceptance:** server Test + Typecheck green; table-driven unit test over all 20 off-diagonal pairs
    returns the §C4 outcome; release of T-12 on a fake fixture ends `alpha`'s session and emits
    `ticket.released` + `session.ended`.

- **T22**
  - **Action:** Ticket commands B: `assign-ticket.ts` (API-AC-19/20: busy check, clear block/comment, end a
    ticket-less open session, start a session with the `system` "Session started · <model>" entry and
    `ctxTok` tokens, stage `planning` + Planning script queued, refresh last-seen unless silent, events
    `ticket.assigned`(operator, `claim:false`) + `agent.stage_changed` + `session.started`);
    `request-changes.ts` (API-AC-17/18, new session, queue read-comment then report implementing);
    `answer-ticket.ts` (API-AC-21). Colocated unit tests.
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** onion-architecture, architecture-patterns, typescript-expert
  - **Owned paths:** `server/src/application/commands/tickets/{assign-ticket,request-changes,answer-ticket}.ts`, `server/src/application/commands/tickets/{assign-ticket,request-changes,answer-ticket}.test.ts`
  - **Depends-on:** T21
  - **Covers:** R11; API-AC-17, AC-18, AC-19, AC-20, AC-21, AC-22; D-5, D-12
  - **Risk:** high
  - **Known gotchas:** The assignment is an **Operator** event, never an `agent_report` claim (D-5).
    Request changes starts a **new** session (D-12). The queued Planning / read-comment scripts come
    through the `SimScripts` interface declared in `services/ticket-work.ts` (T21). T24 implements it and
    `container.ts` (T32) wires it in; unit tests here use a fake `SimScripts`. This task writes no script content.
  - **Acceptance:** server Test + Typecheck green; unit test: assign T-10 to `charlie` ends S-0415, opens a
    new running session, and the only `ticket.assigned` has `source = operator`; assigning `alpha` → `agent_busy`
    with "alpha is busy with T-12 — one ticket per agent.".

- **T23**
  - **Action:** `application/simulation/clock-advance.ts`: advance the Simulation Clock (6 s), then within
    the same tx refresh last-seen + one `agent.heartbeat` per responsive agent that was online before the
    advance and did not act (API-AC-39), skip silent/stale/offline ones (AC-40), fail running sessions of
    agents that became offline with the "Session interrupted — agent went Offline" entry (AC-41), and emit
    `agent.health_changed` on any change (AC-42), using shared `deriveHealth`. Colocated unit tests.
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** onion-architecture, typescript-expert, architecture-decisions
  - **Owned paths:** `server/src/application/simulation/clock-advance.ts`, `server/src/application/simulation/clock-advance.test.ts`
  - **Depends-on:** T15
  - **Covers:** R14; API-AC-38 (applied), AC-39, AC-40, AC-41, AC-42; D-7, D-11
  - **Risk:** medium
  - **Known gotchas:** ADR-0008: no `Date.now()`/`new Date(`, no `Math.random`, no repository/Drizzle
    imports in `application/simulation/**`. Use `tx` ports and `domain/time.ts`. `agent.heartbeat` is
    journal-only (non-feed).
  - **Acceptance:** server Test + Typecheck green; unit test: 20 advances keep blocked `sim-1` online with 20
    heartbeats; `sim-2` turns offline once lastSeen + 120 s passes, with exactly one `agent.health_changed`;
    `grep -rn "Date.now\|new Date(\|Math.random" server/src/application/simulation` prints nothing.

- **T24**
  - **Action:** Simulation engine core in `application/simulation/`: `prng.ts` (Park–Miller, state kept in
    the script), `scripts.ts` (`scriptFor(stage, ticket)` = prototype `plan()` + `files()` → §C7 actions,
    API-AC-48), `agent-act.ts` (AC-47 decision order; tool start/finish with the log entry, tokens via
    `toolTok`, `toolOut`, duration = clock difference, failure → queue explain/Edit A/rerun (AC-49); stage
    report → append stage entry + queue the next script (AC-48); update/block/message/read_answer/read_comment;
    submit (AC-50, via `ticket-work`); claim of the best Ready ticket only in a simulation-wide step
    (AC-51, `claim:true`, `agent_report`); pending refusal (AC-52); invariants AC-53),
    `step-availability.ts` (AC-45 reasons, reused by the Agent query). Implements T22's `SimScripts`
    interface. Colocated unit tests per AC-47 branch.
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** onion-architecture, architecture-patterns, typescript-expert, architecture-decisions
  - **Owned paths:** `server/src/application/simulation/{prng,scripts,agent-act,step-availability}.ts`, `server/src/application/simulation/{prng,scripts,agent-act,step-availability}.test.ts`
  - **Depends-on:** T21
  - **Covers:** R15; API-AC-45 (reasons), AC-47, AC-48, AC-49, AC-50, AC-51, AC-52, AC-53, AC-57 (PRNG); D-5
  - **Risk:** high
  - **Known gotchas:** ADR-0008 greps (`drizzle`, `infrastructure/`, `insert(`, `.execute(`, `Date.now`,
    `new Date(`, `Math.random`) must stay empty for this folder. Do not name methods `insert`/`execute`.
    Block only if the ticket is `high` and not in `askedTicketIds`. Tests fail on odd ticket numbers. Result
    link `PR #<40+n> · feat/<keyword>`.
  - **Acceptance:** server Test + Typecheck green; scripted unit run of T-13 (high, odd) on fakes hits one
    `ticket.blocked` and one `tool.failed` with 3 extra queued actions; ADR-0008 greps print nothing.

- **T25**
  - **Action:** Simulation commands in `application/simulation/`: `step-agent.ts` (validate with
    step-availability → `cannot_step`; one tx = clock-advance + one `agentAct` + `simulation.stepped`
    (mode `step`), API-AC-44), `run-to-next-stage.ts` (repeat, each step its own tx, stop reasons
    `stage_changed|waiting|no_work|limit`, ≤ 40, AC-46), `step-all.ts` (one advance, every agent acts once in
    fixture order, claims allowed, mode `step_all`/`play`, AC-54/AC-55 `simulation_playing`),
    `play-control.ts` (in-memory `playing` flag default false; `play`/`pause` emit `simulation.play_changed`;
    tick via `Scheduler` port every 1600 ms, skipped while a hold is active; holds by clientId expire 15 s
    after the last grant using the **real** time of the scheduler port, AC-56). ADR-0008 check suites:
    `simulation.test.ts` (no events and no clock movement without a step; `playing` false after construction;
    hold skips ticks) and `determinism.test.ts` (same seed + same command sequence → identical event
    types/payloads/`at` twice).
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** onion-architecture, typescript-expert, architecture-decisions
  - **Owned paths:** `server/src/application/simulation/{step-agent,run-to-next-stage,step-all,play-control}.ts`, `server/src/application/simulation/{simulation,determinism,step-agent,run-to-next-stage}.test.ts`
  - **Depends-on:** T22, T23, T24
  - **Covers:** R15; API-AC-43, AC-44, AC-45, AC-46, AC-54, AC-55, AC-56, AC-57; ADR-0008 Confirmation
  - **Risk:** high
  - **Known gotchas:** ADR-0012: no real timers in application tests — use the fake scheduler. Hold expiry
    is real time, not simulation time. `simulation.stepped` is the **last** event of each step (clients
    read `clock` from it).
  - **Acceptance:** server Test + Typecheck green; `server/src/application/simulation/simulation.test.ts`
    and `determinism.test.ts` pass; run-to-next-stage loop test proves ≤ 40 steps.

- **T26**
  - **Action:** Application queries A in `application/queries/`: `list-tickets.ts`, `get-ticket.ts` (ticket
    + 30 newest feed events + sessions newest first with cost, `costIsFinal`), `list-agents.ts` /
    `get-agent.ts` (health via `deriveHealth` at the sim clock, `step` via step-availability,
    `pausedAfterRelease`, `costTodayUsd`), `get-agent-page.ts` (KPIs + Said vs did per API-AC-29: last 16
    agent_report/telemetry feed events, mismatch when Testing is followed by ≥ 120 s with telemetry and no
    Bash, last 2 notes + count), `get-overview.ts` (12 per-minute feed counts on the sim clock),
    `list-events.ts` (feed only, keyset), `get-simulation-state.ts` (§C2 incl. `nextTicketId`, thresholds,
    `held`). Every query returns `{data, asOfSeq}` via `SnapshotReader`. Colocated unit tests.
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** onion-architecture, architecture-patterns, typescript-expert
  - **Owned paths:** `server/src/application/queries/{list-tickets,get-ticket,list-agents,get-agent,get-agent-page,get-overview,list-events,get-simulation-state,said-vs-did}.ts`, `server/src/application/queries/{said-vs-did,list-agents,get-overview}.test.ts`
  - **Depends-on:** T24
  - **Covers:** R12, R14; API-AC-23, AC-24, AC-25, AC-26, AC-27, AC-28, AC-29, AC-38, AC-71 (asOfSeq source)
  - **Risk:** medium
  - **Known gotchas:** Health is derived, never stored (PDR-0011). Feed filter = `isFeedEvent` from shared.
    The fixture `alpha` must show `mismatchCount = 1` for 14:05–14:16.
  - **Acceptance:** server Test + Typecheck green; unit test on a fake fixture: online 4/6, blocked 1,
    review 2; `sim-1.step = {available:false, reason:"Blocked — answer above to continue"}`; alpha mismatch = 1.

- **T27**
  - **Action:** Application queries B: `list-sessions.ts`, `get-session.ts` (SessionDetail: entries with
    `costUsd`/activity, totals = sum of entries, `costByType`, `tokenActivity` rows sorted by cost with share,
    top 5 steps with labels, stages with spans, `costIsFinal`, full tool output), `get-usage.ts` (period
    semantics, KPIs, cache-read share, running now, mean, median = element ⌊n/2⌋, 30 daily points with
    `inPeriod`/`isToday`, peak, breakdowns top-6 ×3 + all activities), `list-model-prices.ts`; `dataSource:
    "mock"` everywhere. Colocated unit tests.
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** onion-architecture, typescript-expert
  - **Owned paths:** `server/src/application/queries/{list-sessions,get-session,get-usage,list-model-prices}.ts`, `server/src/application/queries/{get-session,get-usage}.test.ts`
  - **Depends-on:** T15
  - **Covers:** R12, R13; API-AC-30, AC-31, AC-32, AC-33, AC-34, AC-35, AC-36, AC-37, AC-67
  - **Risk:** medium
  - **Known gotchas:** No rounding before presentation (API-AC-32). An empty period returns zeros and 30
    points. A session without costly entries has cost 0 and empty `topSteps` (edge cases).
  - **Acceptance:** server Test + Typecheck green; unit tests: median of [1,2,3,4] = 3; empty period → 30 zero points.

- **T28**
  - **Action:** Presentation core: `presentation/http/app.ts` (`buildApp(deps)`: Fastify with
    `bodyLimit: 65536`, no CORS, `/api` prefix, registers route plugins passed in, `@fastify/static` for
    `web/dist` with SPA fallback for non-`/api` GETs when the folder exists); `errors.ts` (central error
    handler: `DomainRefusal` → 409 with code/reason/message, validation → 400 with `details`, not found →
    404 naming the id, `DbUnavailableError` → 503 `db_unavailable`, anything else → 500 `internal` with a
    generic message; no stack/SQL in bodies); `validate.ts` (`parseOr400(schema, value)` with shared schemas);
    `as-of-seq.ts` (sets `X-As-Of-Seq`); `routes/healthz.ts` (API-AC-70).
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** fastify-best-practices, onion-architecture, zod, typescript-expert
  - **Owned paths:** `server/src/presentation/http/{app,errors,validate,as-of-seq}.ts`, `server/src/presentation/http/routes/healthz.ts`
  - **Depends-on:** T15
  - **Covers:** R10, R17; API-AC-1, AC-2, AC-3, AC-69 (mapping), AC-70, AC-71 (header)
  - **Risk:** medium
  - **Known gotchas:** ADR-0010: presentation must not import `infrastructure/` or `drizzle-orm`, and has
    no `z.object` of its own (ADR-0010 grep). Unknown fields → 400 (strict schemas).
  - **Acceptance:** server Typecheck green; `grep -rn "z.object" server/src/presentation` and
    `grep -rnE "infrastructure/|drizzle-orm" server/src/presentation` print nothing.

- **T29**
  - **Action:** Routes for tickets and reads under `presentation/http/routes/`: `tickets.ts` (GET list, GET
    one, POST create `201`, POST move/assign/request-changes/answer), `agents.ts`, `overview.ts`,
    `events.ts`, `sessions.ts`, `usage.ts`, `model-prices.ts`. Each handler validates → calls **one** use
    case → maps the result. GET handlers call queries only.
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** fastify-best-practices, onion-architecture, zod
  - **Owned paths:** `server/src/presentation/http/routes/{tickets,agents,overview,events,sessions,usage,model-prices}.ts`
  - **Depends-on:** T21, T22, T26, T27, T28
  - **Covers:** R11, R12, R13; API §C6 endpoints; API-AC-7…AC-37 (HTTP surface)
  - **Risk:** medium
  - **Known gotchas:** ADR-0004: GET never calls a command; bodies are validated with shared schemas. No
    business branching in handlers (ADR-0010).
  - **Acceptance:** server Typecheck green; reviewer check of the ADR-0004/0010 rules; behaviour verified by T38/T40.

- **T30**
  - **Action:** `infrastructure/sse/fan-out.ts` (implements `EventPublisher` + `EventSubscriber`; in-process
    subscriber set). `presentation/http/stream.ts`: `GET /api/stream` with `text/event-stream`,
    `Cache-Control: no-cache`, `X-Accel-Buffering: no`; parse `Last-Event-ID` (header first) or `?since=`
    as a non-negative integer (anything else = absent). Sequence: **subscribe and buffer first** → send
    `hello` → decide resync (`ahead` if N > lastSeq, `below_floor` if N < floor, `too_far_behind` if
    lastSeq − N > 5000) → else replay `seq > N` in pages → flush the buffer skipping `seq ≤ last sent` → live.
    Every event is framed `id:`/`event:`/`data:`. Keepalive every 15 s: `: keepalive` comment **plus** the
    Q1 `event: keepalive`. Clean up on close.
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** fastify-best-practices, onion-architecture, typescript-expert, architecture-decisions
  - **Owned paths:** `server/src/infrastructure/sse/**`, `server/src/presentation/http/stream.ts`
  - **Depends-on:** T28
  - **Covers:** R16; API-AC-58, AC-59, AC-60, AC-61, AC-62; DB-AC-28, DB-AC-30, DB-AC-42 (signal); R33
  - **Risk:** high
  - **Known gotchas:** ADR-0004: exactly one `text/event-stream` occurrence in `server/src`; the replay →
    live hand-over must not drop or duplicate. The `hello`/`resync`/`keepalive` messages carry no `id`, so
    the browser keeps its last id. The Vite proxy can buffer SSE — flush headers immediately. The Q1
    keepalive event is an assumed default.
  - **Acceptance:** server Typecheck green; `grep -rn "text/event-stream" server/src` prints exactly one
    line (in `stream.ts`); behaviour verified by T39.

- **T31**
  - **Action:** Simulation routes under `presentation/http/simulation/`: `GET /api/simulation`,
    `POST /api/simulation/{play,pause,step,hold}`, `POST /api/simulation/agents/:agentId/step` (§C6 shapes).
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** fastify-best-practices, onion-architecture, zod
  - **Owned paths:** `server/src/presentation/http/simulation/**`
  - **Depends-on:** T25, T26, T28
  - **Covers:** R15; API-AC-44, AC-45, AC-46, AC-54, AC-55, AC-56 (HTTP surface)
  - **Risk:** low
  - **Known gotchas:** ADR-0008 scope: steps only via POST; `hold` writes no event.
  - **Acceptance:** server Typecheck green; behaviour verified by T41.

- **T32**
  - **Action:** Composition root and entry points: `src/container.ts` (`createContainer(config)` wiring
    pg pool, repositories factory, UoW, snapshot reader, read queries, fan-out, system clock for `realAt`,
    `infrastructure/scheduler/interval-scheduler.ts` (real `setInterval`), use cases, routes;
    `createResetCommand(config)`); `src/main.ts` (load config → connect, or exit non-zero with the host:port
    message (API-AC-73) → migrate, or exit naming the migration (DB-AC-2) → acquire the server lock → load
    the fixture if empty → listen on `127.0.0.1:PORT` → Play off); `src/cli/reset.ts` (exit 1 with "Stop the
    server first" when the lock is held; exit 0 after reset). A graceful shutdown releases the lock.
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** onion-architecture, fastify-best-practices, drizzle-orm-patterns, typescript-expert, architecture-decisions
  - **Owned paths:** `server/src/container.ts`, `server/src/main.ts`, `server/src/cli/**`, `server/src/infrastructure/scheduler/**`, `server/src/infrastructure/clock/**`
  - **Depends-on:** T16, T17, T18, T19, T20, T29, T30, T31
  - **Covers:** R4, R5, R9, R17; DB-AC-1, AC-2, AC-5, AC-6, AC-7, AC-37, AC-38; API-AC-54 (boot off), AC-63, AC-64, AC-65, AC-66, AC-68, AC-73
  - **Risk:** high
  - **Known gotchas:** ADR-0010: `new …Repository(` / `new …Clock(` appear only here. Migrations run before
    `listen`. Loopback only. `DATABASE_URL` comes from the env (`node --env-file=.env` via `tsx`).
  - **Acceptance:** server Test + Typecheck green; with Docker up, `pnpm --filter @agent-ops/server start`
    then `curl -s 127.0.0.1:3000/api/healthz` → `{"ok":true,"db":"up"}`;
    `grep -rn "new .*Repository(\|new .*Clock(" server/src | grep -v container.ts | grep -v "\.test\.ts"` prints nothing.

#### Phase 2–3 test tasks (server, real Postgres)

- **T33**
  - **Action:** Integration harness `server/test/int/`: `global-setup.ts` (database name
    `agent_ops_test_${AGENT_OPS_TEST_DB_SUFFIX ?? 'default'}` from `DATABASE_URL_TEST_BASE`, created if missing
    via the admin DB, migrated once per run); `db.ts` (`freshFixture()` = TRUNCATE all + `loadFixtureIfEmpty`;
    `withTx` helpers); `app.ts` (`buildTestApp()` = real container on the test DB + Fastify `inject`, no
    server lock); `sse-client.ts` (parse a listening server's stream into messages). Wire `globalSetup` into
    the `int` project of `server/vitest.config.ts`.
  - **Module:** server
  - **Type:** test
  - **Skills to use:** backend-testing (adapt Supertest → Fastify `inject`), drizzle-orm-patterns, systematic-debugging
  - **Owned paths:** `server/test/**`, `server/vitest.config.ts`
  - **Depends-on:** T13, T20
  - **Covers:** ADR-0012 integration level; Q6
  - **Risk:** medium
  - **Known gotchas:** ADR-0012: real Postgres only, files run serially. `buildTestApp` needs `container.ts`
    (T32) — export it lazily so this task only needs T13/T20; app-level helpers are used from T38 on.
  - **Acceptance:** `pnpm --filter @agent-ops/server test:int` exits 0 with a smoke test
    `server/test/int/harness.int.test.ts` that loads the fixture and counts 6 agents;
    `grep -rnE "pg-mem|pglite" --include=*.ts --include=package.json server` prints nothing.

- **T34**
  - **Action:** Schema/migration integration tests: `server/src/infrastructure/db/migrate.int.test.ts`
    (empty DB → all tables before serving; second run changes nothing; a broken migration in a temp folder →
    error names it, earlier ones stay applied) and `schema.int.test.ts` (each constraint of DB-AC-15…22, 24,
    25, 31 rejects its bad row; `S-0416`/`S-10000` accepted; one row of every §C5 type inserts; raw
    `UPDATE`/`DELETE` on events rejected).
  - **Module:** server
  - **Type:** test
  - **Skills to use:** backend-testing, postgresql-table-design
  - **Owned paths:** `server/src/infrastructure/db/{migrate,schema}.int.test.ts`
  - **Depends-on:** T33
  - **Covers:** DB-AC-1, AC-2, AC-3, AC-4, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-24, AC-25, AC-31
  - **Risk:** low
  - **Known gotchas:** DB-AC-17 needs two **concurrent** transactions — use two pool clients.
  - **Acceptance:** `pnpm --filter @agent-ops/server test:int -- migrate schema` exits 0 with one named test per listed AC.

- **T35**
  - **Action:** Unit-of-work, journal and read-query integration tests:
    `server/src/infrastructure/db/unit-of-work.int.test.ts` (ADR-0009 check: forced throw after the state
    write leaves no state and no event; N parallel commands give strictly increasing commit-ordered `seq`;
    rolled-back create → the next committed ticket takes the previewed number; publish only after commit),
    `snapshot.int.test.ts` (snapshot + `asOfSeq` during concurrent writes; replay from it = fresh read),
    `server/src/infrastructure/repositories/events.repository.int.test.ts` (100 events, resume from the 40th
    → exactly 60; keyset pages with no skips while appending; ticket 30 / agent 16 via index (`EXPLAIN`)),
    `server/src/infrastructure/queries/queries.int.test.ts` (entries keep write order on equal `at`; usage
    `today` = 7 sessions / 4 running; per-dimension sums = fixture totals).
  - **Module:** server
  - **Type:** test
  - **Skills to use:** backend-testing, drizzle-orm-patterns, systematic-debugging
  - **Owned paths:** `server/src/infrastructure/db/{unit-of-work,snapshot}.int.test.ts`, `server/src/infrastructure/repositories/*.int.test.ts`, `server/src/infrastructure/queries/*.int.test.ts`
  - **Depends-on:** T16, T17, T18, T19, T33
  - **Covers:** DB-AC-23, AC-26, AC-27, AC-28, AC-29, AC-30, AC-32, AC-33, AC-34, AC-35, AC-36; ADR-0009 Confirmation (Q3)
  - **Risk:** medium
  - **Known gotchas:** Q3 — this file stands in for ADR-0009's `unit-of-work.test.ts`.
  - **Acceptance:** `pnpm --filter @agent-ops/server test:int -- unit-of-work snapshot events.repository queries` exits 0.

- **T36**
  - **Action:** Fixture and reset integration tests `server/src/infrastructure/fixture/fixture.int.test.ts`
    (golden counts and totals of DB-AC-8…12; MOCK-03: every session's derived totals = sum of entries;
    two loads into two DBs are identical except `real_at`, absolute `seq`, `journal_floor_seq`, `seeded_at`;
    next ticket `T-17`, next session `S-0416`) and `reset.int.test.ts` (after commands + reset: AC-8…12 hold,
    every new `seq` > old max, floor = first new `seq`; reset with the server lock held → error "Stop the
    server first", data unchanged; forced mid-reset failure → unchanged; pre-reset `seq` < floor detectable).
  - **Module:** server
  - **Type:** test
  - **Skills to use:** backend-testing, postgresql-table-design
  - **Owned paths:** `server/src/infrastructure/fixture/*.int.test.ts`
  - **Depends-on:** T33
  - **Covers:** DB-AC-6, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-39, AC-40, AC-41 (no delete outside reset — plus reviewer), AC-42
  - **Risk:** medium
  - **Known gotchas:** Cost $305.19 is rounded to cents only in the assertion. Compute it with the shared cost function.
  - **Acceptance:** `pnpm --filter @agent-ops/server test:int -- fixture reset` exits 0.

- **T37**
  - **Action:** `server/src/architecture.test.ts` — a dependency-free import scan of `server/src/**`
    that enforces the ADR-0010 allow-list per layer (domain: only domain + `import type` shared; application:
    no infrastructure/presentation/fastify/drizzle; presentation: no infrastructure/drizzle; `drizzle-orm`/`pg`/
    `db/schema` only under infrastructure (ADR-0009); simulation folder free of the ADR-0008 patterns; no
    `fetch`/web imports (ADR-0002)). Fails with file:line.
  - **Module:** server
  - **Type:** test
  - **Skills to use:** onion-architecture, architecture-decisions
  - **Owned paths:** `server/src/architecture.test.ts`
  - **Depends-on:** T32
  - **Covers:** ADR-0002, ADR-0008, ADR-0009, ADR-0010 Confirmation rules
  - **Risk:** low
  - **Known gotchas:** Exclude `*.test.ts` from the adapter-instantiation rule, as the ADR's grep does.
  - **Acceptance:** `pnpm --filter @agent-ops/server test:unit -- architecture` exits 0, and fails when an import from `infrastructure/` is added to a domain file (proved inside the test with a synthetic sample).

- **T38**
  - **Action:** HTTP command integration tests `server/src/presentation/http/routes/tickets.int.test.ts`:
    API-AC-1 (invalid body → 400 with paths, events count unchanged), AC-2 (every error parses with
    `ErrorResponse`), AC-3, AC-5 (each refused §C4 cell → its reason), AC-6, AC-7…AC-22 on the fixture
    (examples from each AC's observable note), AC-72 (two concurrent assigns of one agent → one 200 + one 409
    `agent_busy`; forced invariant breach → 500 generic).
  - **Module:** server
  - **Type:** test
  - **Skills to use:** backend-testing, fastify-best-practices, systematic-debugging
  - **Owned paths:** `server/src/presentation/http/routes/tickets.int.test.ts`
  - **Depends-on:** T32, T33
  - **Covers:** API-AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-72
  - **Risk:** medium
  - **Known gotchas:** Use the API-AC-10 table as test data (`it.each` over 20 pairs).
  - **Acceptance:** `pnpm --filter @agent-ops/server test:int -- tickets` exits 0.

- **T39**
  - **Action:** Stream tests: `server/src/presentation/http/stream.test.ts` (ADR-0004 check, unit level
    with a fake journal/subscriber: `id` = seq; resume with `Last-Event-ID: N` sends every `seq > N` exactly
    once and in order; `?since=` fallback; garbage id = absent; resync reasons) and
    `stream.int.test.ts` (listening server + real DB: `hello` fields; a command's events arrive in order;
    disconnect, commit 5 events, reconnect → exactly those 5; 50 concurrent commits during the hand-over →
    no gap and no duplicate; rolled-back command → no message; `ahead`, `below_floor` after reset,
    `too_far_behind`; keepalive within 15 s; two clients receive an event within 500 ms p95 over 100 events).
  - **Module:** server
  - **Type:** test
  - **Skills to use:** backend-testing, fastify-best-practices, systematic-debugging
  - **Owned paths:** `server/src/presentation/http/stream.test.ts`, `server/src/presentation/http/stream.int.test.ts`
  - **Depends-on:** T32, T33
  - **Covers:** API-AC-58, AC-59, AC-60, AC-61, AC-62; DB-AC-28, AC-30, AC-42; ADR-0004 Confirmation; R33
  - **Risk:** medium
  - **Known gotchas:** The keepalive test uses a 15 s budget. Inject a shorter interval through config to
    keep the suite fast, and keep one test at the real value.
  - **Acceptance:** `pnpm --filter @agent-ops/server test -- stream` exits 0 (unit + int).

- **T40**
  - **Action:** Read API integration tests `server/src/presentation/http/routes/reads.int.test.ts`:
    API-AC-23…AC-31 and AC-35…AC-37 with the fixture observables (Ready order T-13, T-11, T-10; T-12 detail;
    paging with no overlap; overview 4/6 · 1 · 2; sim-1 step reason; alpha 10 sessions; mismatch 1; S-0409
    19 entries byte-exact output; `today` 7 sessions / 4 running; 30 points; `total` 121; `dataSource`),
    AC-67 (after assigning T-10, `today` counts 8), AC-71 (`X-As-Of-Seq` on every GET; read during concurrent
    commands + replay = fresh read).
  - **Module:** server
  - **Type:** test
  - **Skills to use:** backend-testing, fastify-best-practices
  - **Owned paths:** `server/src/presentation/http/routes/reads.int.test.ts`
  - **Depends-on:** T32, T33
  - **Covers:** API-AC-23, AC-24, AC-25, AC-26, AC-27, AC-28, AC-29, AC-30, AC-31, AC-32, AC-33, AC-34, AC-35, AC-36, AC-37, AC-67, AC-71
  - **Risk:** low
  - **Known gotchas:** none
  - **Acceptance:** `pnpm --filter @agent-ops/server test:int -- reads` exits 0.

- **T41**
  - **Action:** Simulation integration tests `server/src/presentation/http/simulation/simulation.int.test.ts`:
    AC-39 (step alpha 20× → sim-1 online, 20 heartbeats, none in `/api/events`), AC-40, AC-41 (approve T-6,
    assign sim-3, next advance fails the session), AC-42, AC-43 (idle → max seq and clock unchanged), AC-44,
    AC-45 (every reason), AC-46 (alpha stops `stage_changed`), AC-47…AC-53 (scripted T-13 run, release →
    assign → refusal entry in the new session), AC-54 (play ~5 s → 3 `play` steps, with the real scheduler),
    AC-55, AC-56 (hold blocks ticks; expiry after 15 s), AC-57 (two fresh DBs, same command sequence → equal
    events except `realAt`/absolute `seq`).
  - **Module:** server
  - **Type:** test
  - **Skills to use:** backend-testing, systematic-debugging
  - **Owned paths:** `server/src/presentation/http/simulation/*.int.test.ts`
  - **Depends-on:** T32, T33
  - **Covers:** API-AC-38, AC-39, AC-40, AC-41, AC-42, AC-43, AC-44, AC-45, AC-46, AC-47, AC-48, AC-49, AC-50, AC-51, AC-52, AC-53, AC-54, AC-55, AC-56, AC-57
  - **Risk:** medium
  - **Known gotchas:** Compare relative `seq` order, not absolute values, across two databases.
  - **Acceptance:** `pnpm --filter @agent-ops/server test:int -- simulation` exits 0.

- **T42**
  - **Action:** Runtime and lifecycle integration tests `server/test/int/runtime.int.test.ts` spawning
    `src/main.ts` as a child process: clean start loads the fixture (AC-63, DB-AC-6); restart keeps a
    created ticket, nothing duplicated, Play off (AC-64, DB-AC-7, DB-AC-37, DB-AC-38); reset CLI while
    stopped → equals the clean-start snapshot modulo `seq`/`realAt` (AC-65); while running → exit 1
    "Stop the server first", data unchanged (AC-66, DB-AC-40); listens only on loopback (AC-68); DB outage
    through an in-test `node:net` TCP proxy → 503 `db_unavailable`, then 200 after the proxy resumes, no
    restart (AC-69); `/api/healthz` up/down (AC-70); missing `DATABASE_URL` / unreachable host → non-zero
    exit, message with host:port, no password, not listening (AC-73, DB-AC-5).
  - **Module:** server
  - **Type:** test
  - **Skills to use:** backend-testing, systematic-debugging
  - **Owned paths:** `server/test/int/runtime.int.test.ts`, `server/test/int/tcp-proxy.ts`
  - **Depends-on:** T32, T33
  - **Covers:** API-AC-63, AC-64, AC-65, AC-66, AC-68, AC-69, AC-70, AC-73; DB-AC-5, AC-6, AC-7, AC-37, AC-38, AC-40
  - **Risk:** medium
  - **Known gotchas:** Use a random free port per spawn. The child gets `DATABASE_URL` for the suffixed test
    DB (see *Parallelism*). `server/test/**` is owned by T33, but these two files are exclusively this
    task's and T33 is finished before it starts.
  - **Acceptance:** `pnpm --filter @agent-ops/server test:int -- runtime` exits 0.

### Phase 4 — Web UI (`web/`, runs in parallel with Phases 2–3)

- **T43**
  - **Action:** API module: `web/src/api/client.ts` (the only `fetch` caller: JSON in/out, response
    validated with shared schemas, `X-As-Of-Seq` captured into the result, error envelope → `ApiError
    {status, code, message, reason, details}`, network failure → `NetworkError`); `keys.ts` (query keys per
    resource and params); `queries.ts` (TanStack Query hooks for every read of the "Server data used per
    screen" table); `commands.ts` (mutations for every command, `isPending` exposed, nothing applied
    optimistically, U-16).
  - **Module:** web
  - **Type:** ui
  - **Skills to use:** react-best-practices, zod, typescript-expert, architecture-decisions
  - **Owned paths:** `web/src/api/{client,keys,queries,commands}.ts`
  - **Depends-on:** T10
  - **Covers:** R19, R20; UI-AC-7, UI-AC-20, UI-AC-21, UI-AC-22 (pending state), UI-AC-24 (asOfSeq capture)
  - **Risk:** medium
  - **Known gotchas:** ADR-0011: only `web/src/api/**` calls `fetch`/`EventSource`; no `z.object` in
    `web/src`. Use the same-origin `/api` (dev proxy).
  - **Acceptance:** web Typecheck green; `grep -rnE "fetch\(|new EventSource" web/src | grep -v "web/src/api/"` and `grep -rn "z.object" web/src` print nothing.

- **T44**
  - **Action:** `web/src/api/stream.ts` — one `EventSource('/api/stream')` per tab; parses `hello`, events,
    `resync`, `keepalive` with shared schemas; tracks `lastAppliedSeq`; 30 s watchdog on any message incl.
    `keepalive` (Q1) and `onerror` → status `lost`; manual reconnect with `?since=<lastAppliedSeq>`;
    `connected` only after replay reaches `hello.lastSeq`; exposes `useConnection()`.
    `web/src/api/eventCache.ts` — `applyEvent(queryClient, event)`: a mapping for **every** `EventType`
    (patch where the payload suffices — Simulation clock from `simulation.stepped`, Play from
    `play_changed`, feed lists; else `invalidateQueries` on the affected keys); skip events with `seq ≤` the
    query's `asOfSeq` and duplicates (UI-AC-24); `resync` → refetch active, remove inactive.
  - **Module:** web
  - **Type:** ui
  - **Skills to use:** react-best-practices, typescript-expert, architecture-decisions
  - **Owned paths:** `web/src/api/{stream,eventCache}.ts`
  - **Depends-on:** T43
  - **Covers:** R20, R33; UI-AC-23, AC-24, AC-25 (clock source), AC-29, AC-31, AC-32, AC-103 (no feed insertion of non-feed types)
  - **Risk:** high
  - **Known gotchas:** ADR-0011: every event type needs a mapping (the T58 test iterates the enum). The
    browser `EventSource` never shows comments (Q1). Its own auto-reconnect resends `Last-Event-ID`; the
    manual reconnect must use `?since=`. Only the connection watchdog and toasts may run timers (SPEC-web-ui
    *Non-functional*).
  - **Acceptance:** web Typecheck green; ADR-0011 greps as in T43 print nothing.

- **T45**
  - **Action:** Design-system controls in `web/src/ui/`: `Button` (default/primary/sm/disabled-with-reason
    as `aria-disabled` + accessible description + visible tooltip, U-9), `Segmented` (`aria-pressed`),
    `Select`, `Checkbox`, `TextField`/`TextArea` (label, required `*` in `--attn-ink`, error `role="alert"`,
    length counter at the limit), `Modal`/`AlertDialog` (scrim, `aria-modal`, labelled by title, focus trap,
    Escape, focus return — UI-AC-52), `ToastRegion` + `useToast` (`aria-live="polite"`, 3.4 s, newest
    replaces, UI-AC-18), `Tooltip`. Each with `*.module.css` using tokens only; hit area ≥ 40 px (44 px primary, UI-AC-133).
  - **Module:** web
  - **Type:** ui
  - **Skills to use:** react-best-practices, frontend-architecture, typescript-expert
  - **Owned paths:** `web/src/ui/controls/**`, `web/src/ui/overlay/**`
  - **Depends-on:** T10
  - **Covers:** R19, R23, R30; UI-AC-18 (mechanics), AC-52, AC-131 (focus ring), AC-133, AC-134, AC-135 (no animation under reduced motion); U-9, U-18
  - **Risk:** medium
  - **Known gotchas:** ADR-0011: no colour literals in `*.module.css`. Square corners, 1 px borders, focus
    `2px solid var(--live)` offset 2 px (components.md).
  - **Acceptance:** web Typecheck green; `grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(" web/src --include=*.module.css` prints nothing.

- **T46**
  - **Action:** Data-display and domain components in `web/src/ui/display/`: `KpiTile`, `PriorityBars`,
    `StageStepper` (UI-AC-96), `HealthBadge`, `CurrentActionBox` (UI-AC-97 states, pulse only while playing
    and not under reduced motion, UI-AC-98), `SourceMark` (UI-AC-104), `EventRow` (summary verbatim as plain
    text, fallback `type`, warn style, UI-AC-105), `DataTable` (sortable header buttons with `aria-sort`,
    whole-row click + first-cell link, pager), `BreakdownList`, `BarChart` (SVG, 30 bars, gridlines,
    tooltip, accessible description), `MockBanner`/`MockTag`. `web/src/lib/`: `format.ts` (UTC `hh:mm:ss`,
    `Today`/`Mon D`, money `$x.xx`, tokens `x.xK`/`x.xxM`, ages `12S`/`4M`/`2H`, durations, `m:ss`; all from
    a passed sim-clock value, never `Date.now()`), `labels.ts` (enum → display names, status numbers `01`…`05`, stage badges `00`…`04`).
  - **Module:** web
  - **Type:** ui
  - **Skills to use:** react-best-practices, frontend-architecture, typescript-expert
  - **Owned paths:** `web/src/ui/display/**`, `web/src/lib/**`
  - **Depends-on:** T10
  - **Covers:** R26, R30; UI-AC-25, AC-26 (render server health), AC-96, AC-97, AC-98, AC-104, AC-105, AC-132, AC-138; U-15
  - **Risk:** medium
  - **Known gotchas:** Render untrusted text only as text, never `dangerouslySetInnerHTML` (SPEC-web-ui
    *Untrusted inputs*). Every state has a glyph or word (NFR-06). Format times with `timeZone: 'UTC'`.
  - **Acceptance:** web Typecheck green; `grep -rn "dangerouslySetInnerHTML\|Date.now()" web/src` prints nothing.

- **T47**
  - **Action:** `web/src/features/simulation/`: `SimulationPanel` (label, `▶ PLAY`/`Ⅱ PAUSE` with
    `aria-pressed`, `STEP` disabled with "Pause to step manually" while playing, clock `hh:mm:ss` with a
    square dot, state only from server data, UI-AC-6…8) and `useSimulationHold(active)` (stable per-tab
    clientId, hold on, renew every 10 s, release on end, UI-AC-9).
  - **Module:** web
  - **Type:** ui
  - **Skills to use:** react-best-practices, frontend-architecture, architecture-decisions
  - **Owned paths:** `web/src/features/simulation/**` (except `*.test.tsx`)
  - **Depends-on:** T44, T45
  - **Covers:** R18; UI-AC-6, AC-7, AC-8, AC-9; U-3
  - **Risk:** low
  - **Known gotchas:** ADR-0008: the UI only requests steps/play and never simulates. The panel updates from
    the event, not optimistically.
  - **Acceptance:** web Typecheck green.

- **T48**
  - **Action:** App shell `web/src/app/`: `App.tsx` + router (routes of SPEC-web-ui table, `/` → `/board`,
    `*` → Not found, UI-AC-16); `providers.tsx` (QueryClient, stream start, toast, theme, connection,
    `ActionGate` context that disables every data-changing control with «Reconnecting — actions are paused»,
    UI-AC-30); `AppHeader` (brand, `PrimaryNav` with `aria-current`, blocked badge, `MOCK` tag, Simulation
    panel, theme toggle, `LOCAL · NO AUTH`; UI-AC-1…5); theme (OS preference until toggled, persisted in
    `localStorage`, `data-theme` on root, UI-AC-5, AC-136); visit history (≤ 30, no duplicate of the
    current route, nav clears it, UI-AC-4, AC-11, AC-12) + `BackBar` + `Breadcrumbs` (UI-AC-10, AC-13);
    `ConnectionBanner` (`role="status"`, UI-AC-29); `ScreenFrame` with `LOADING…` and «Couldn’t load <screen>
    — the server is not responding.» + `Retry` (UI-AC-27, AC-28); `EntityNotFound` (UI-AC-17); route
    placeholders for screens. Update `web/src/main.tsx` to render `App`.
  - **Module:** web
  - **Type:** ui
  - **Skills to use:** react-best-practices, frontend-architecture, typescript-expert
  - **Owned paths:** `web/src/app/**` (except `*.test.tsx`), `web/src/main.tsx`, `web/src/features/{board,ticket,mission-control,agent,usage,session-log}/index.tsx` (one-line placeholders, overwritten later by T51–T56)
  - **Depends-on:** T44, T45, T46, T47
  - **Covers:** R18, R20; UI-AC-1, AC-2, AC-3, AC-4, AC-5, AC-10, AC-11, AC-12, AC-13, AC-14 (state lives outside the cache), AC-16, AC-17, AC-27, AC-28, AC-29, AC-30, AC-136, AC-137 (layout frame); U-5
  - **Risk:** medium
  - **Known gotchas:** ADR-0011: UI-only state (filters, dialogs, theme, history) lives in React state/context,
    not in the query cache. `app/routes.tsx` lazy-imports `features/<x>/index.tsx` for each screen. This task
    creates those six files as one-line placeholders, so T51–T56 never edit `web/src/app/**`. Each
    screen task overwrites its own `index.tsx` after T48 is done (no concurrent ownership).
  - **Acceptance:** web Typecheck + Test green; `pnpm --filter @agent-ops/web build` exits 0.

- **T49**
  - **Action:** `web/src/features/moves/`: `moveReaction.ts` (from shared `operatorTransition` → `command
    | assignModal | releaseConfirm | markDoneConfirm | reopenConfirm | requestChangesModal | refused(reason)` +
    UI drop-hint copy of the SPEC-web-ui table), `useMoveTicket()` (one orchestrator for drag and Move
    buttons: never a request for refused cells, `expectedStatus` = shown status, `confirmed: true` only from
    the confirm button, toasts per UI-AC-18/19/20/51, holds the simulation while a modal is open), modals
    `AssignModal` (UI-AC-54…57), `ReleaseConfirm` (AC-58), `MarkDoneConfirm` (AC-59 incl. « The block is
    cleared.»), `ReopenConfirm` (AC-60), `RequestChangesModal` (AC-61, AC-69), stale-modal guard (AC-53),
    `NewTicketModal` (AC-88…90, next id from `SimulationState.nextTicketId`).
  - **Module:** web
  - **Type:** ui
  - **Skills to use:** react-best-practices, frontend-architecture, typescript-expert
  - **Owned paths:** `web/src/features/moves/**` (except `*.test.tsx`)
  - **Depends-on:** T43, T45, T46, T47
  - **Covers:** R19, R22, R23; UI-AC-18, AC-19, AC-20, AC-21, AC-22, AC-34 (form text kept), AC-45, AC-48, AC-51, AC-52, AC-53, AC-54, AC-55, AC-56, AC-57, AC-58, AC-59, AC-60, AC-61, AC-69 (modal entry point), AC-88, AC-89, AC-90; D-1, D-2, D-3, D-4, D-14, U-2
  - **Risk:** high
  - **Known gotchas:** Follow the SPEC table, **not** the prototype (D-1…D-4, U-2). The all-busy text must
    not mention Review (D-14). Server refusal text: `reason` if present, else `message`. Keep typed text on failure.
  - **Acceptance:** web Typecheck green.

- **T50**
  - **Action:** `web/src/features/console/`: `AgentConsole({ticketId})` — tabs for the 5 newest sessions
    (`role="tab"`, `●` running), default tab rule + per-ticket choice kept in app state (UI-AC-77/78), meta
    line, terminal (`role="log"`, label «Agent console», `tabindex=0`, `--console-*` colours in both themes),
    entry rendering per UI-AC-80 (full output, horizontal scroll), tail line (AC-81), step buttons /
    hints (AC-82…84), Next step / Run to next stage (AC-85, both disabled in flight), stick-to-bottom +
    `↓ NEW LINES` (AC-86, U-11), empty state (AC-87).
  - **Module:** web
  - **Type:** ui
  - **Skills to use:** react-best-practices, frontend-architecture, typescript-expert
  - **Owned paths:** `web/src/features/console/**` (except `*.test.tsx`)
  - **Depends-on:** T43, T46
  - **Covers:** R25; UI-AC-77, AC-78, AC-79, AC-80, AC-81, AC-82, AC-83, AC-84, AC-85, AC-86, AC-87; U-4, U-11
  - **Risk:** medium
  - **Known gotchas:** Show `step.reason` verbatim (never computed). Show «Waiting for your review» for
    every Review ticket even after the session ended (U-4). Failed rows differ by tag text, not only colour.
  - **Acceptance:** web Typecheck green.

- **T51**
  - **Action:** `web/src/features/board/`: Board screen — title, KPIs (UI-AC-35), five columns with
    counts, ordering from the server list (AC-36), empty texts (AC-37), `TicketCard` (AC-38…41: one focus
    stop, Enter/click opens), filters + hint + `Clear filters` (AC-42), `+ New ticket` (AC-43, uses T49's
    modal), footer copy (AC-44, D-15), native HTML5 drag & drop with `moveReaction` hints, 35 % dragging
    card, accepting/refusing column styles, 3 px ring on hover, drop outside/home = nothing, every visible
    card draggable incl. Done, hold while dragging (AC-46…50), toasts via `useMoveTicket`.
  - **Module:** web
  - **Type:** ui
  - **Skills to use:** react-best-practices, frontend-architecture, typescript-expert
  - **Owned paths:** `web/src/features/board/**` (except `*.test.tsx`)
  - **Depends-on:** T48, T49
  - **Covers:** R21, R22; UI-AC-33 (card `UPDATED`), AC-35, AC-36, AC-37, AC-38, AC-39, AC-40, AC-41, AC-42, AC-43, AC-44, AC-46, AC-47, AC-48, AC-49, AC-50, AC-51; D-10, D-15, U-1, U-14, U-17
  - **Risk:** medium
  - **Known gotchas:** Done cards are draggable (U-1). Filters live in UI state and are never reset by
    events or navigation (UI-AC-14). `UPDATED` = last change ≤ 7 s of **simulation** time.
  - **Acceptance:** web Typecheck green.

- **T52**
  - **Action:** `web/src/features/ticket/`: Ticket page — badges incl. `■ JUST UPDATED` (UI-AC-62, AC-33),
    description and criteria (AC-63), Blocked panel + answer (AC-64, AC-65), Review panel + approve +
    inline request changes (AC-66…AC-69), returned/answered notes (AC-70), `C — Move` buttons through
    `useMoveTicket` with `aria-disabled` reasons (AC-71), move note (AC-72, D-15), `Who is on it` (AC-73,
    AC-74), `Sessions & cost` with `MOCK` (AC-75), `Activity` oldest-first of the newest 30 (AC-76), and
    `D — Agent console` (T50).
  - **Module:** web
  - **Type:** ui
  - **Skills to use:** react-best-practices, frontend-architecture, typescript-expert
  - **Owned paths:** `web/src/features/ticket/**` (except `*.test.tsx`)
  - **Depends-on:** T48, T49, T50
  - **Covers:** R24; UI-AC-33, AC-34, AC-62, AC-63, AC-64, AC-65, AC-66, AC-67, AC-68, AC-69, AC-70, AC-71, AC-72, AC-73, AC-74, AC-75, AC-76; U-9, U-14
  - **Risk:** medium
  - **Known gotchas:** `RESULT <link>` is plain text, never a link (Untrusted inputs). The server returns
    activity newest first; reverse it for display (web-ui open question, default).
  - **Acceptance:** web Typecheck green.

- **T53**
  - **Action:** `web/src/features/mission-control/`: KPIs + 12-bar sparkline (UI-AC-91), health legend
    from `healthThresholds` (AC-92, U-6), agent cards (AC-93, AC-94, D-8 `MOCK`), Offline last and dimmed
    (AC-95, PDR-0010), Event Log (AC-99…AC-102: newest 40, source segmented + category select, `Show 40
    more` via `beforeSeq`, pause/resume with held-event banner), feed-only rule (AC-103).
  - **Module:** web
  - **Type:** ui
  - **Skills to use:** react-best-practices, frontend-architecture, typescript-expert
  - **Owned paths:** `web/src/features/mission-control/**` (except `*.test.tsx`)
  - **Depends-on:** T48
  - **Covers:** R26; UI-AC-91, AC-92, AC-93, AC-94, AC-95, AC-99, AC-100, AC-101, AC-102, AC-103; D-8, D-13, U-6, U-8
  - **Risk:** medium
  - **Known gotchas:** Q2 — 43 feed events in the fixture. The paused banner counts all new events (open
    question default). Agent order = server order, with Offline moved last.
  - **Acceptance:** web Typecheck green.

- **T54**
  - **Action:** `web/src/features/agent/`: Agent page — header badges and buttons, KPIs with
    `Cost · 7d (mock)` → `/usage` (UI-AC-106), Said vs did from `saidVsDid` (AC-107, U-7), Sessions table of
    10 (AC-108), Tickets list (AC-109).
  - **Module:** web
  - **Type:** ui
  - **Skills to use:** react-best-practices, frontend-architecture
  - **Owned paths:** `web/src/features/agent/**` (except `*.test.tsx`)
  - **Depends-on:** T48
  - **Covers:** R27; UI-AC-106, AC-107, AC-108, AC-109; U-7
  - **Risk:** low
  - **Known gotchas:** The UI never computes mismatches (AC-107). Subtitle «reported», not «over MCP» (U-7).
  - **Acceptance:** web Typecheck green.

- **T55**
  - **Action:** `web/src/features/usage/`: Usage & Cost — banner + period control defaulting to `30 DAYS`
    (UI-AC-110), period-driven reads and 12-row reset (AC-111, AC-119), KPIs (AC-112), empty state without
    «press Play» while playing (AC-113, D-6), cost-per-day chart with sim-clock labels (AC-114, U-13), model
    prices with row → Model filter (AC-115), breakdowns (AC-116, U-12), sessions table with sort/filters/pager/
    footnote (AC-117…AC-120).
  - **Module:** web
  - **Type:** ui
  - **Skills to use:** react-best-practices, frontend-architecture
  - **Owned paths:** `web/src/features/usage/**` (except `*.test.tsx`)
  - **Depends-on:** T48
  - **Covers:** R28; UI-AC-110, AC-111, AC-112, AC-113, AC-114, AC-115, AC-116, AC-117, AC-118, AC-119, AC-120; D-6, U-12, U-13
  - **Risk:** medium
  - **Known gotchas:** Shares come as fractions 0…1 → format as percent. Period/sort/filters survive
    navigation but not reloads (UI-AC-14, open question default).
  - **Acceptance:** web Typecheck green.

- **T56**
  - **Action:** `web/src/features/session-log/`: Session Log — breadcrumb bar with MOCK, header and running
    note (UI-AC-121), token cells + COST (AC-122), Where the tokens went with row → filter (AC-123), type
    filters + search (AC-124), error cursor (AC-125, AC-126, D-9, U-10), entry rendering (AC-127), 4-line
    collapse (AC-128), aside (AC-129), live append (AC-130), reset of filter/search/expanded/cursor when the
    session changes (AC-15).
  - **Module:** web
  - **Type:** ui
  - **Skills to use:** react-best-practices, frontend-architecture
  - **Owned paths:** `web/src/features/session-log/**` (except `*.test.tsx`)
  - **Depends-on:** T48
  - **Covers:** R29; UI-AC-15, AC-121, AC-122, AC-123, AC-124, AC-125, AC-126, AC-127, AC-128, AC-129, AC-130; D-9, U-10
  - **Risk:** medium
  - **Known gotchas:** Without errors, both arrows are `aria-disabled` (D-9). The error jump clears the search
    (U-10). A 1 000-entry session must render its first screen < 1 s — avoid re-rendering every row on
    each event (memoise rows by index).
  - **Acceptance:** web Typecheck green.

#### Phase 4 test tasks (web, Vitest + RTL)

- **T57**
  - **Action:** Web test harness `web/src/test/`: `fakeNetwork.ts` (stubs `globalThis.fetch` per
    method+path with shared-schema-validated responses incl. `X-As-Of-Seq`, records requests),
    `FakeEventSource.ts` (installs on `globalThis`; `emitHello`, `emitEvent`, `emitResync`, `emitKeepalive`,
    `fail`), `fixtures.ts` (builders for the seed-like state used by the specs' observables: T-1…T-16, six
    agents, S-0409/S-0412 details, 44 events), `renderApp.tsx` (real `QueryClient` + app providers + memory
    router at a route), `user.ts` (`userEvent.setup`). Keep `setup.ts` from T04.
  - **Module:** web
  - **Type:** test
  - **Skills to use:** react-testing-library, typescript-expert
  - **Owned paths:** `web/src/test/**`
  - **Depends-on:** T48
  - **Covers:** ADR-0012 component level (API module stubbed at the network boundary)
  - **Risk:** medium
  - **Known gotchas:** Validate every fake response with the shared schemas, so fakes can't drift from the
    contract. Use fake timers only for the toast, the watchdog and the hold renewal.
  - **Acceptance:** web Test + Typecheck green with a smoke test `web/src/test/harness.test.tsx` that renders `/board` from the fakes.

- **T58**
  - **Action:** API-layer tests: `web/src/api/eventCache.test.ts` (ADR-0011 check: iterates
    `EventType.options` and asserts every type has a mapping; `resync` invalidates all; UI-AC-24 `asOfSeq`
    50 + events 49…52 → only 51/52 applied, duplicate ignored; UI-AC-103 non-feed types never become feed
    rows), `client.test.ts` (error envelope → `ApiError` incl. `details`; network failure),
    `stream.test.ts` (watchdog 30 s incl. keepalive; banner state within 2 s; reconnect with `?since=`;
    `connected` only after `hello.lastSeq`; resync).
  - **Module:** web
  - **Type:** test
  - **Skills to use:** react-testing-library, typescript-expert
  - **Owned paths:** `web/src/api/*.test.ts`
  - **Depends-on:** T57
  - **Covers:** UI-AC-23, AC-24, AC-29, AC-31, AC-32, AC-103; ADR-0011 Confirmation
  - **Risk:** low
  - **Known gotchas:** none
  - **Acceptance:** `pnpm --filter @agent-ops/web test -- src/api` exits 0.

- **T59**
  - **Action:** RTL tests for the shell, UI kit and simulation panel: `web/src/app/**/*.test.tsx`,
    `web/src/ui/**/*.test.tsx`, `web/src/features/simulation/**/*.test.tsx` — header on each route (AC-1),
    `aria-current` per route group (AC-2), blocked badge (AC-3), nav clears history (AC-4), theme toggle
    labels and accessible name (AC-5), simulation panel states and non-optimistic update (AC-6, AC-7, AC-8),
    hold on/renew/release with fake timers (AC-9), back label + breadcrumb links (AC-10, AC-11, AC-13),
    history cap 30 (AC-12), filters untouched by events/navigation (AC-14), not found (AC-16, AC-17),
    toast region (AC-18), network-failure toast (AC-21), loading/error frames (AC-27, AC-28), connection
    banner + disabled actions with reason, navigation still works (AC-29, AC-30), modal focus trap (AC-52),
    form-control labels/required/alert (AC-134), reduced-motion class (AC-135), theme from OS + persistence (AC-136).
  - **Module:** web
  - **Type:** test
  - **Skills to use:** react-testing-library
  - **Owned paths:** `web/src/app/**/*.test.tsx`, `web/src/ui/**/*.test.tsx`, `web/src/features/simulation/**/*.test.tsx`
  - **Depends-on:** T57
  - **Covers:** UI-AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-16, AC-17, AC-18, AC-21, AC-27, AC-28, AC-29, AC-30, AC-52, AC-134, AC-135, AC-136
  - **Risk:** low
  - **Known gotchas:** ADR-0012: queries by role/label/text; no `querySelector`, no snapshot-only tests.
  - **Acceptance:** web Test green; `grep -rnE "querySelector|toMatchSnapshot" web/src --include=*.test.tsx` prints nothing.

- **T60**
  - **Action:** RTL tests for Board + moves: `web/src/features/board/**/*.test.tsx`,
    `web/src/features/moves/**/*.test.tsx` — table-driven `moveReaction` over all 20 cells incl. hints
    (AC-45), no request on refused cells + toast (AC-19), server refusal text (AC-20), in-flight disable
    (AC-22), KPIs and counts 16 · 3 · 1 / 3·3·3·2·5 (AC-35), order (AC-36), empty texts (AC-37), card content
    (AC-38…40), focus/Enter (AC-41), filters (AC-42), modal open (AC-43), footer (AC-44), drag hints/styles via
    `fireEvent.drag*` (AC-46…50), toasts (AC-18, AC-51), modals (AC-53…61), new ticket (AC-88…90), typed text
    kept on event (AC-34), `UPDATED` window (AC-33).
  - **Module:** web
  - **Type:** test
  - **Skills to use:** react-testing-library
  - **Owned paths:** `web/src/features/board/**/*.test.tsx`, `web/src/features/moves/**/*.test.tsx`
  - **Depends-on:** T57, T51
  - **Covers:** UI-AC-18, AC-19, AC-20, AC-22, AC-33, AC-34, AC-35, AC-36, AC-37, AC-38, AC-39, AC-40, AC-41, AC-42, AC-43, AC-44, AC-45, AC-46, AC-47, AC-48, AC-49, AC-50, AC-51, AC-53, AC-54, AC-55, AC-56, AC-57, AC-58, AC-59, AC-60, AC-61, AC-88, AC-89, AC-90
  - **Risk:** medium
  - **Known gotchas:** HTML5 DnD in jsdom needs a hand-built `DataTransfer`. Real-browser drag is covered by T65.
  - **Acceptance:** `pnpm --filter @agent-ops/web test -- features/board features/moves` exits 0.

- **T61**
  - **Action:** RTL tests for the ticket page + console: `web/src/features/ticket/**/*.test.tsx`,
    `web/src/features/console/**/*.test.tsx` — UI-AC-62…AC-76 and AC-77…AC-87 with the T-12, T-8, T-7, T-1,
    T-14, T-15, T-10 observables; refused Move button announces its reason (AC-71); console stick-to-bottom
    logic (AC-86); one entry appended per streamed `log.appended` (AC-85).
  - **Module:** web
  - **Type:** test
  - **Skills to use:** react-testing-library
  - **Owned paths:** `web/src/features/ticket/**/*.test.tsx`, `web/src/features/console/**/*.test.tsx`
  - **Depends-on:** T57, T52
  - **Covers:** UI-AC-62, AC-63, AC-64, AC-65, AC-66, AC-67, AC-68, AC-69, AC-70, AC-71, AC-72, AC-73, AC-74, AC-75, AC-76, AC-77, AC-78, AC-79, AC-80, AC-81, AC-82, AC-83, AC-84, AC-85, AC-86, AC-87
  - **Risk:** low
  - **Known gotchas:** none
  - **Acceptance:** `pnpm --filter @agent-ops/web test -- features/ticket features/console` exits 0.

- **T62**
  - **Action:** RTL tests for Mission Control + Agent page: `web/src/features/mission-control/**/*.test.tsx`,
    `web/src/features/agent/**/*.test.tsx` — AC-91…AC-109; the six current-action states (AC-97); pulse rule
    (AC-98); source marks and `—` System (AC-104); summary verbatim, `type` fallback, claim vs assignment
    (AC-105); Event Log second page = feed count − 40 (= 3 on the fixture, Q2) (AC-101); pause banner (AC-102);
    stage stepper (AC-96); server health shown as-is (AC-26); relative times from the sim clock (AC-25).
  - **Module:** web
  - **Type:** test
  - **Skills to use:** react-testing-library
  - **Owned paths:** `web/src/features/mission-control/**/*.test.tsx`, `web/src/features/agent/**/*.test.tsx`
  - **Depends-on:** T57, T53, T54
  - **Covers:** UI-AC-25, AC-26, AC-91, AC-92, AC-93, AC-94, AC-95, AC-96, AC-97, AC-98, AC-99, AC-100, AC-101, AC-102, AC-103, AC-104, AC-105, AC-106, AC-107, AC-108, AC-109
  - **Risk:** low
  - **Known gotchas:** Q2.
  - **Acceptance:** `pnpm --filter @agent-ops/web test -- features/mission-control features/agent` exits 0.

- **T63**
  - **Action:** RTL tests for Usage & Cost + Session Log: `web/src/features/usage/**/*.test.tsx`,
    `web/src/features/session-log/**/*.test.tsx` — AC-110…AC-130 and AC-15; S-0409 (2 errors, ↓ twice
    cycles, collapse of the long output), S-0412 (`NO ERRORS`, running note); chart labels SEP 25 / OCT 4 /
    OCT 14 / TODAY; UTC rendering with `TZ=America/Los_Angeles` (AC-138).
  - **Module:** web
  - **Type:** test
  - **Skills to use:** react-testing-library
  - **Owned paths:** `web/src/features/usage/**/*.test.tsx`, `web/src/features/session-log/**/*.test.tsx`
  - **Depends-on:** T57, T55, T56
  - **Covers:** UI-AC-15, AC-110, AC-111, AC-112, AC-113, AC-114, AC-115, AC-116, AC-117, AC-118, AC-119, AC-120, AC-121, AC-122, AC-123, AC-124, AC-125, AC-126, AC-127, AC-128, AC-129, AC-130, AC-138
  - **Risk:** low
  - **Known gotchas:** none
  - **Acceptance:** `pnpm --filter @agent-ops/web test -- features/usage features/session-log` exits 0.

### Phase 5 — End to end, docs, benchmarks

- **T64**
  - **Action:** Playwright harness: finish `web/playwright.config.ts` (Chromium, `workers: 1`,
    `globalSetup` builds `web/dist`); `web/e2e/fixtures/server.ts` — a worker fixture that, per spec file,
    picks a free port and the DB `agent_ops_e2e_${AGENT_OPS_TEST_DB_SUFFIX ?? 'default'}`, runs the reset
    CLI (server stopped), spawns `pnpm --filter @agent-ops/server start` with that env, waits for
    `/api/healthz`, exposes `baseURL`, `stopServer()`, `startServer()`, `resetDb()`; `web/e2e/fixtures/pages.ts`
    (page helpers by role). A smoke spec `web/e2e/smoke.spec.ts` opens `/board`.
  - **Module:** web
  - **Type:** test
  - **Skills to use:** systematic-debugging, react-testing-library (queries by role), typescript-expert
  - **Owned paths:** `web/playwright.config.ts`, `web/e2e/fixtures/**`, `web/e2e/smoke.spec.ts`
  - **Depends-on:** T32, T48
  - **Covers:** ADR-0012 e2e level (real server + test DB)
  - **Risk:** medium
  - **Known gotchas:** Reset refuses while the server runs (API-AC-66), so always stop → reset → start. The
    server serves `web/dist` (T28) — build first.
  - **Acceptance:** `pnpm --filter @agent-ops/web e2e -- smoke` exits 0; `ls web/e2e web/playwright.config.ts` succeeds.

- **T65**
  - **Action:** Core e2e flows (ADR-0012 list):
    `web/e2e/flow-keyboard.spec.ts` — keyboard only: create a ticket → Move to Ready → Move to In Progress… →
    pick charlie → Next step / Run to next stage until Review → Approve (UI-AC-131, AC-90, AC-55, AC-67, AC-85,
    AC-130 S-log grows, AC-7 STEP advances the clock once);
    `release.spec.ts` — real-browser drag T-12 shows hints, drop on Ready → confirm → toast, Activity shows the
    Operator event (UI-AC-46, AC-48, AC-58, AC-55 event text);
    `two-tabs.spec.ts` — assign in tab A appears in tab B (AC-23); open Assign modal in B while A assigns
    → modal closes with the stale toast (AC-53) / busy refusal text (AC-20); Assign rows update live (AC-57);
    hold: with Play on, the clock does not advance for 30 s while a modal is open, then resumes (AC-9);
    `reconnect.spec.ts` — stop server → banner within 2 s + actions disabled (AC-29, AC-30), commands
    fail → «Couldn’t reach the server — try again.» (AC-21); start server, events from the outage appear once
    (AC-31); stop → reset → start → open tab shows the clean fixture (AC-32); stopped before load → error +
    Retry (AC-28).
  - **Module:** web
  - **Type:** test
  - **Skills to use:** systematic-debugging, react-testing-library
  - **Owned paths:** `web/e2e/{flow-keyboard,release,two-tabs,reconnect}.spec.ts`
  - **Depends-on:** T64, T51, T52, T53
  - **Covers:** UI-AC-7, AC-9, AC-20, AC-21, AC-23, AC-28, AC-29, AC-30, AC-31, AC-32, AC-46, AC-48, AC-53, AC-55, AC-57, AC-58, AC-67, AC-85, AC-90, AC-130, AC-131; NFR-01 (latency sample)
  - **Risk:** high
  - **Known gotchas:** Avoid sleeps: wait on DOM state or on stream messages. The 30 s hold check is the
    slowest test — tag it `@slow`.
  - **Acceptance:** `pnpm --filter @agent-ops/web e2e -- flow-keyboard release two-tabs reconnect` exits 0.

- **T66**
  - **Action:** Environment and accessibility e2e: `web/e2e/a11y.spec.ts` (axe on every route in light
    and dark: zero serious/critical; NFR a11y, AC-134), `theme.spec.ts` (`colorScheme: dark` default, toggle,
    reload keeps choice — AC-5, AC-136), `time.spec.ts` (`timezoneId: 'America/Los_Angeles'` → header 14:32:00,
    chart ends TODAY = Oct 24 — AC-138; Mission Control open with Play off, DOM unchanged for 60 s — AC-25),
    `layout.spec.ts` (1280 px usable, 1024 px board scrolls horizontally — AC-137; interactive bounding boxes
    ≥ 40/44 px — AC-133; `reducedMotion: 'reduce'` → no animations — AC-135), `navigation.spec.ts`
    (Board → T-12 → alpha → S-0412, Back ×3 — AC-11; filters survive navigation and steps — AC-14; `/nope`,
    `/tickets/T-999` — AC-16, AC-17; MC card click targets — AC-94; Usage period change and row click —
    AC-111, AC-120; Event Log pause → step 3× → banner N → resume — AC-102; console scroll — AC-86).
  - **Module:** web
  - **Type:** test
  - **Skills to use:** systematic-debugging, react-testing-library
  - **Owned paths:** `web/e2e/{a11y,theme,time,layout,navigation}.spec.ts`
  - **Depends-on:** T64, T51, T52, T53, T54, T55, T56
  - **Covers:** UI-AC-5, AC-11, AC-14, AC-16, AC-17, AC-25, AC-86, AC-94, AC-102, AC-111, AC-120, AC-133, AC-134, AC-135, AC-136, AC-137, AC-138, AC-132 (greyscale screenshots attached for reviewer)
  - **Risk:** medium
  - **Known gotchas:** The axe scan uses `@axe-core/playwright` (installed in T01). Don't add packages.
  - **Acceptance:** `pnpm --filter @agent-ops/web e2e -- a11y theme time layout navigation` exits 0.

- **T67**
  - **Action:** Documentation: fill `docs/architecture/README.md` (system context, the Modules table
    mirroring AGENTS.md, Mermaid diagrams for the command flow and the reconnect flow, cross-cutting concerns
    linking ADRs) and add a "Run locally" section to `README.md` (`docker compose up -d`, `cp .env.example
    .env`, `pnpm install`, `pnpm --filter @agent-ops/server dev`, `pnpm --filter @agent-ops/web dev`, reset,
    tests).
  - **Module:** root docs
  - **Type:** docs
  - **Skills to use:** mermaid-diagram, architecture-decisions
  - **Owned paths:** `docs/architecture/**`, `README.md`
  - **Depends-on:** T32, T48
  - **Covers:** R1 (operability), ADR index references
  - **Risk:** low
  - **Known gotchas:** Document what was built; do not restate the specs.
  - **Acceptance:** Mermaid blocks render (mermaid.live check by reviewer); every command in "Run locally" exits 0 on a clean clone.

- **T68**
  - **Action:** Benchmarks `server/bench/`: a script that seeds fixture ×10 + 100 000 events + one
    1 000-entry session into a bench database (suffixed) and reports p95 for NFR-DB-1…6 and the
    SPEC-server-api latency budgets (commands, reads, usage, session detail, run-to-next-stage < 4 s,
    20 stream connections without loss). Report only; no CI gate.
  - **Module:** server
  - **Type:** test
  - **Skills to use:** postgresql-table-design, drizzle-orm-patterns, systematic-debugging
  - **Owned paths:** `server/bench/**`
  - **Depends-on:** T32
  - **Covers:** R32; NFR-DB-1, NFR-DB-2, NFR-DB-3, NFR-DB-4, NFR-DB-5, NFR-DB-6; SPEC-server-api latency/throughput
  - **Risk:** low
  - **Known gotchas:** Use a separate database. Never point the bench at `agent_ops`.
  - **Acceptance:** `pnpm --filter @agent-ops/server bench` prints a table with one p95 row per budget; results are pasted into the PR description.

## Parallelism

DAG layers (a task's layer = 1 + the deepest layer among its dependencies):

| Layer | Tasks | Width |
|---|---|---|
| L1 | T01 | 1 |
| L2 | T02, T03, T04 | 3 |
| L3 | T05 | 1 |
| L4 | T06, T13 | 2 |
| L5 | T07, T08 | 2 |
| L6 | T09 | 1 |
| L7 | T10 | 1 |
| L8 | T11, T12, T14, T43, T45, T46 | 6 |
| L9 | T15, T20, T44, T50 | 4 |
| L10 | T16, T17, T18, T19, T21, T23, T27, T28, T33, T47 | 10 |
| L11 | T22, T24, T30, T34, T35, T36, T48, T49 | 8 |
| L12 | T25, T26, T51, T52, T53, T54, T55, T56, T57 | 9 |
| L13 | T29, T31, T58, T59, T60, T61, T62, T63 | 8 |
| L14 | T32 | 1 |
| L15 | T37, T38, T39, T40, T41, T42, T64, T67, T68 | 9 |
| L16 | T65, T66 | 2 |

68 tasks in 6 phases (0–5) and 16 layers. Critical path:
T01 → T02/T03/T04 → T05 → T06 → T07 → T09 → T10 → T11 → T15 → T21 → T24 → T26 → T29 → T32 → T64 → T65.
`web/` (T43–T63) runs beside L8–L13 of the server chain and joins it only at T64.

**Recommended concurrency cap: 5 agents**, with at most 3 concurrent agents per module.
- Layers L10–L15 are 8–10 wide, but most of those tasks are small. Five agents keep the critical path
  moving: the server chain always has 1–3 ready tasks and the web chain fills the remaining slots.
- All agents share one working tree and one branch. A module's typecheck sees half-written files of the
  other agents in that module. With more than 3 agents per module, false-red self-verification becomes
  common. **Rule for agents:** a typecheck or test failure that sits only in files outside your owned
  paths is reported, not fixed.
- One Docker Postgres serves every agent. Each concurrently running agent that runs `test:int`/`e2e` must
  get a distinct `AGENT_OPS_TEST_DB_SUFFIX` (e.g. its task id). The harness (T33/T64) creates and migrates
  `agent_ops_test_<suffix>` / `agent_ops_e2e_<suffix>` and picks free ports. Postgres CPU contention
  beyond ~5 parallel integration runs slows everything else.
- A cap of 6 would only help at L10/L12/L15, and only by about one batch each. The added merge noise and
  review load outweigh that. A cap of 4 is fine if the machine is weak; it adds roughly one batch.

## Testing strategy
- **shared** — unit (Vitest): `pnpm --filter @agent-ops/shared test`; typecheck `pnpm --filter @agent-ops/shared typecheck`.
  Covered by T06–T10 (schemas, the 25-cell transition table, health/cost/token-activity rules, catalogue completeness).
- **server** — `pnpm --filter @agent-ops/server test` = `test:unit` (domain + application on in-memory fakes,
  no DB/HTTP/timers; ADR-0008 suites `simulation.test.ts`, `determinism.test.ts`; ADR-0010
  `architecture.test.ts`; ADR-0004 `stream.test.ts`) + `test:int` (real Postgres, serial, per-agent
  suffixed DB: T33–T36, T38–T42). Needs `docker compose up -d`. Typecheck `pnpm --filter @agent-ops/server typecheck`;
  drift `pnpm --filter @agent-ops/server exec drizzle-kit check`.
- **web** — component (Vitest + RTL, jsdom, real QueryClient, network faked at `fetch`/`EventSource`):
  `pnpm --filter @agent-ops/web test` (T57–T63, ADR-0011 `eventCache.test.ts`); typecheck
  `pnpm --filter @agent-ops/web typecheck`; e2e (Playwright, Chromium, real server + `agent_ops_e2e_*`):
  `pnpm --filter @agent-ops/web e2e` (T64–T66).
- **Repo-wide:** `pnpm lint`, `pnpm -r typecheck`, `pnpm -r test`; ADR greps listed in each task's Acceptance.

## Risks & mitigations
- Concurrent edits of `package.json`/`pnpm-lock.yaml` → all dependencies are installed in T01; manifests
  are frozen afterwards (Rec-1). A task that finds a missing dependency stops and reports.
- The fixture generator diverges from the prototype → generate by running the prototype's own code
  (`node:vm`); the golden totals of DB-AC-9/10 are asserted in T14 (`--check`) and T36.
- Replay → live hand-over drops or duplicates an event → subscribe-and-buffer-first algorithm (T30); a
  concurrent-commit test (T39).
- `seq` not in commit order → advisory lock as the first statement of every command tx (T16), proven by T35.
- Keepalive not observable by `EventSource` (Q1) → the default adds `event: keepalive`. If the owner
  instead picks the `fetch` reader, T44 changes and a superseding ADR for ADR-0011 is needed.
- Domain may only `import type` from shared, while the transition table and health rule are runtime code
  in shared → they are applied in `application/` (T21, T23, T26), not in `domain/`; T37 enforces it.
- `onion-architecture` skill layout (`modules/<name>`) differs from ADR-0010 → the ADR wins (noted in T03).
- `backend-testing` skill targets Express/Supertest → adapt to Fastify `inject` (T33).
- `frontend-architecture` skill targets Next.js → use only its React structure rules (T04).
- Reset uses `TRUNCATE` while `events` is append-only → the trigger covers only UPDATE/DELETE; reset is the
  documented exception (ADR-0009); T34 proves UPDATE/DELETE fail, T36 proves reset works.
- Many web ACs say "e2e" but the owner wants a small Playwright set → RTL covers single-tab behaviour; 9
  Playwright spec files cover the rest (Rec-3). The traceability table lists the level used.
- NFR budgets measured only by T68 → reported, not gated. If a budget fails, open a follow-up.
- The spec Constraints sections still say "proposed" for decisions accepted today → harmless. Recommend
  the owner refresh the wording; this plan treats them as accepted.

## Red-flags check
- [x] Every requirement (and every spec AC-N) maps to a task — see the traceability table
- [x] No specification was authored or edited — requirements were taken as input (Q1–Q3 are flagged for the owner)
- [x] No task contradicts an accepted ADR; no new architectural decision needed (no proposed ADR)
- [x] No stack/framework assumed without an accepted ADR (ADR-0002/0004/0008–0012)
- [x] Execution mode is recorded and the plan is shaped for it
- [x] Dependencies form a DAG (no cycles; layers computed above)
- [x] (multi-agent) Concurrent tasks have non-overlapping Owned paths (`index.tsx` placeholders of T48 are
      overwritten by T51–T56 only after T48 is done; `server/vitest.config.ts` passes T03 → T33; `web/playwright.config.ts` passes T04 → T64; `web/src/main.tsx` passes T04 → T48)
- [x] Every Acceptance is measurable
- [x] No edits to existing shared contracts without an explicit callout (all contracts are new)

## Traceability

### SPEC-database
| AC | Task(s) |
|---|---|
| DB-AC-1 | T13, T32, T34, T42 |
| DB-AC-2 | T13, T32, T34 |
| DB-AC-3 | T13, T34 |
| DB-AC-4 | T12, T34 |
| DB-AC-5 | T13, T32, T42 |
| DB-AC-6 | T20, T32, T36, T42 |
| DB-AC-7 | T20, T32, T42 |
| DB-AC-8 | T14, T20, T36 |
| DB-AC-9 | T14, T36 |
| DB-AC-10 | T14, T36 |
| DB-AC-11 | T14, T20, T36 |
| DB-AC-12 | T14, T20, T36 |
| DB-AC-13 | T14, T36 |
| DB-AC-14 | T12, T17, T36 |
| DB-AC-15 | T12, T34 |
| DB-AC-16 | T12, T34 |
| DB-AC-17 | T12, T34 |
| DB-AC-18 | T12, T34 |
| DB-AC-19 | T12, T34 |
| DB-AC-20 | T12, T34 |
| DB-AC-21 | T12, T17, T34 |
| DB-AC-22 | T06, T12, T34 |
| DB-AC-23 | T16, T35 |
| DB-AC-24 | T12, T34 |
| DB-AC-25 | T12, T34 |
| DB-AC-26 | T16, T35 |
| DB-AC-27 | T16, T35 |
| DB-AC-28 | T16, T30, T35, T39 |
| DB-AC-29 | T16, T35 |
| DB-AC-30 | T16, T30, T35, T39 |
| DB-AC-31 | T12, T34 |
| DB-AC-32 | T12, T23, T35 |
| DB-AC-33 | T16, T35 |
| DB-AC-34 | T16, T18, T35 |
| DB-AC-35 | T17, T19, T35 |
| DB-AC-36 | T18, T19, T35 |
| DB-AC-37 | T32, T42 |
| DB-AC-38 | T12, T25, T32, T42 |
| DB-AC-39 | T20, T36 |
| DB-AC-40 | T20, T36, T42 |
| DB-AC-41 | T17, T36, T37 (reviewer) |
| DB-AC-42 | T20, T30, T36, T39 |

### SPEC-server-api
| AC | Task(s) |
|---|---|
| API-AC-1 | T09, T28, T38 |
| API-AC-2 | T06, T28, T38 |
| API-AC-3 | T28, T38 |
| API-AC-4 | T16, T21, T38 |
| API-AC-5 | T08, T21, T38 |
| API-AC-6 | T21, T38 |
| API-AC-7 | T21, T29, T38 |
| API-AC-8 | T09, T38 |
| API-AC-9 | T21, T38 |
| API-AC-10 | T08, T21, T38 |
| API-AC-11 | T08, T21, T38 |
| API-AC-12 | T21, T38 |
| API-AC-13 | T21, T38 |
| API-AC-14 | T21, T38 |
| API-AC-15 | T21, T38 |
| API-AC-16 | T21, T38 |
| API-AC-17 | T22, T38 |
| API-AC-18 | T09, T22, T38 |
| API-AC-19 | T22, T38 |
| API-AC-20 | T22, T38 |
| API-AC-21 | T09, T22, T38 |
| API-AC-22 | T11, T21, T22, T38 |
| API-AC-23 | T18, T26, T40 |
| API-AC-24 | T18, T26, T40 |
| API-AC-25 | T16, T26, T40 |
| API-AC-26 | T18, T26, T40 |
| API-AC-27 | T24, T26, T40 |
| API-AC-28 | T18, T26, T40 |
| API-AC-29 | T26, T40 |
| API-AC-30 | T19, T27, T40 |
| API-AC-31 | T27, T40 |
| API-AC-32 | T08, T27, T40 |
| API-AC-33 | T27, T36, T40 |
| API-AC-34 | T27, T40 |
| API-AC-35 | T19, T27, T40 |
| API-AC-36 | T19, T27, T40 |
| API-AC-37 | T09, T27, T40 |
| API-AC-38 | T08, T26, T41 |
| API-AC-39 | T23, T41 |
| API-AC-40 | T23, T41 |
| API-AC-41 | T23, T41 |
| API-AC-42 | T23, T41 |
| API-AC-43 | T25, T41 |
| API-AC-44 | T25, T31, T41 |
| API-AC-45 | T24, T25, T41 |
| API-AC-46 | T25, T41 |
| API-AC-47 | T24, T41 |
| API-AC-48 | T24, T41 |
| API-AC-49 | T24, T41 |
| API-AC-50 | T24, T41 |
| API-AC-51 | T24, T41 |
| API-AC-52 | T24, T41 |
| API-AC-53 | T24, T41 |
| API-AC-54 | T25, T32, T41 |
| API-AC-55 | T25, T41 |
| API-AC-56 | T25, T41 |
| API-AC-57 | T11, T24, T25, T41 |
| API-AC-58 | T30, T39 |
| API-AC-59 | T30, T39 |
| API-AC-60 | T30, T39 |
| API-AC-61 | T30, T39 |
| API-AC-62 | T30, T39 |
| API-AC-63 | T14, T20, T32, T42 |
| API-AC-64 | T32, T42 |
| API-AC-65 | T20, T32, T42 |
| API-AC-66 | T20, T32, T42 |
| API-AC-67 | T27, T40 |
| API-AC-68 | T13, T32, T42 |
| API-AC-69 | T13, T28, T42 |
| API-AC-70 | T28, T42 |
| API-AC-71 | T16, T26, T28, T40 |
| API-AC-72 | T16, T38 |
| API-AC-73 | T13, T32, T42 |

### SPEC-web-ui
| AC | Task(s) |
|---|---|
| UI-AC-1 | T48, T59 |
| UI-AC-2 | T48, T59 |
| UI-AC-3 | T48, T59 |
| UI-AC-4 | T48, T59 |
| UI-AC-5 | T48, T59, T66 |
| UI-AC-6 | T47, T59 |
| UI-AC-7 | T43, T47, T59, T65 |
| UI-AC-8 | T47, T59 |
| UI-AC-9 | T47, T59, T65 |
| UI-AC-10 | T48, T59 |
| UI-AC-11 | T48, T59, T66 |
| UI-AC-12 | T48, T59 |
| UI-AC-13 | T48, T59 |
| UI-AC-14 | T48, T51, T55, T59, T66 |
| UI-AC-15 | T56, T63 |
| UI-AC-16 | T48, T59, T66 |
| UI-AC-17 | T48, T59, T66 |
| UI-AC-18 | T45, T49, T59, T60 |
| UI-AC-19 | T49, T60 |
| UI-AC-20 | T43, T49, T60, T65 |
| UI-AC-21 | T43, T49, T59, T65 |
| UI-AC-22 | T43, T49, T50, T60 |
| UI-AC-23 | T44, T58, T65 |
| UI-AC-24 | T43, T44, T58 |
| UI-AC-25 | T44, T46, T62, T66 |
| UI-AC-26 | T46, T62 |
| UI-AC-27 | T48, T59 |
| UI-AC-28 | T48, T59, T65 |
| UI-AC-29 | T44, T48, T58, T59, T65 |
| UI-AC-30 | T48, T59, T65 |
| UI-AC-31 | T44, T58, T65 |
| UI-AC-32 | T44, T58, T65 |
| UI-AC-33 | T51, T52, T60 |
| UI-AC-34 | T49, T52, T60 |
| UI-AC-35 | T51, T60 |
| UI-AC-36 | T51, T60 |
| UI-AC-37 | T51, T60 |
| UI-AC-38 | T51, T60 |
| UI-AC-39 | T51, T60 |
| UI-AC-40 | T51, T60 |
| UI-AC-41 | T51, T60 |
| UI-AC-42 | T51, T60 |
| UI-AC-43 | T51, T60 |
| UI-AC-44 | T51, T60 |
| UI-AC-45 | T08, T49, T60 |
| UI-AC-46 | T51, T60, T65 |
| UI-AC-47 | T51, T60 |
| UI-AC-48 | T49, T51, T60, T65 |
| UI-AC-49 | T51, T60 |
| UI-AC-50 | T51, T60 |
| UI-AC-51 | T49, T51, T60 |
| UI-AC-52 | T45, T49, T59 |
| UI-AC-53 | T49, T60, T65 |
| UI-AC-54 | T49, T60 |
| UI-AC-55 | T49, T60, T65 |
| UI-AC-56 | T49, T60 |
| UI-AC-57 | T49, T60, T65 |
| UI-AC-58 | T49, T60, T65 |
| UI-AC-59 | T49, T60 |
| UI-AC-60 | T49, T60 |
| UI-AC-61 | T49, T60 |
| UI-AC-62 | T52, T61 |
| UI-AC-63 | T52, T61 |
| UI-AC-64 | T52, T61 |
| UI-AC-65 | T52, T61 |
| UI-AC-66 | T52, T61 |
| UI-AC-67 | T52, T61, T65 |
| UI-AC-68 | T52, T61 |
| UI-AC-69 | T49, T52, T61 |
| UI-AC-70 | T52, T61 |
| UI-AC-71 | T45, T52, T61 |
| UI-AC-72 | T52, T61 |
| UI-AC-73 | T52, T61 |
| UI-AC-74 | T52, T61 |
| UI-AC-75 | T52, T61 |
| UI-AC-76 | T52, T61 |
| UI-AC-77 | T50, T61 |
| UI-AC-78 | T50, T61 |
| UI-AC-79 | T50, T61 |
| UI-AC-80 | T50, T61 |
| UI-AC-81 | T50, T61 |
| UI-AC-82 | T50, T61 |
| UI-AC-83 | T50, T61 |
| UI-AC-84 | T50, T61 |
| UI-AC-85 | T50, T61, T65 |
| UI-AC-86 | T50, T61, T66 |
| UI-AC-87 | T50, T61 |
| UI-AC-88 | T09, T49, T60 |
| UI-AC-89 | T49, T60 |
| UI-AC-90 | T49, T60, T65 |
| UI-AC-91 | T53, T62 |
| UI-AC-92 | T53, T62 |
| UI-AC-93 | T53, T62 |
| UI-AC-94 | T53, T62, T66 |
| UI-AC-95 | T53, T62 |
| UI-AC-96 | T46, T62 |
| UI-AC-97 | T46, T62 |
| UI-AC-98 | T46, T62 |
| UI-AC-99 | T53, T62 |
| UI-AC-100 | T53, T62 |
| UI-AC-101 | T53, T62 |
| UI-AC-102 | T53, T62, T66 |
| UI-AC-103 | T07, T44, T53, T58, T62 |
| UI-AC-104 | T46, T62 |
| UI-AC-105 | T46, T62 |
| UI-AC-106 | T54, T62 |
| UI-AC-107 | T54, T62 |
| UI-AC-108 | T54, T62 |
| UI-AC-109 | T54, T62 |
| UI-AC-110 | T55, T63 |
| UI-AC-111 | T55, T63, T66 |
| UI-AC-112 | T55, T63 |
| UI-AC-113 | T55, T63 |
| UI-AC-114 | T55, T63 |
| UI-AC-115 | T55, T63 |
| UI-AC-116 | T55, T63 |
| UI-AC-117 | T55, T63 |
| UI-AC-118 | T55, T63 |
| UI-AC-119 | T55, T63 |
| UI-AC-120 | T55, T63, T66 |
| UI-AC-121 | T56, T63 |
| UI-AC-122 | T56, T63 |
| UI-AC-123 | T56, T63 |
| UI-AC-124 | T56, T63 |
| UI-AC-125 | T56, T63 |
| UI-AC-126 | T56, T63 |
| UI-AC-127 | T56, T63 |
| UI-AC-128 | T56, T63 |
| UI-AC-129 | T56, T63 |
| UI-AC-130 | T56, T63, T65 |
| UI-AC-131 | T45, T65 |
| UI-AC-132 | T46, T66 (reviewer: greyscale screenshots) |
| UI-AC-133 | T45, T66 |
| UI-AC-134 | T45, T59, T66 |
| UI-AC-135 | T45, T46, T59, T66 |
| UI-AC-136 | T48, T59, T66 |
| UI-AC-137 | T48, T66 |
| UI-AC-138 | T46, T63, T66 |

### Prototype deviations
| Deviation | Task(s) |
|---|---|
| D-1, D-2, D-3 | T08, T21, T49, T60, T38 |
| D-4 | T08, T21, T49, T60 |
| D-5 | T22, T24, T41, T65 |
| D-6 | T55, T63 |
| D-7 | T23, T41 |
| D-8 | T53, T62 |
| D-9 | T56, T63 |
| D-10 | T51, T60 |
| D-11 | T23, T41 |
| D-12 | T22, T38 |
| D-13 | T53 (Q4) |
| D-14 | T49, T60 |
| D-15 | T51, T52, T60, T61 |
| U-1 | T51, T60 |
| U-2 | T49, T60 |
| U-3 | T47, T59 |
| U-4 | T50, T61 |
| U-5 | T48, T59 |
| U-6 | T53, T62 |
| U-7 | T54, T62 |
| U-8 | T53, T62 |
| U-9 | T45, T52, T61 |
| U-10 | T56, T63 |
| U-11 | T50, T61 |
| U-12 | T55, T63 |
| U-13 | T55, T63 |
| U-14 | T51, T52, T60, T61 |
| U-15 | T44, T46, T62 |
| U-16 | T43, T47, T59 |
| U-17 | T51, T60 |
| U-18 | T45, T66 |
