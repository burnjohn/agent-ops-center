# Run Plan Skill

Implementation Plan executor. One command takes an **already-approved** plan in
`docs/plans/<feature>.md` and drives it to reviewed code — dispatching the project's agents
(`.claude/agents/`), keeping its own context lean (only short agent reports), and resolving review
comments in a bounded fix loop.

Spec authoring (`spec-creator`) and planning (`implementation-planner`) are run **separately**
beforehand. This command starts from the plan.

## What it does

Runs in the main session as the **orchestrator**. It never implements, tests or reviews itself — it
spawns the agents, runs independent ones concurrently, and resolves architecture-review +
traceability comments through a bounded fix loop. It never pushes or merges.

```
args: plan:<path>  [mode:multi|single]  [tests:plan|on|off]  [max-fix:N]
  └─ read plan (tasks · DAG · owned paths · execution mode) + AGENTS.md Modules table + ADR/PDR ids
       └─ implementer ×N  /  test-writer ×N   (by task Type; parallel by non-overlapping owned paths)
            └─ architecture-reviewer ‖ plan-verifier   (parallel, read-only)
                 └─ fix loop ×≤max-fix   (fix crit/high + missing/partial → re-review changed files)
                      └─ final report  +  "run pr-self-review before push"
```

## When to invoke

- `/run-plan plan:docs/plans/<feature>.md` (optionally `mode:single`, `tests:on`, `max-fix:2`)
- Phrases: "run the plan", "execute the plan", "implement docs/plans/<x>.md".

## Inputs

| Token | Meaning | Default |
|-------|---------|---------|
| `plan:<path>` | Approved plan in `docs/plans/`. **Required.** | — |
| free-text prose | Notes/constraints for this run | — |
| `mode:multi` / `mode:single` | Override the plan's Execution mode | read from plan |
| `tests:plan` / `tests:on` / `tests:off` | When test-writer runs | `tests:plan` |
| `max-fix:<n>` | Cap on the fix loop | `3` |

## Agents orchestrated

| Stage | Agent | Role |
|-------|-------|------|
| Build | `implementer` ×N | One non-test task each; parallel by non-overlapping owned paths; self-verifies |
| Build | `test-writer` ×N | `Type: test` tasks (and the optional `tests:on` pass); writes only test files |
| Review | `architecture-reviewer` | Structure + ADR Confirmation rules (read-only) |
| Review | `plan-verifier` | Acceptance-criteria traceability / completeness (read-only) |
| Fix | `implementer` / `test-writer` | Resolve critical/high + missing/partial findings |

Models come from each agent's frontmatter. **Not invoked here:** `spec-creator`,
`implementation-planner` (run beforehand).

## Guardrails

- Starts from a plan — never authors a spec or a plan.
- Never contradicts an accepted ADR/PDR; unmade decisions stop the run for a `proposed` ADR/PDR.
- Test/typecheck commands come from the AGENTS.md Modules table — never hardcoded.
- Never `git push`, merge, or open a PR — ends with a recommendation to run `pr-self-review`.
- Fix loop is bounded by `max-fix`; remaining findings are reported for a human.
- Concurrent agents must own non-overlapping paths.

## File structure

```
run-plan/
├── SKILL.md     ← orchestrator — phased execution algorithm + bounded fix loop
├── tile.json    ← skill metadata
└── README.md    ← this file
```

## Relationship to other skills

`run-plan` builds and reviews a feature **before** push. `pr-self-review` is the **broad pre-push
gate** (security, dependency audit, ADR check, test-coverage, stack checks) that runs at `git push`.
After a run, `engineering-insights` records discoveries and `workflow-retro` analyses the run.
