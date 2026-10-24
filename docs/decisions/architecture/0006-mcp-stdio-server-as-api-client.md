---
status: proposed
date: 2026-10-24
decision-makers: []  # drafted by Claude 2026-10-24, awaiting review
scope: ["mcp/**"]
supersedes: []
superseded-by: []
---

# ADR-0006: Ship the agent integration as a stdio MCP server that calls the HTTP API

## Context and Problem Statement
Agents (Claude Code and others) connect via MCP (INT-02). Identity must be set at launch, not invented by
the model (INT-01). Forbidden actions must not exist as tools at all (INT-03).

## Considered Options
- stdio MCP server (`@modelcontextprotocol/sdk`) spawned by the agent, identity from `AGENT_OPS_AGENT_ID` env, every tool = one HTTP call
- Streamable-HTTP MCP endpoint hosted inside the Fastify server
- Agents call the REST API directly with curl

## Decision Outcome
Chosen option: "stdio MCP server as an API client", because the env var fixes identity per agent process,
and the tool list is the capability boundary: there is no tool to set Done or touch another agent's ticket.

### Consequences
- Good, because all rules (claim order, refusals) live once, in the server domain.
- Bad, because the server must be running; MCP tools return a clear error when it is not.

### Confirmation
- RULE: `mcp/` exposes only: list_available_tickets, claim_ticket, get_ticket, report_stage, post_update, mark_blocked, submit_for_review.
  CHECK: `mcp/src/tools.test.ts`
- RULE: The agent id is read from `AGENT_OPS_AGENT_ID` only; no tool takes an agent id argument.
  CHECK: reviewer
