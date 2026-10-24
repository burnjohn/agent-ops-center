# Project Gotchas

Known traps every agent should know before touching the repo. Short, curated, one heading per trap.
Promote an entry here from `INSIGHTS.md` when it bites more than once.

## The stack is not chosen yet

Until an accepted ADR in `docs/decisions/architecture/` picks frameworks and tooling, do not scaffold
packages, add dependencies or create module folders. Draft a `proposed` ADR and stop for review.

## Decisions are superseded, never edited

Accepted ADRs and PDRs keep their body as history. To change a decision write a new record with
`supersedes`, then flip the old one's `status` to `superseded`. Editing in place erases the reason.
