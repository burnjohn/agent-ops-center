# Architecture Decision Records

Technical decisions that constrain the code, in MADR 4.0 with `scope` and `Confirmation`.
How to write, use and check them: `.claude/skills/architecture-decisions/SKILL.md`.
New file: copy [`_template.md`](_template.md) to `NNNN-<decision-slug>.md`.

| ADR | Decision | Status | Scope |
|---|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions as MADR 4.0 in docs/decisions/architecture | accepted | ** |
| [0002](0002-typescript-pnpm-workspace-with-four-modules.md) | Build Agent Ops as a TypeScript pnpm workspace with four modules | proposed | ** |
| [0003](0003-event-sourced-state-in-sqlite.md) | Store every change as an event in SQLite and derive state from it | proposed | server/src/**, shared/src/** |
| [0004](0004-fastify-http-api-with-sse-stream.md) | Expose a Fastify HTTP API and push events over Server-Sent Events | proposed | server/src/**, web/src/api/** |
| [0005](0005-react-vite-spa-for-web.md) | Build the web UI as a React 19 + Vite single-page app with Tailwind CSS | proposed | web/** |
| [0006](0006-mcp-stdio-server-as-api-client.md) | Ship the agent integration as a stdio MCP server that calls the HTTP API | proposed | mcp/** |
| [0007](0007-telemetry-via-claude-code-hooks.md) | Capture agent telemetry with Claude Code hooks that fail open | proposed | telemetry/** |
| [0008](0008-simulation-through-the-command-layer.md) | Run simulated agents inside the server through the same command layer | proposed | server/src/simulation/** |
