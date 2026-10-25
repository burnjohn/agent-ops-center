---
status: superseded
date: 2026-10-24
decision-makers: []  # drafted by Claude 2026-10-24, awaiting review
affects: ["docs/specs/abstract-project-spec.md"]
supersedes: []
superseded-by: ["PDR-0010"]
---

# PDR-0005: Agents Offline for over an hour move to a collapsed Offline section, history kept

## Context
Open question: hide or archive agents that are long `Offline`.

## Considered Options
- Collapse into an "Offline" section after 1 h, keep all history
- Delete
- Always show

## Decision
Chosen option: "Collapse after 1 h", because history must stay explorable (UC-08, NFR-03) but the main grid
should show who works now.

### Consequences
- Good, because the grid stays readable with many past simulation runs.

### Guardrails
- RULE: No event is ever deleted because an agent went Offline.
