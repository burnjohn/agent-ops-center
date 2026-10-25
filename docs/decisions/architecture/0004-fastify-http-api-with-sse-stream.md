---
status: accepted
date: 2026-10-24
decision-makers: [Ivan Lapa]  # chosen by owner 2026-10-24, drafted by Claude
scope: ["server/src/presentation/**", "web/src/api/**", "shared/src/**"]
supersedes: []
superseded-by: []
---

# ADR-0004: Expose a Fastify HTTP API and push events over Server-Sent Events

## Context and Problem Statement
The UI needs live updates under 500 ms (NFR-01), automatic recovery after a lost connection with the
events that happened meanwhile (NFR-04), and an explicit offline indicator (BRD-10). Every state change
is recorded as a row in the append-only `events` table with a monotonic `seq` (ADR-0009). In the MVP
the only client is the web UI; the MCP server and telemetry hook (deferred, ADR-0006/0007) will become
HTTP clients of the same API in the next iteration.

## Considered Options
- Fastify 5 REST commands + one SSE stream `/api/stream` with event ids and `Last-Event-ID` resume
- WebSockets
- Polling

## Decision Outcome
Chosen option: "Fastify 5 + REST commands + one SSE stream", because events only flow server → browser,
SSE reconnects natively and resends `Last-Event-ID`, which maps one-to-one onto `events.seq`.

Shape: commands are `POST /api/...` with a Zod-validated body; reads are `GET /api/...`; the stream
`GET /api/stream` first replays `events` with `seq > Last-Event-ID` (or `?since=`), then forwards new
events as they are committed.

### Consequences
- Good, because every command is a plain POST usable from the UI, tests and, later, the MCP server and hook.
- Good, because resume is a single indexed query (`WHERE seq > $1 ORDER BY seq`).
- Bad, because the browser limits SSE connections per origin (6 on HTTP/1.1); acceptable for a few tabs.
- Bad, because the replay-then-live handover must not drop or duplicate an event; it needs a dedicated test.

### Confirmation
- RULE: Every state-changing endpoint validates its body with a Zod schema imported from `@agent-ops/shared`.
  CHECK: reviewer
- RULE: State-changing endpoints use POST (or PATCH/DELETE); GET handlers never call an application command.
  CHECK: reviewer
- RULE: The stream sends each event with `id: <events.seq>` and, on reconnect with `Last-Event-ID: N`, sends every event with `seq > N` exactly once and in order.
  CHECK: `server/src/presentation/http/stream.test.ts`
- RULE: There is exactly one SSE endpoint, `/api/stream`.
  CHECK: `grep -rn "text/event-stream" server/src`
