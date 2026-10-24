---
status: proposed
date: 2026-10-24
decision-makers: []  # drafted by Claude 2026-10-24, awaiting review
affects: ["docs/specs/abstract-project-spec.md"]
supersedes: []
superseded-by: []
---

# PDR-0003: Agents pull work themselves; Operator does not assign tickets in the MVP

## Context
Open question: can Operator assign a ticket to a specific agent? The spec's flow is pull-based (INT-04).

## Considered Options
- Pull only (MVP)
- Operator assignment with agent preference

## Decision
Chosen option: "Pull only", because INT-04 already defines a deterministic order and assignment needs a
reservation concept the spec does not describe.

### Consequences
- Good, because one rule decides who gets what.
- Bad, because Operator cannot route a ticket to the best agent.

### Guardrails
- RULE: No spec adds an assign action before this PDR is superseded.
