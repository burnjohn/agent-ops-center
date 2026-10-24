---
status: proposed
date: 2026-10-24
decision-makers: []  # drafted by Claude 2026-10-24, awaiting review
scope: ["server/src/**", "web/src/api/**"]
supersedes: []
superseded-by: []
---

# ADR-0004: Expose a Fastify HTTP API and push events over Server-Sent Events

## Context and Problem Statement
The UI needs live updates under 500 ms (NFR-01), automatic recovery after a lost connection with the
events that happened meanwhile (NFR-04), and an explicit offline indicator (BRD-10). The MCP server and
telemetry hook are HTTP clients of the same server.

## Considered Options
- Fastify 5 REST commands + one SSE stream `/api/stream` with event ids and `Last-Event-ID` resume
- WebSockets
- Polling

## Decision Outcome
Chosen option: "Fastify + SSE", because events only flow server → browser, SSE reconnects natively and
resends `Last-Event-ID`, which maps one-to-one onto the event log ids.

### Consequences
- Good, because every command is a plain POST usable from the UI, MCP server, hook and tests.
- Bad, because the browser limits SSE connections per origin (6 on HTTP/1.1); acceptable for a few tabs.

### Confirmation
- RULE: Every state-changing endpoint validates its body with a Zod schema from `@agent-ops/shared`.
  CHECK: reviewer
- RULE: The stream sends each event with `id: <event seq>` and honours `Last-Event-ID`.
  CHECK: `server/src/http/stream.test.ts`
