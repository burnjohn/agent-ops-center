---
status: proposed
date: 2026-10-24
decision-makers: []  # drafted by Claude 2026-10-24; deferred to next iteration by Ivan Lapa 2026-10-24
scope: ["telemetry/**"]
supersedes: []
superseded-by: []
---

# ADR-0007: Capture agent telemetry with Claude Code hooks that fail open

> **Deferred to the next iteration.** The owner decided on 2026-10-24 that the MVP runs on simulated
> agents only (ADR-0008); Claude Code telemetry is out of MVP scope (PDR-0008, proposed, records the scope cut). This record
> stays `proposed` and is reviewed again when the next iteration starts. Until then no `telemetry/` package
> is created (ADR-0002).

## Context and Problem Statement
The product must record tool start/finish and turn end without the model (INT-07), never slow or block
the agent (INT-08), send only tool name and a short description (INT-09), skip actions already reported
via MCP (INT-10) and ignore sessions without an agent id (INT-11).

## Considered Options
- A Node script registered for PreToolUse, PostToolUse, PostToolUseFailure and Stop hooks, POSTing with a 300 ms timeout and always exiting 0
- Parsing Claude Code transcripts after the fact
- An OpenTelemetry collector

## Decision Outcome
Chosen option: "Hooks that fail open", because hooks fire exactly at tool boundaries, the script decides
locally what to send, and a timeout plus exit 0 guarantees the agent is never blocked.

### Consequences
- Good, because the payload is built by an allow-list (tool name + path or first 80 chars of a command).
- Bad, because telemetry is Claude Code specific; other agents only send Agent Reports.

### Confirmation
- RULE: The hook exits 0 on every path and never writes to stdout.
  CHECK: `telemetry/src/hook.test.ts`
- RULE: Tools whose name starts with `mcp__agent-ops` are not sent.
  CHECK: `telemetry/src/hook.test.ts`
