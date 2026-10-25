# server/AGENTS.md

Backend of Agent Ops Center: Fastify 5 + Drizzle ORM + PostgreSQL (ADR-0002, ADR-0004, ADR-0009, ADR-0010).
Root `AGENTS.md` still applies.

## Layers (ADR-0010 layout wins over the `onion-architecture` skill's `modules/<name>` layout)

| Layer            | Path                              | May import                                                                                                                |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Domain           | `src/domain/**`                   | nothing outside `domain/`, plus `import type` from `@agent-ops/shared`; no `fastify`, `drizzle-orm`, `zod`, `pg`, `node:` |
| Application      | `src/application/**`              | `domain/`, `@agent-ops/shared`; never `infrastructure/`, `presentation/`, `fastify`, `drizzle-orm`                        |
| Infrastructure   | `src/infrastructure/**`           | `domain/`, `application/` (ports), `@agent-ops/shared`, `drizzle-orm`, `pg`                                               |
| Presentation     | `src/presentation/**`             | `application/`, `@agent-ops/shared`, `fastify`; never `infrastructure/` or `drizzle-orm`                                  |
| Composition root | `src/container.ts`, `src/main.ts` | everything                                                                                                                |

- Concrete adapters (`new ...Repository()`, clocks) are instantiated only in `container.ts`.
- Request/response/event schemas live once in `shared/src/`; no `z.object` in `presentation/`.
- Drizzle row types never leave `infrastructure/`.
- The transition table and health rule are runtime code in `shared`, so they are applied in `application/`, not `domain/`.
- Enforced by `src/architecture.test.ts` (runs in `test:unit`).

## Commands

| Purpose           | Command                                     |
| ----------------- | ------------------------------------------- |
| Test (unit + int) | `pnpm --filter @agent-ops/server test`      |
| Unit only         | `pnpm --filter @agent-ops/server test:unit` |
| Integration only  | `pnpm --filter @agent-ops/server test:int`  |
| Typecheck         | `pnpm --filter @agent-ops/server typecheck` |

## Testing rules

- **Docker must be up for `test`** (`docker compose up -d`): integration tests (`*.int.test.ts`) use the Postgres container on 127.0.0.1:5432.
- Unit tests: `src/**/*.test.ts` (excluding `*.int.test.ts`). Integration project runs files serially (`fileParallelism: false`, forks pool, `maxWorkers: 1`).
- **`AGENT_OPS_TEST_DB_SUFFIX`:** one Postgres serves all concurrent agents. Each agent running `test:int` or e2e sets a distinct suffix (e.g. its task id); the harness uses DB `agent_ops_test_${AGENT_OPS_TEST_DB_SUFFIX ?? 'default'}` derived from `DATABASE_URL_TEST_BASE`. Never run integration tests against `agent_ops`.
- Use Fastify `inject` for HTTP tests (the `backend-testing` skill targets Express; adapt it).
- Secrets and URLs come from env (see `.env.example`); only the config loader reads `process.env`.
- Manifests are frozen after T01: report a missing dependency instead of editing `package.json`.
