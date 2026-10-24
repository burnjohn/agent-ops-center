---
status: accepted
date: 2026-10-24
decision-makers: [Ivan Lapa]
scope: ["**"]
supersedes: []
superseded-by: []
---

# ADR-0001: Record architecture decisions as MADR 4.0 in docs/decisions/architecture

## Context and Problem Statement
Most of the code in this repository is written by AI agents across many sessions. Without a durable
record, each session re-decides the stack, boundaries and policies differently, and reviewers cannot
tell whether a diff breaks an earlier choice. Decisions must be cheap for an agent to load (only the
relevant ones) and checkable against a diff.

## Considered Options
- MADR 4.0 files in `docs/decisions/architecture/` with `scope` globs and `Confirmation` rules
- Decisions as sections inside AGENTS.md
- No written record; rely on code and PR history

## Decision Outcome
Chosen option: "MADR 4.0 files with `scope` and `Confirmation`", because `scope` lets an agent load
only the decisions for the files it touches, and `Confirmation` turns each decision into rules a
reviewer or script can check, which AGENTS.md sections and PR history cannot do.

### Consequences
- Good, because planners and reviewers have one place to check a change against.
- Good, because superseding keeps the history of why a choice changed.
- Bad, because every real decision costs a short document and a human review step.
- Bad, because the index must be kept in sync with the files.

### Confirmation
- RULE: Every file in `docs/decisions/architecture/` except `README.md` and `_template.md` is named `NNNN-<slug>.md` and has `status`, `date`, `scope` frontmatter.
  CHECK: reviewer
- RULE: Every ADR file has a row in `docs/decisions/architecture/README.md`.
  CHECK: reviewer
- RULE: Agents create ADRs only with `status: proposed`.
  CHECK: reviewer
