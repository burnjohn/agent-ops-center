---
status: accepted
date: 2026-10-24
decision-makers: [Ivan Lapa]  # chosen by owner 2026-10-24, drafted by Claude
scope: ["server/src/**", "shared/src/**"]
supersedes: []
superseded-by: []
---

# ADR-0010: Structure the server as an onion (Domain, Application, Infrastructure, Presentation) with Zod contracts in shared

## Context and Problem Statement
The server holds every business rule: ticket lifecycle, claim order, stage reporting, refusals,
health, and the simulator (ADR-0008). Today the only driver is the web UI over HTTP; in the next
iteration the MCP server and telemetry hook will drive the same rules. Most code is written by agents
across many sessions, so "where does this go" and "may this file import that" must have one checkable
answer. The UI and server must agree on request, response and event shapes (NFR-02) without
hand-copied types.

## Considered Options
- Onion architecture: Domain / Application / Infrastructure / Presentation with inward-only dependencies; Zod schemas in `shared/` as the single wire contract
- Feature folders with route → service → repository per feature and no layer rule
- Thin routes that query Drizzle directly (transaction script)

## Decision Outcome
Chosen option: "Onion architecture with Zod contracts in `shared/`", because the domain rules can be
unit-tested with no database or HTTP, new drivers (MCP, hook) plug into Presentation without touching
the core, and the import allow-list gives agents and reviewers a mechanical pass/fail.

Layout (`server/src/`), detailed patterns in `.claude/skills/onion-architecture/`:

| Layer | Path | May import |
|---|---|---|
| Domain | `domain/**` — entities, value objects, state transitions, domain errors, event definitions | nothing outside `domain/`, plus `import type` from `@agent-ops/shared` |
| Application | `application/**` — one use case per command/query, ports (repositories, unit of work, `Clock`, `IdGenerator`, event publisher), simulator | `domain/`, `@agent-ops/shared` |
| Infrastructure | `infrastructure/**` — Drizzle schema, repositories, unit of work, SSE fan-out, config, system clock | `domain/`, `application/` (ports), `@agent-ops/shared`, `drizzle-orm`, driver libraries |
| Presentation | `presentation/**` — Fastify plugins, routes, SSE endpoint, error → HTTP mapping | `application/`, `@agent-ops/shared`, `fastify` |
| Composition root | `container.ts`, `main.ts` | everything |

Contracts: `shared/src/` holds Zod schemas for command bodies, query responses and event payloads, plus
the domain vocabulary (status, stage, event type enums) and the `z.infer` types. Web and server import
only these; Drizzle row types never leave Infrastructure.

### Consequences
- Good, because domain and application are tested with in-memory port fakes, fast and deterministic.
- Good, because adding MCP or telemetry later is a new Presentation adapter (or a client package) over existing use cases.
- Good, because one schema in `shared/` validates on the server and types the client.
- Bad, because more files and mapping code (row ↔ domain ↔ DTO) than a transaction script.
- Bad, because `shared/` depends on Zod at runtime, so the web bundle ships Zod too.

### Confirmation
- RULE: `server/src/domain/**` imports nothing outside `server/src/domain/` except `import type` from `@agent-ops/shared`; no `fastify`, `drizzle-orm`, `zod`, `pg`, `node:` imports.
  CHECK: new architecture test `server/src/architecture.test.ts` (dependency-cruiser or import scan) + `grep -rnE "from ['\"](fastify|drizzle-orm|zod|pg|node:)" server/src/domain`
- RULE: `server/src/application/**` does not import from `infrastructure/`, `presentation/`, `fastify` or `drizzle-orm`.
  CHECK: `server/src/architecture.test.ts` + `grep -rnE "infrastructure/|presentation/|from ['\"](fastify|drizzle-orm)" server/src/application`
- RULE: `server/src/presentation/**` does not import from `infrastructure/` or `drizzle-orm`; handlers validate input, call one use case and map the result — no business branching.
  CHECK: `server/src/architecture.test.ts` + reviewer
- RULE: Concrete adapters are instantiated only in `server/src/container.ts` (composition root).
  CHECK: reviewer + `grep -rn "new .*Repository(\|new .*Clock(" server/src | grep -v container.ts | grep -v "\.test\.ts"`
- RULE: Request bodies, response bodies and event payloads are defined once as Zod schemas in `shared/src/` and imported by both `web/` and `server/`.
  CHECK: reviewer + `grep -rn "z.object" server/src/presentation web/src` (expect none)
- RULE: `shared/src/**` imports only `zod`; no `fastify`, `drizzle-orm`, `react` or Node built-ins.
  CHECK: `grep -rnE "from ['\"]" shared/src | grep -vE "from ['\"](zod|\./|\.\./)"`
