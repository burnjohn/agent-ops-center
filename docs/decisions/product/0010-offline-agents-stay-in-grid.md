---
status: accepted
date: 2026-10-24
decision-makers: []  # drafted by Claude 2026-10-24 from Ivan Lapa's answers, awaiting review
affects: ["docs/specs/abstract-project-spec.md"]
supersedes: ["PDR-0005"]
superseded-by: []
---

# PDR-0010: Offline agents stay in the Mission Control grid, dimmed and sorted last

## Context
PDR-0005 (proposed) moved agents that are Offline for over an hour into a collapsed Offline section. The owner
rejected it on 2026-10-24. The prototype keeps Offline agents in the grid with a dimmed card. In the MVP the set
of agents is small and fixed (6 simulated agents), so the grid does not fill up with old runs, and an Offline
agent usually still holds a ticket the Operator has to act on (release it).

## Considered Options
- Keep Offline agents in the grid, dimmed, sorted after all others
- Collapse agents Offline for over 1 h into a separate section (PDR-0005)
- Hide Offline agents

## Decision
Chosen option: "Keep them in the grid, dimmed, sorted last", because the Operator needs to see a silent agent
and the ticket it holds without opening another section, and the MVP agent count is small.

### Consequences
- Good, because a dead agent holding work stays visible next to the working ones.
- Bad, because with many agents in a later iteration the grid can grow long; revisit then.
- Affected: `docs/specs/abstract-project-spec.md` (MC-10).

### Guardrails
- RULE: No spec hides or collapses an agent because it is Offline.
- RULE: No event or session is ever deleted because an agent went Offline.
