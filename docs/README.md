# Docs

| Folder | What lives there | Written by | Changes |
|--------|------------------|------------|---------|
| [`architecture/`](architecture/README.md) | How the system is built: overview, modules, data flow, diagrams | `doc-writer`, humans | Kept current with the code |
| [`specs/`](specs/README.md) | Feature specs — what and why, EARS acceptance criteria | `spec-creator` | Become history after the feature ships |
| [`decisions/architecture/`](decisions/architecture/README.md) | ADRs (MADR 4.0) — technical decisions with `scope` and `Confirmation` | humans, agents propose | Superseded, never edited |
| [`decisions/product/`](decisions/product/README.md) | PDRs — product decisions with guardrails | humans, agents propose | Superseded, never edited |
| [`plans/`](plans/) | Implementation plans — phased tasks for implementers | `implementation-planner` | One per feature |
| [`retros/`](retros/ledger.md) | Workflow retrospectives and the trend ledger | `workflow-retro` skill | Append-only |

Order of authority: accepted PDRs and ADRs → specs → plans → code. If a lower level contradicts a
higher one, fix the lower level or supersede the decision first.
