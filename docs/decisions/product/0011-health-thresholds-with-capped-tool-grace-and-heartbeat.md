---
status: accepted
date: 2026-10-24
decision-makers: []  # drafted by Claude 2026-10-24 from Ivan Lapa's answers, awaiting review
affects: ["docs/specs/abstract-project-spec.md"]
supersedes: ["PDR-0002"]
superseded-by: []
---

# PDR-0011: Agent is Stale after 30 s and Offline after 2 min of silence; a running tool keeps it Online for at most 10 min; a waiting agent with a heartbeat stays Online

## Context
PDR-0002 (proposed) set 30 s / 120 s with an exception "while a tool runs". Its title states the exception
without a cap, while its decision text mentions a 10-minute grace, so the two read differently. The prototype
implements the exception with no cap (a hung tool looks Online forever). The prototype also shows a second
problem: a Blocked agent sends a signal every 18 s and an agent in Review every 60 s, so the agent in Review
flips between Online and Stale while it is legitimately waiting for the Operator. The owner confirmed on
2026-10-24: 30 s / 120 s, tool grace capped at 10 min, waiting agents stay Online while their heartbeat is
more frequent than every 30 s. Superseding (rather than editing) keeps PDR-0002 as history.

## Considered Options
- 30 s / 120 s; running tool keeps Online for at most 10 min; waiting (Blocked, Awaiting Review) agents send a heartbeat more often than every 30 s
- PDR-0002 as written (tool exception, cap only in the decision text, no rule for waiting agents)
- Longer fixed thresholds (60 s / 5 min) with no exceptions

## Decision
Chosen option: "30 s / 120 s with a 10-minute tool cap and a heartbeat for waiting agents", because a long
test run is work and a waiting agent is healthy, but neither may hide an agent that is really gone.

### Consequences
- Good, because the Operator sees a silent agent within half a minute and a hung tool within 10 minutes.
- Good, because Blocked and Awaiting Review agents no longer flap between Online and Stale.
- Bad, because a hung tool still looks Online for up to 10 minutes.
- Bad, because simulated agents must emit a heartbeat while waiting, and real agents (next iteration) will need one too.
- Affected: `docs/specs/abstract-project-spec.md` (MC-05, SIM-10).

### Guardrails
- RULE: The spec states the thresholds as 30 s (Stale), 120 s (Offline) and a 10-minute cap for the running-tool exception.
- RULE: The thresholds are shown to the Operator in the UI.
- RULE: A waiting agent's heartbeat interval in any spec or simulation is shorter than 30 s.
