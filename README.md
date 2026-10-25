# Agent Ops Center

<!-- updated from: package.json, server/package.json, web/package.json, .env.example, compose.yaml, .nvmrc, web/e2e/fixtures/server.ts, server/test/int/env.ts, server/src/main.ts, server/src/cli/reset.ts -->

Built with AI agents through Spec-Driven Development.

Agent Ops Center is a board and control room for a team of simulated coding agents: an operator moves
tickets across a board, assigns them to agents, watches sessions and cost, and steps the simulation.
The server (Fastify, PostgreSQL) and the web UI (React SPA) are in this repository.

- Agent instructions: [`AGENTS.md`](AGENTS.md) — read natively by Claude Code, Cursor, Codex
- Docs, specs and decisions: [`docs/`](docs/README.md)
- Architecture: [`docs/architecture/`](docs/architecture/README.md)
- Specs: [`docs/specs/`](docs/specs/README.md) · ADRs: [`docs/decisions/architecture/`](docs/decisions/architecture/README.md) · PDRs: [`docs/decisions/product/`](docs/decisions/product/README.md)
- Subagents: [`.claude/agents/`](.claude/agents/README.md) · Skills: [`.claude/skills/`](.claude/skills/README.md)
- What agents learned: [`insights/`](insights/INSIGHTS.md)

## Run locally

Prerequisites:

- Node.js 22 (`.nvmrc` says `22`; the root `package.json` requires `>=22`). Fastify 5.12 prefers 22.22 or newer.
- pnpm 10 (`packageManager` is `pnpm@10.23.0`).
- Docker, for the PostgreSQL 18 container.

```sh
docker compose up -d        # PostgreSQL on 127.0.0.1:5432
cp .env.example .env        # DATABASE_URL, PORT, DATABASE_URL_TEST_BASE
pnpm install
```

The server loads `.env` itself. On start it applies migrations and loads the seed fixture when the
database is empty; it exits non-zero if the database is unreachable or another server already holds the
database lock.

### Development (two processes)

```sh
pnpm --filter @agent-ops/server dev    # API on http://127.0.0.1:3000 (tsx watch)
pnpm --filter @agent-ops/web dev       # Vite dev server, proxies /api to 127.0.0.1:3000
```

Open the URL Vite prints.

### Single process (server serves the built web app)

```sh
pnpm --filter @agent-ops/web build     # writes web/dist
pnpm --filter @agent-ops/server start  # serves /api and web/dist on http://127.0.0.1:3000
```

The server serves `web/dist` only if the folder exists when it starts.

### Reset to the seed fixture

Stop the server, then:

```sh
pnpm --filter @agent-ops/server reset
```

The command refuses to run while a server is connected to the database.

## Tests

```sh
pnpm lint                                   # eslint
pnpm typecheck                              # all packages
pnpm test                                   # all packages (server integration tests need Docker up)

pnpm --filter @agent-ops/shared test
pnpm --filter @agent-ops/server test:unit   # no database
pnpm --filter @agent-ops/server test:int    # real Postgres
pnpm --filter @agent-ops/web test           # Vitest + jsdom + RTL
pnpm --filter @agent-ops/web e2e            # Playwright (Chromium) against a real server
```

Integration and end-to-end tests use their own databases and never touch `agent_ops`. Set
`AGENT_OPS_TEST_DB_SUFFIX` to get an isolated database per run, for example when several runs share one
Postgres:

```sh
AGENT_OPS_TEST_DB_SUFFIX=mine pnpm --filter @agent-ops/server test:int   # agent_ops_test_mine
AGENT_OPS_TEST_DB_SUFFIX=mine pnpm --filter @agent-ops/web e2e           # agent_ops_e2e_mine
```

Without the variable the suffix is `default`. The e2e run needs Chromium installed for Playwright
(`pnpm --filter @agent-ops/web exec playwright install chromium`) and builds `web/dist` itself.

## How we work

1. Record product and technical choices as PDRs/ADRs in `docs/decisions/`.
2. `spec-creator` → `docs/specs/<feature>.md`.
3. `implementation-planner` → `docs/plans/<feature>.md`.
4. `implementer` / `test-writer` build it; `plan-verifier` and `architecture-reviewer` check it.
5. `engineering-insights` records what we learned; `workflow-retro` reviews multi-agent runs.
