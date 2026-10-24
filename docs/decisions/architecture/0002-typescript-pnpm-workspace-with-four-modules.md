---
status: proposed
date: 2026-10-24
decision-makers: []  # drafted by Claude 2026-10-24, awaiting review
scope: ["**"]
supersedes: []
superseded-by: []
---

# ADR-0002: Build Agent Ops as a TypeScript pnpm workspace with four modules

## Context and Problem Statement
Agent Ops has a local server, a browser UI, an MCP server that agents spawn, and a telemetry hook that
agents run on every tool call. All four share the domain vocabulary (statuses, stages, event types).
The product runs only on the Operator's machine (NFR-05), so there is no deployment constraint.

## Considered Options
- One TypeScript pnpm workspace: `server/`, `web/`, `mcp/`, `telemetry/`, plus `shared/` for contracts
- Separate repos per component
- A single Next.js app that also hosts the MCP endpoint

## Decision Outcome
Chosen option: "TypeScript pnpm workspace", because one install and one type-checked contract package
keep the four processes consistent, while the MCP server and hook still run as separate processes,
which agents require (stdio MCP, hook command).

### Consequences
- Good, because contract changes in `shared/` break the build of every consumer at once.
- Good, because each module has its own test and typecheck command (Modules table in AGENTS.md).
- Bad, because pnpm and Node ≥22 are required on the Operator's machine.

### Confirmation
- RULE: Cross-module types are imported from `@agent-ops/shared`, never re-declared.
  CHECK: reviewer
- RULE: `web/`, `mcp/`, `telemetry/` never import from `server/src`.
  CHECK: `grep -rn "server/src" web/src mcp/src telemetry/src`
