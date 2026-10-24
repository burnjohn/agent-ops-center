---
status: proposed
date: 2026-10-24
decision-makers: []  # drafted by Claude 2026-10-24, awaiting review
affects: ["docs/specs/abstract-project-spec.md"]
supersedes: []
superseded-by: []
---

# PDR-0006: Operator can release an In Progress ticket back to Ready

## Context
Open question: can Operator stop an agent or take a ticket back (`release`)? The lifecycle diagram has 7
transitions; six are described in the text. A dead agent (Offline) would otherwise hold its ticket forever.

## Considered Options
- Operator releases `In Progress → Ready`; the agent becomes Idle and gets a refusal with reason on its next ticket action
- No release

## Decision
Chosen option: "Release to Ready", because it is the only way to recover work from an Offline agent and it
matches the seventh transition of the diagram.

### Consequences
- Good, because stuck work can be reassigned by the next claim.
- Bad, because a still-working agent loses its ticket; its next call explains why.

### Guardrails
- RULE: Release requires confirmation in the UI and is recorded as an Operator event.
