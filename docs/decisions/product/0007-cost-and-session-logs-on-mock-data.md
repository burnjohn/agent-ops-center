---
status: proposed
date: 2026-10-24
decision-makers: []  # drafted by Claude 2026-10-24 at Ivan Lapa's request, awaiting review
affects: ["docs/specs/abstract-project-spec.md"]
supersedes: []
superseded-by: []
---

# PDR-0007: Usage & Cost and Session Log screens ship on mock data only

## Context
The spec listed token and cost accounting as out of scope. Operator now needs to see what agent runs cost
and to open any agent and read the full log of its sessions (for example, a Claude Code session). Live
capture of tokens and transcripts is not designed yet and partly conflicts with INT-09 (telemetry must not
carry file contents or command output).

## Considered Options
- Add both screens now, backed by a fixed, clearly labelled mock dataset; live capture later
- Add both screens together with live capture from real agents
- Keep cost and session logs out of scope

## Decision
Chosen option: "Both screens on mock data", because it lets UI design and implementation of the screens
start now without deciding how transcripts and token counts are collected and how that fits INT-09.

### Consequences
- Good, because the screens and their navigation can be designed and demoed immediately.
- Good, because the data source can be swapped later without changing screen behaviour (MOCK-05).
- Bad, because the numbers are not real until a follow-up decision on live capture.

### Guardrails
- RULE: Every view showing mock data is labelled `Mock Data` in the UI.
- RULE: Mock agents and tickets are the same ones that appear on Agent Board and Mission Control.
- RULE: Live capture of tokens or logs needs its own PDR and ADR before it enters any spec.
