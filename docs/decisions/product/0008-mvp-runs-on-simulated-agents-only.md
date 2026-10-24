---
status: proposed
date: 2026-10-24
decision-makers: []  # drafted by Claude 2026-10-24 from Ivan Lapa's answers, awaiting review
affects: ["docs/specs/abstract-project-spec.md"]
supersedes: []
superseded-by: []
---

# PDR-0008: The MVP runs on simulated agents only; real-agent integration (MCP, telemetry) is the next iteration

## Context
The clickable prototype (`docs/design/prototype/app.dc.html`, 2026-10-24) shows the whole product working
with simulated agents that the Operator steps through on demand. The spec still required an MCP server for
real agents (INT-01…INT-06) and passive telemetry from them (INT-07…INT-11). PDR-0007 already moved token
and log capture to mock data, and live capture conflicts with INT-09 (no file contents or command output).
The owner decided on 2026-10-24 that every agent in the MVP is simulated, including the demo agents labelled
`Real · Claude Code`. This extends PDR-0007 from cost and logs to the whole agent integration.

## Considered Options
- Simulation only in the MVP; keep INT-01…INT-11 in the spec as a marked "next iteration" section
- MVP with both simulated agents and real agents over MCP plus telemetry, as the spec said
- Real agents over MCP only, telemetry later

## Decision
Chosen option: "Simulation only in the MVP", because the whole Operator experience (board, assignment,
console, Mission Control, cost, logs) can be built and demoed without deciding transport, identity and
telemetry capture, and the open conflict with INT-09 does not block the first release.

### Consequences
- Good, because the MVP has one deterministic data source, so demos and tests always start from the same state.
- Good, because INT requirements stay written down and can return without rediscovery.
- Bad, because the product does not observe any real agent yet; `Said vs did` and health are only demonstrated.
- Bad, because the `Real` kind in demo data can mislead users (open question in the spec).
- Affected: `docs/specs/abstract-project-spec.md` (INT-01…INT-11 move to "Наступна ітерація"; SIM-06…SIM-11 added);
  proposed ADR-0006 (MCP stdio server) and ADR-0007 (telemetry via hooks) are not needed for the MVP.

### Guardrails
- RULE: No MVP spec requirement depends on an MCP server, agent hooks or any other channel from a real agent.
- RULE: INT-* requirements return to scope only through a new PDR and ADR (see also PDR-0007).
- RULE: Simulated agents produce `Agent Report` and `Agent Telemetry` events that look the same on screen as real-agent events would.
