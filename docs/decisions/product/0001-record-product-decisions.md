---
status: accepted
date: 2026-10-24
decision-makers: [Ivan Lapa]
affects: ["docs/specs/**"]
supersedes: []
superseded-by: []
---

# PDR-0001: Record product decisions as PDRs in docs/decisions/product

## Context
Specs are written by the `spec-creator` agent. When a spec needs a product choice that nobody wrote
down (who the user is, what is out of scope), the agent fills the gap with a guess, and the next spec
guesses differently. Architecture choices already have ADRs; product choices need the same kind of
durable, checkable record.

## Considered Options
- PDR files in `docs/decisions/product/`, same lifecycle as ADRs
- A single product brief document edited over time
- Keep product choices inside each spec

## Decision
Chosen option: "PDR files with the ADR lifecycle", because one decision per file can be cited from
specs, superseded with history, and checked through guardrails, while a single brief gets rewritten
and loses the reasons.

### Consequences
- Good, because specs cite decisions instead of re-arguing them.
- Good, because "why don't we do X?" has a findable answer.
- Bad, because product thinking has to be written down before the spec, which slows the first features.

### Guardrails
- RULE: Every spec has a `## Constraints` section listing the PDRs it depends on (or "none").
- RULE: A spec that needs an unmade product choice links a `proposed` PDR instead of deciding inline.
