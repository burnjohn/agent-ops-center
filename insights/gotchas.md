# Project Gotchas

Known traps every agent should know before touching the repo. Short, curated, one heading per trap.
Promote an entry here from `INSIGHTS.md` when it bites more than once.

## The stack is fixed by ADRs

Stack fixed by ADR-0002, ADR-0004 and ADR-0008 through ADR-0012; only T01 adds dependencies.
Manifests and `pnpm-lock.yaml` are frozen after T01 — a new dependency needs an ADR first.

## Decisions are superseded, never edited

Accepted ADRs and PDRs keep their body as history. To change a decision write a new record with
`supersedes`, then flip the old one's `status` to `superseded`. Editing in place erases the reason.
