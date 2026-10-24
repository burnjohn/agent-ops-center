---
name: run-plan
description: >
  Runs an already-approved Implementation Plan (docs/plans/<feature>.md) end-to-end: dispatches
  implementer and test-writer agents per the plan's DAG (multi-agent by non-overlapping owned paths,
  or single-agent), then gates with architecture-reviewer + plan-verifier in parallel, then resolves
  their comments in a bounded fix loop. Starts FROM a plan — spec authoring (spec-creator) and
  planning (implementation-planner) are run separately beforehand. Never pushes or merges.
  TRIGGER when: "run the plan", "/run-plan", "execute the plan", "implement this plan",
  "implement docs/plans/<x>.md", "run-plan plan:<path>".
  Does NOT cover: writing specs, writing the plan, pushing/merging (run pr-self-review before push).
---

# Run Plan — Implementation Plan executor

> **Take an approved Implementation Plan and drive it to reviewed code: implement and test per the
> DAG, gate with architecture-reviewer + plan-verifier, and resolve their comments in a bounded fix loop.**

You are the **orchestrator**, running in the main session. The spec (`docs/specs/<feature>.md`) and the
plan (`docs/plans/<feature>.md`) already exist and were approved by a human beforehand (`spec-creator`
and `implementation-planner` are **not** part of this command). You do **not** implement, test or
review yourself — you dispatch the project's agents from `.claude/agents/` and keep only their short
final reports in context. Spawn agents with the `Agent` tool; run independent agents **concurrently**
(multiple tool calls in one message).

## Inputs (args)

| Token | Meaning | Default |
|-------|---------|---------|
| `plan:<path>` | Path to the approved plan, normally `docs/plans/<feature>.md`. **Required.** | — |
| free-text prose | Optional notes / constraints for this run (e.g. "skip phase 3 for now"). | — |
| `mode:multi` / `mode:single` | Override the plan's Execution mode. | read from the plan |
| `tests:plan` / `tests:on` / `tests:off` | When to run `test-writer` (see Step 1b). | `tests:plan` |
| `max-fix:<n>` | Cap on the review fix loop (Step 3). | `3` |

If no `plan:` is given, list `docs/plans/*.md`, ask which one, and stop — do not guess. State your
interpretation of the args in one line before starting.

## Guardrails (always)

- **Starts from a plan.** Do not author a spec or a plan here. If the plan is missing or unreadable,
  stop and say so.
- **Respect decisions.** The plan must not contradict an accepted ADR (`docs/decisions/architecture/`)
  or PDR (`docs/decisions/product/`). If a task needs a decision nobody made (new dependency, new
  module, new external service), stop and ask for an ADR/PDR with `status: proposed` — do not let an
  implementer decide it silently.
- **Module commands come from `AGENTS.md`.** Test and typecheck commands are read from the Modules
  table; never hardcode them. A task whose module is not in the table yet must create that row as
  part of the task (and the module's `AGENTS.md`, `CLAUDE.md`, `insights/`), or be blocked.
- **Never `git push`, merge, or open a PR.** The run ends at a review-clean working tree plus a
  recommendation to run `pr-self-review`.
- **Bound the fix loop** to `max-fix` iterations. Never loop forever; if findings remain, stop and
  report them for a human.
- **Respect owned-path non-overlap** whenever you run agents concurrently.
- **Keep context lean.** Hold the plan path and each agent's short report — never paste an agent's
  full working transcript back into your own reasoning.

## Execution algorithm

### Step 0 — Read the plan and context

1. Read the plan file. Extract for every task: `T-id`, `Action`, `Module`, `Type`, `Skills to use`,
   `Owned paths`, `Depends-on`, `Known gotchas`, `Acceptance`. Read the plan's `## Execution mode`
   field; a `mode:` arg overrides it. Build the dependency DAG from `Depends-on`.
2. Read the AGENTS.md **Modules** table and note the Test / Typecheck command of every module the
   plan touches.
3. Note the ADRs/PDRs the spec and plan reference — pass their ids to every agent you spawn.
4. Print a one-line summary of what will run (e.g. "6 tasks (2 test), multi-agent, 3 phases; fix loop max 3").

### Step 1 — Implement

Route each task to an agent by its `Type`:

| Task Type | Agent |
|-----------|-------|
| `test` (writes only test files) | `test-writer` |
| anything else (backend, ui, data, infra, docs-in-code, …) | `implementer` |

**Multi-agent mode** (default when the plan says so):
1. Find the **ready set** — tasks whose `Depends-on` are all complete and whose `Owned paths` do not
   overlap any task already running this batch.
2. Spawn one agent per ready task, **concurrently** (one message, multiple `Agent` calls). Give each
   its full task block, the module's test/typecheck commands, the relevant ADR/PDR ids, **plus the
   list of the other running tasks' `Owned paths`** so it stays in its lane.
3. Wait for the batch, collect reports, mark tasks done.
4. Repeat from (1) until all tasks are complete.

**Single-agent mode:** run the tasks sequentially in plan order, one agent at a time.

Each agent self-verifies (the module's tests + typecheck from the Modules table) before returning.
If one reports **blocked / failing** and cannot fix it in scope: record it, and either dispatch a
targeted retry or surface it to the user — do not silently continue past a red task that others
depend on.

### Step 1b — Test pass (`tests:` arg)

- `tests:plan` (default) — tests are written only by the plan's own `Type: test` tasks.
- `tests:on` — after all implementation tasks are done, spawn `test-writer` per touched module
  (concurrently, owned paths = that module's test files) to cover acceptance criteria that no test
  task covered.
- `tests:off` — skip `Type: test` tasks too; coverage comes only from implementer self-verification.
  Say so in the final report.

### Step 2 — Review gate (parallel, read-only)

Compute the **changed-file set** (`git diff $(git merge-base origin/main HEAD) --name-only` plus
untracked files, or accumulate from agent reports). Then spawn, **concurrently**:

- **`architecture-reviewer`** on the changed-file set → structural findings (severity + rule,
  including violated ADR Confirmation rules) and a PASS/FAIL gate.
- **`plan-verifier`** with the plan + spec + changed set → a traceability matrix (every acceptance
  criterion → evidence) and a PASS/FAIL/REVIEW gate.

Collect both verdicts.

### Step 3 — Fix loop (bounded — this is where review comments get resolved)

Build the **fix backlog**:
- `architecture-reviewer` findings with severity **critical** or **high** (medium/low → report only).
- `plan-verifier` rows with status **missing** or **partial** (a requirement is not actually met).

If the backlog is empty → go to Step 4. Otherwise loop, for iteration `i = 1 … max-fix`:

1. **Group** findings by file / owned-path into non-overlapping fix tasks.
2. **Dispatch** — `implementer` for source fixes, `test-writer` for missing/partial test coverage —
   one per group, concurrent where owned paths are disjoint, each instructed: *"Fix exactly these
   findings in these files, stay in scope, self-verify."* Pass each finding's text, `file:line`,
   and the reviewer's recommendation.
3. Each fix agent self-verifies (module tests + typecheck).
4. **Re-review only the changed files**: re-run `architecture-reviewer` scoped to the touched files;
   re-run `plan-verifier` only for the requirements that were `missing`/`partial`.
5. Recompute the backlog:
   - empty → **break (gate PASS)**.
   - non-empty but **no progress** since last iteration (same findings unresolved) → break and flag as
     stuck for the user.
   - otherwise → continue to the next iteration.

A finding that says "the ADR itself is wrong" is never fixed in the loop — stop and propose
superseding the ADR (`architecture-decisions` skill).

If `max-fix` is reached with a non-empty backlog → stop and list the remaining findings for a human
decision. Never exceed the cap.

### Step 4 — Final report and learning

1. Output the summary below.
2. Recommend `engineering-insights` if agents reported non-obvious discoveries, and `workflow-retro`
   for a retrospective of this multi-agent run (appends to `docs/retros/ledger.md`).
3. Recommend running **`pr-self-review`** before push. Do **not** push, merge, or open a PR.

## Output format (final report)

```
## Run Plan — <feature>

- **Plan:** `docs/plans/<feature>.md` — mode: multi-agent | single-agent — tests: plan | on | off
- **Decisions respected:** ADR-NNNN, PDR-NNNN (or "none referenced")
- **Implemented:** <N> tasks (T1…Tn) — <one line>
- **Tests written:** <N> test tasks / test-writer passes — <one line>
- **Self-verify:** module tests + typecheck green | failing (<module: detail>)

### Review gate
- architecture-reviewer: PASS | FAIL — <crit/high counts>
- plan-verifier: PASS | FAIL | REVIEW — <verified N/M; missing/partial ids>

### Fix loop
- iterations run: <i> / <max-fix>
- resolved: <findings fixed>
- **remaining (needs human):** <list, or "none">

### Next step
Run `pr-self-review` before pushing. (Not pushed — by design.)
Optional: `engineering-insights`, `workflow-retro`.
```

## When you cannot proceed

If `plan:` is missing or the plan is unreadable, a task needs an unmade decision, or an agent is
blocked on something only a human can decide — stop and say plainly what you need. A clear
"blocked here, need X" is a valid result; a half-run pretending to be complete is not.
