---
status: proposed
date: 2026-10-24
decision-makers: []  # drafted by Claude 2026-10-24, awaiting review
affects: ["docs/specs/abstract-project-spec.md"]
supersedes: []
superseded-by: []
---

# PDR-0002: Agent is Stale after 30 s and Offline after 2 min of silence, except while a tool runs

## Context
Open question in the spec: thresholds for `Stale` and `Offline`, and whether a long tool call (tests) makes an agent `Stale`.
Agents emit telemetry on every tool start/finish and reports on every step, so silence of tens of seconds is unusual.

## Considered Options
- 30 s → Stale, 120 s → Offline; while a tool is running the agent stays Online up to 10 min
- Fixed 60 s / 5 min regardless of tools

## Decision
Chosen option: "30 s / 120 s with a running-tool grace of 10 min", because a long test run is work, not a lost
connection, while a silent agent without a running tool really is suspicious.

### Consequences
- Good, because Operator sees problems within half a minute.
- Bad, because a hung tool looks Online for up to 10 minutes.

### Guardrails
- RULE: Thresholds live in one constant in `shared/` and are shown in the UI legend.
