---
status: proposed            # proposed | accepted | rejected | deprecated | superseded
date: YYYY-MM-DD
decision-makers: []
scope: ["**"]               # globs this decision governs; as narrow as the decision
supersedes: []
superseded-by: []
---

# ADR-NNNN: <Decision as a short imperative sentence>

## Context and Problem Statement
<The forces and the question. What hurts, what constraints apply, what must stay true.>

## Considered Options
- <Option A>
- <Option B>

## Decision Outcome
Chosen option: "<Option A>", because <reason tied to the forces in Context>.

### Consequences
- Good, because <...>
- Bad, because <...>

### Confirmation
- RULE: <one checkable statement>
  CHECK: <existing test or lint | new architecture test | grep pattern | reviewer>
