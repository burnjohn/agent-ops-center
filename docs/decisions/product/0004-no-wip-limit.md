---
status: accepted
date: 2026-10-24
decision-makers: []  # drafted by Claude 2026-10-24, awaiting review
affects: ["docs/specs/abstract-project-spec.md"]
supersedes: []
superseded-by: []
---

# PDR-0004: No WIP limit on In Progress in the MVP

## Context
Open question: WIP limit for `In Progress`. Each agent already holds at most one ticket (INT-03), so WIP ≤ number of agents.

## Considered Options
- No limit
- Configurable limit

## Decision
Chosen option: "No limit", because INT-03 bounds WIP by the agent count already.

### Consequences
- Bad, because many agents can flood Review; the Review counter in MC-01 makes this visible.

### Guardrails
- RULE: Claim refusals never mention a WIP limit.
