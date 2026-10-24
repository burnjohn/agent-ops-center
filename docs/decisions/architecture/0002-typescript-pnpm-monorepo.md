---
status: accepted
date: 2026-10-24
decision-makers: [Ivan Lapa]  # chosen by owner 2026-10-24, drafted by Claude
scope: ["**"]
supersedes: []
superseded-by: []
---

# ADR-0002: Build Agent Ops as a TypeScript pnpm monorepo with web, server and shared modules

## Context and Problem Statement
Agent Ops has a local server and a browser UI that share one domain vocabulary (statuses, stages,
event types, command and event payloads). The product runs only on the Operator's machine (NFR-05),
so there is no deployment constraint.

The MVP runs on simulated agents only (ADR-0008). The real-agent integration — the stdio MCP server
(ADR-0006) and the Claude Code telemetry hook (ADR-0007) — is deferred to the next iteration
(PDR-0008, proposed). Those two processes will need the same contracts later,
so the layout must make adding them cheap without building them now.

## Considered Options
- One TypeScript pnpm monorepo: `web/`, `server/`, `shared/` in the MVP; `mcp/` and `telemetry/` added in the next iteration
- The same monorepo with all five modules scaffolded up front
- Separate repositories per component
- A single Next.js app that hosts the UI, the API and later the MCP endpoint

## Decision Outcome
Chosen option: "One TypeScript pnpm monorepo with `web/`, `server/`, `shared/` in the MVP", because one
install and one type-checked contract package (`@agent-ops/shared`) keep the UI and server consistent,
and the deferred `mcp/` and `telemetry/` processes can join later as new workspace packages that reuse
the same contracts. Scaffolding them now would add packages with no behaviour behind them.

Toolchain: Node ≥22 (LTS), pnpm workspaces (`pnpm-workspace.yaml`), TypeScript in strict mode,
ES modules. Package names: `@agent-ops/web`, `@agent-ops/server`, `@agent-ops/shared`.

### Consequences
- Good, because a contract change in `shared/` breaks the typecheck of every consumer at once.
- Good, because each module has its own test and typecheck command (Modules table in AGENTS.md).
- Good, because adding `mcp/` and `telemetry/` later is a new package plus an AGENTS.md row, not a restructure.
- Bad, because pnpm and Node ≥22 are required on the Operator's machine (plus Docker, see ADR-0009).
- Related: web stack in ADR-0011, testing strategy in ADR-0012.
- Bad, because until the next iteration nothing exercises the contracts from a second process; the
  HTTP API is only proven by the web UI and tests.

### Confirmation
- RULE: The MVP workspace contains exactly the packages `web/`, `server/`, `shared/`; no `mcp/` or `telemetry/` directory exists until a PDR superseding PDR-0008 brings them in.
  CHECK: `cat pnpm-workspace.yaml; ls -d mcp telemetry 2>/dev/null`
- RULE: Root `package.json` declares `"engines": { "node": ">=22" }` and a `packageManager` field pinning pnpm.
  CHECK: `grep -n '"node"\|packageManager' package.json`
- RULE: Cross-module types and schemas are imported from `@agent-ops/shared`, never re-declared in `web/` or `server/`.
  CHECK: reviewer
- RULE: `web/` never imports from `server/` and `shared/` never imports from `web/` or `server/`.
  CHECK: `grep -rnE "from ['\"](@agent-ops/server|.*server/src)" web/src shared/src; grep -rn "@agent-ops/web" shared/src server/src`
- RULE: Every `tsconfig.json` in the workspace has `"strict": true` (directly or via the shared base config).
  CHECK: reviewer
