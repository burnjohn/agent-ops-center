---
status: proposed
date: 2026-10-24
decision-makers: [Ivan Lapa]  # chosen by owner 2026-10-24, drafted by Claude
scope: ["**/*.test.ts", "**/*.test.tsx", "web/e2e/**", "**/vitest.config.ts", "web/playwright.config.ts", "compose.yaml"]
supersedes: []
superseded-by: []
---

# ADR-0012: Test with Vitest and React Testing Library, run integration tests against a real Postgres, and cover flows end to end with Playwright

## Context and Problem Statement
Most code is written by agents, so tests are the main guard that a change keeps the spec's acceptance
criteria true. The risky parts are concrete: the lifecycle rules and refusals (BRD-04), the simulator's
determinism (SIM-03), the transaction that writes state and events together and the commit-ordered
`seq` (ADR-0009), SSE resume without gaps or duplicates (ADR-0004, NFR-04), and UI flows such as drag
& drop with confirmation dialogs and keyboard moves (NFR-06). Several of these only show up with a real
database (advisory locks, identity columns, jsonb, transactions) or a real browser.

The stack is TypeScript ESM on Node ≥22 with Vite on the web side (ADR-0002, ADR-0011), Postgres
via Docker compose (ADR-0009) and onion layers with port fakes (ADR-0010).

## Considered Options
- Vitest everywhere (unit + integration), React Testing Library for components, integration tests against a real Postgres from `compose.yaml`, Playwright for end-to-end
- Jest + RTL, integration tests against an in-memory Postgres substitute (pg-mem / PGlite), Cypress for end-to-end
- Vitest + Testcontainers (a fresh Postgres container per run) + Playwright

## Decision Outcome
Chosen option: "Vitest + RTL + real Postgres from compose + Playwright", because Vitest shares Vite's
ESM/TypeScript pipeline with no extra transform config, RTL tests behaviour the way the Operator uses
it, a real Postgres is the only way to prove the transaction, lock and `seq` rules, and Playwright
drives real browsers (multiple tabs, keyboard, drag) against the real server. Reusing the compose
Postgres avoids a second container tool; Testcontainers stays an option if CI needs isolation later.

Test levels:
- **Unit (Vitest)** — `shared/` schemas and pure rules (transition table, health, cost); `server/`
  domain and application use cases with in-memory port fakes and a fake Simulation Clock; no database,
  no HTTP, no timers. Files: `*.test.ts` next to the code.
- **Integration (Vitest, real Postgres)** — repositories, unit of work, migrations, fixture load/reset,
  and HTTP + SSE through Fastify `inject` / a listening server. They run against a separate database
  (`agent_ops_test`) on the compose Postgres, migrated once per run; each test file starts from a
  truncated, re-seeded state. Files: `*.int.test.ts` in `server/`, run single-threaded.
- **Component (Vitest + React Testing Library, jsdom)** — screens and components with a real
  TanStack Query client and the API module stubbed at the network boundary; queries by role and label,
  `user-event` for interaction. Files: `*.test.tsx` in `web/src`.
- **End-to-end (Playwright)** — the built web app served by the real server on a test database,
  Chromium by default; flows from the spec (create → assign → step → review → approve; release with
  confirmation; two tabs stay in sync; reconnect after stream loss; keyboard-only move). Files:
  `web/e2e/**/*.spec.ts`.

### Consequences
- Good, because the riskiest rules (atomic events, commit-ordered `seq`, resume) are tested on the real engine, not a lookalike.
- Good, because one runner and one config style cover `shared/`, `server/` and `web/`.
- Good, because simulator determinism and lifecycle rules are fast unit tests with no I/O.
- Bad, because integration and e2e tests need Docker running (`docker compose up -d`) — the same requirement as development (ADR-0009).
- Bad, because integration tests share one Postgres and must run serially; the suite gets slower as it grows.
- Bad, because Playwright adds browser downloads and is the slowest level; keep it to the flows above.

### Confirmation
- RULE: Every workspace package runs its tests with Vitest; no Jest, Mocha or Cypress dependency exists.
  CHECK: `grep -rnE '"(jest|mocha|cypress|ts-jest)"' package.json */package.json`
- RULE: Server integration tests use a real Postgres via `DATABASE_URL` pointing at a test database; no in-memory substitute (`pg-mem`, `@electric-sql/pglite`) is used.
  CHECK: `grep -rnE "pg-mem|pglite" --include=*.ts --include=package.json server`
- RULE: Domain and application unit tests (`server/src/domain/**`, `server/src/application/**`, excluding `*.int.test.ts`) import no Drizzle client, no Fastify and use no real timers.
  CHECK: `grep -rnE "drizzle-orm|fastify|setTimeout\(" server/src/domain server/src/application --include=*.test.ts | grep -v "\.int\.test\.ts"`
- RULE: Component tests use React Testing Library queries by role/label/text; no `container.querySelector` or snapshot-only tests.
  CHECK: `grep -rnE "querySelector|toMatchSnapshot" web/src --include=*.test.tsx`
- RULE: End-to-end tests live in `web/e2e/` and run with Playwright against the real server and a test database.
  CHECK: reviewer + `ls web/e2e web/playwright.config.ts`
- RULE: Each module's test and typecheck commands are listed in the Modules table of `AGENTS.md`.
  CHECK: reviewer
