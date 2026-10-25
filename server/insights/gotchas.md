# Server Gotchas

Known traps for work in `server/`. Short and curated.

## ADR-0010 layout beats the onion-architecture skill

The skill describes `modules/<name>/{routes,service,repository}.ts`. Here layers are `src/{domain,application,infrastructure,presentation}`; follow ADR-0010.

## Domain may only `import type` from shared

The transition table and health rule are runtime code in `shared`, so apply them in `application/` (use cases), never in `domain/`. The architecture test enforces it.

## `seq` must follow commit order

Take the advisory lock as the first statement of every command transaction, otherwise `seq` can disagree with commit order and SSE replay drops or duplicates events.

## Replay-to-live hand-over

Subscribe and buffer first, then replay, then drain the buffer deduplicated by `seq`; otherwise events committed during replay are lost.

## `events` is append-only, reset is the exception

A trigger blocks UPDATE/DELETE only; reset uses `TRUNCATE` (ADR-0009).

## Keepalive is invisible to `EventSource`

Comment lines are not observable by the browser; the default adds an explicit `event: keepalive`.

## Shared Postgres between concurrent agents

Set a distinct `AGENT_OPS_TEST_DB_SUFFIX` per agent for `test:int`/e2e; never touch `agent_ops` from tests.

## backend-testing skill targets Express

Adapt to Fastify `inject`; there is no Supertest.
