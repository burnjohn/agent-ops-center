---
status: accepted
date: 2026-10-24
decision-makers: []  # drafted by Claude 2026-10-24 from Ivan Lapa's answers, awaiting review
affects: ["docs/specs/abstract-project-spec.md"]
supersedes: ["PDR-0003"]
superseded-by: []
---

# PDR-0009: Operator assigns tickets to free agents and moves tickets freely within lifecycle guards; agents still pull in auto-play

## Context
PDR-0003 (proposed) chose "pull only: Operator does not assign tickets". After user feedback on 2026-10-24 the
prototype let the Operator drag a ticket to any column: moving it to In Progress opens "Who takes T-x?" and the
Operator picks a free agent. In the MVP agents only move when the Operator steps them (PDR-0008), so without
assignment a Ready ticket would never reach an agent. The prototype also let the Operator move a ticket from
In Progress to Review, from In Progress to Backlog and from Review back to Ready/Backlog; the owner rejected
those on 2026-10-24. The reservation concept PDR-0003 worried about is solved by "one ticket per agent; busy
agents cannot be picked".

## Considered Options
- Operator assignment plus free moves within guards; agents still pull Ready tickets during auto-play
- Pull only (PDR-0003)
- Free moves to any column, as in the prototype

## Decision
Chosen option: "Operator assignment plus free moves within guards", because the Operator must be able to route
work when agents only move on demand, while the guards keep the rules that make review meaningful: only the
agent submits for review, and work leaves an agent only through an explicit, confirmed release (PDR-0006).

Guarded transitions:
- Backlog, Ready, Done → In Progress: assign modal; pick a free agent; busy agents are disabled.
- Any column → Done: allowed (Review → Done is Approve).
- Done → Backlog / Ready: reopen with confirmation.
- In Progress → Ready: release with confirmation (PDR-0006).
- Review → In Progress: request changes with a required comment.
- Refused: In Progress → Backlog, In Progress → Review by the Operator, Review → Ready / Backlog,
  Backlog / Ready / Done → Review.

### Consequences
- Good, because a Ready ticket always has a way to an agent, with or without auto-play.
- Good, because review stays a statement by the agent, not something the Operator can fake.
- Bad, because there are now two ways work reaches an agent (assign and pull), which the UI must explain.
- Bad, because the prototype allows moves the spec refuses; the UI must follow the spec, not the prototype.
- Affected: `docs/specs/abstract-project-spec.md` (BRD-04 transition table, BRD-11, BRD-12, lifecycle diagram).

### Guardrails
- RULE: An agent holds at most one ticket; the assign modal never lets the Operator pick a busy agent.
- RULE: Assignment is recorded as an Operator event ("assigned to X"), never as an Agent Report.
- RULE: No spec lets the Operator move a ticket into Review.
- RULE: Every refused transition is refused the same way for drag and drop and for the non-drag Move buttons, with the reason shown.
