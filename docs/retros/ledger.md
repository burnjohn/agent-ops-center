# Workflow Retro Ledger

One row per multi-agent run, appended by the `workflow-retro` skill. Full reports live next to this
file as `YYYY-MM-DD-<run>.md`.

| Date | Run | Agents | Wall time | Tokens | Cache % | Outcome | Top recommendation |
|------|-----|--------|-----------|--------|---------|---------|--------------------|
| 2026-10-24 | [mvp-run-plan](2026-10-24-mvp-run-plan.md) — run-plan, 68 tasks (database + server-api + web-ui) | 84 (55 implementer, 21 test-writer, 4 plan-verifier, 2 architecture-reviewer, 1 planner, 1 doc-writer; 0 nested) | 1 h 57 m (Σ 4 h 05 m, 2.1×) | 203.8 M→186.8 k | 93.5 | PASS after 2 fix iterations (~35 findings) | Pair each infra/repo/route task with a real-DB integration check in the same batch |
