# Architecture Decision Records

Technical decisions that constrain the code, in MADR 4.0 with `scope` and `Confirmation`.
How to write, use and check them: `.claude/skills/architecture-decisions/SKILL.md`.
New file: copy [`_template.md`](_template.md) to `NNNN-<decision-slug>.md`.

| ADR | Decision | Status | Scope |
|---|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions as MADR 4.0 in docs/decisions/architecture | accepted | ** |
| [0002](0002-typescript-pnpm-monorepo.md) | Build Agent Ops as a TypeScript pnpm monorepo with web, server and shared modules | proposed | ** |
| [0004](0004-fastify-http-api-with-sse-stream.md) | Expose a Fastify HTTP API and push events over Server-Sent Events | proposed | server/src/presentation/**, web/src/api/**, shared/src/** |
| [0006](0006-mcp-stdio-server-as-api-client.md) | Ship the agent integration as a stdio MCP server that calls the HTTP API (deferred to next iteration) | proposed | mcp/** |
| [0007](0007-telemetry-via-claude-code-hooks.md) | Capture agent telemetry with Claude Code hooks that fail open (deferred to next iteration) | proposed | telemetry/** |
| [0008](0008-simulation-through-the-command-layer.md) | Run simulated agents inside the server through the same command layer, advancing on demand | proposed | server/src/application/simulation/**, server/src/presentation/http/simulation/**, web/src/features/simulation/** |
| [0009](0009-postgres-drizzle-with-transactional-event-log.md) | Store state in PostgreSQL via Drizzle, with an append-only events table written in the same transaction | proposed | server/src/infrastructure/db/**, server/src/infrastructure/repositories/**, server/drizzle/**, server/drizzle.config.ts, compose.yaml |
| [0010](0010-onion-architecture-for-server.md) | Structure the server as an onion (Domain, Application, Infrastructure, Presentation) with Zod contracts in shared | proposed | server/src/**, shared/src/** |
| [0011](0011-react-vite-spa-with-css-modules-and-tanstack-query.md) | Build the web UI as a React 19 + Vite SPA with react-router, CSS Modules over the design tokens, and TanStack Query fed by the SSE stream | proposed | web/** |
| [0012](0012-test-with-vitest-rtl-playwright-and-real-postgres.md) | Test with Vitest and React Testing Library, run integration tests against a real Postgres, and cover flows end to end with Playwright | proposed | **/*.test.ts, **/*.test.tsx, web/e2e/**, **/vitest.config.ts, web/playwright.config.ts, compose.yaml |
| [0003](0003-event-sourced-state-in-sqlite.md) | ~~Store every change as an event in SQLite and derive state from it~~ → 0009 | superseded | server/src/**, shared/src/** |
| [0005](0005-react-vite-spa-for-web.md) | ~~Build the web UI as a React 19 + Vite single-page app with Tailwind CSS~~ → 0011 | superseded | web/** |
