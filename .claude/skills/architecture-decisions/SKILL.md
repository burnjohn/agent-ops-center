---
name: architecture-decisions
description: "Write, use and maintain Architecture Decision Records (ADR, MADR 4.0) in docs/decisions/architecture/ within Spec-Driven Development. Use when a technical choice is made or debated (stack, data store, boundaries, cross-cutting policy), when planning a feature that may conflict with existing decisions, when a decision changes, or when verifying a diff/PR against recorded decisions. Triggers: \"ADR\", \"architecture decision\", \"record/document this decision\", \"why did we choose\", \"should we use X or Y\", \"supersede\", \"check against ADRs\", \"архітектурне рішення\", \"запиши рішення\", \"чому ми обрали\"."
---

# Architecture Decisions

An ADR records one decision that constrains future work, together with why it was made and how compliance is checked. Feature specs (`docs/specs/`) describe behavior and become history after merge. ADRs (`docs/decisions/architecture/`) stay in force until superseded, so every new spec and plan is written within them.

Two fields make ADRs usable by agents, not only by humans:
- `scope` — globs of the code the decision governs. An agent loads only the ADRs relevant to the files it touches.
- `Confirmation` — checkable rules. The Verify step and code reviewers test a diff against them.

## When to use which part

| Situation | Section |
|---|---|
| Starting a task, planning a feature | [Using ADRs](#using-adrs) |
| A choice between real alternatives is being made | [Writing an ADR](#writing-an-adr) |
| An accepted decision no longer fits | [Changing a decision](#changing-a-decision) |
| Verify step, PR review | [Checking a diff](#checking-a-diff) |
| No `docs/decisions/architecture/` yet | [Setup](#setup) |

## Is this an ADR?

Write an ADR only if at least one holds:
1. Reversing it would require a team discussion or touch many files.
2. It picks a technology, data store, protocol, or external service.
3. It sets a boundary: layering, module ownership, who may call whom.
4. It is a cross-cutting policy: auth, errors, logging, config, testing strategy.
5. Agents keep re-deciding it differently across sessions.

Not an ADR: naming, formatting, a helper library inside one module, a one-off implementation detail. Those go to AGENTS.md, lint config, or the feature plan (`docs/plans/<feature>.md`).

## Setup

```
docs/decisions/architecture/
  README.md                               # index: one line per ADR
  0001-record-architecture-decisions.md
  0002-<decision-slug>.md
```

- If the repo already keeps decisions elsewhere (`doc/adr`, `docs/decisions`), use that location and numbering.
- `0001` records the convention itself: MADR 4.0 in `docs/decisions/architecture/`, with `scope` and `Confirmation`.
- Add this block to AGENTS.md. Put only the pointer there, not ADR bodies:
  ```markdown
  ## Architecture decisions
  Accepted ADRs live in docs/decisions/architecture/ (index: docs/decisions/architecture/README.md). Before planning a change,
  read the ADRs whose scope matches the files you will touch. If the plan conflicts with an
  accepted ADR or needs a new architectural decision, draft an ADR with status: proposed
  and stop for review. Never edit the decision of an accepted ADR — supersede it.
  ```

In an existing project, do not try to document all past decisions at once. Add an ADR when a decision becomes relevant: a feature touches that area, someone asks "why is it like this?", or an agent makes a choice that contradicts the existing code. Each such moment produces one ADR.

## Using ADRs

During SDD, ADRs enter at each step:

**Specify.** Read `docs/decisions/architecture/README.md`. List the accepted ADRs that constrain the feature in the spec (`docs/specs/<feature>.md`):
```markdown
## Constraints
- ADR-0004 Store review results in Postgres
- ADR-0007 Access the DB only through repositories
```

**Plan.** Open the full text of ADRs whose `scope` overlaps the planned files.
- Plan conflicts with an accepted ADR → stop, quote the conflicting rule, and offer two paths: change the plan, or supersede the ADR.
- Plan requires a new decision that passes the test above → write an ADR with `status: proposed` and reference it in the plan (`docs/plans/<feature>.md`) (`Decisions: ADR-0012 (proposed)`). Stop for human review. Implementation does not start while the ADR is proposed.

**Implement.** Follow the Confirmation rules of the ADRs listed in the spec. If the code cannot follow a rule, return to Plan; do not silently deviate.

**Verify.** Run [Checking a diff](#checking-a-diff).

Answering "why do we do X?" questions: search `docs/decisions/architecture/` first and cite the ADR. If none exists and the answer is architectural, offer to write one.

## Writing an ADR

### Template (MADR 4.0 + scope)

```markdown
---
status: proposed            # proposed | accepted | rejected | deprecated | superseded
date: YYYY-MM-DD
decision-makers: []
scope: ["src/server/db/**"] # globs this decision governs; ["**"] if global
supersedes: []
superseded-by: []
---

# ADR-NNNN: <Decision as a short imperative sentence>

## Context and Problem Statement
<The forces and the question. What hurts, what constraints apply, what must stay true.>

## Considered Options
- <Option A>
- <Option B>

## Decision Outcome
Chosen option: "<Option A>", because <reason tied to the forces in Context>.

### Consequences
- Good, because <...>
- Bad, because <...>

### Confirmation
- RULE: <one checkable statement>
  CHECK: <existing test or lint | new architecture test | grep pattern | reviewer>
```

### How to write each part

**File name and title.** `NNNN-<decision-slug>.md`, 4 digits, sequential, never reused. The title states the decision, not the topic.
- Good: `0007-access-db-only-through-repositories.md`, "Access the DB only through repositories"
- Bad: `0007-database.md`, "Database layer"

**Context.** Describe the problem without the solution. Name concrete forces: load, team size, deadlines, existing systems, cost, what broke before. A reader a year later should understand why the question arose. Stick to what is known; if part of the reasoning is an assumption, say so.

**Considered Options.** At least two real options that someone could defend. "Do nothing" counts if it was a real option. Do not add straw-man options to make the choice look obvious.

**Decision Outcome.** One chosen option and a "because" that refers back to the forces in Context. If the reason is not in Context, Context is incomplete.

**Consequences.** Include the bad ones. An ADR with only good consequences is advocacy, not a record. Name the migration work, the new dependency, what becomes harder.

**Confirmation.** The part that turns an ADR into a specification. Each RULE names concrete paths, imports, APIs or patterns, so a script or a reviewer can decide pass/fail from a diff.
- Good: "Files under `src/app/api/**` do not import from `src/server/db/**`." CHECK: `grep -rn "from '@/server/db" src/app/api`
- Good: "Every LLM call goes through `llmClient` with a Zod output schema." CHECK: reviewer
- Bad: "Code should respect the layered architecture." Nothing to check.

Prefer CHECK types in this order: existing test or lint → new lint or architecture test → grep → reviewer. If no rule can be written, the record is probably a convention for AGENTS.md.

**Scope.** As narrow as the decision really is. A global policy (error handling, logging) gets `["**"]`; a storage decision gets the storage directories. Too broad and every check loads it; too narrow and violations slip through.

**Size.** One decision per ADR. If the text says "and also", split it. A typical ADR fits on one screen.

**Status.** An agent creates ADRs only as `proposed`. A human moves them to `accepted` or `rejected`.

### Example

```markdown
---
status: accepted
date: 2026-09-14
decision-makers: [Ivan]
scope: ["src/review/**"]
supersedes: []
superseded-by: []
---

# ADR-0009: Validate every LLM review output against a Zod schema

## Context and Problem Statement
The reviewer pipeline parses model output into findings. Free-form JSON from the model
occasionally misses fields or invents severities, which broke the findings UI twice.
The product harness runs without a human in the loop, so malformed output must be caught in code.

## Considered Options
- Zod schema validation with one retry on failure
- Provider structured-output mode only
- Lenient parsing with defaults for missing fields

## Decision Outcome
Chosen option: "Zod schema validation with one retry on failure", because it works across
providers and turns malformed output into an explicit, logged failure instead of bad findings.

### Consequences
- Good, because the UI only receives findings that match the contract.
- Good, because validation failures show up in traces and evals.
- Bad, because a retry adds latency and cost on failure.

### Confirmation
- RULE: Every call to `llmClient.complete` in `src/review/**` passes an `outputSchema`.
  CHECK: reviewer
- RULE: `src/review/**` does not call `JSON.parse` on model output directly.
  CHECK: `grep -rn "JSON.parse" src/review`
```

## Changing a decision

An accepted ADR is not edited in place. To change the decision:
1. Write a new ADR with `supersedes: ["ADR-OLD"]`. Its Context explains what changed since the old decision.
2. In the old ADR change only the frontmatter: `status: superseded`, `superseded-by: ["ADR-NEW"]`. The body stays as history.
3. List code that still follows the old decision as migration work in the new ADR's Consequences.
4. Update the index.

Allowed in-place edits: typos, broken links, `scope` globs after a file move.

A decision that is simply no longer relevant (the component was removed) gets `status: deprecated` without a successor.

## Checking a diff

Input: `git diff <base>...HEAD` or a PR.

1. Collect changed paths. Select accepted ADRs whose `scope` matches any of them, plus ADRs with scope `["**"]`.
2. Evaluate every Confirmation rule of the selected ADRs:
   - test or lint → run it;
   - grep → run it on changed files only;
   - reviewer → judge from the diff and quote the lines.
3. Report one finding per violated rule:
   ```
   [ADR-0007] RULE: Files under src/app/api/** do not import from src/server/db/**
   File: src/app/api/reviews/route.ts:12 — import { db } from '@/server/db'
   Fix: use ReviewRepository, or supersede ADR-0007 if the boundary should change.
   ```
4. Flag changes that look like an unrecorded decision: a new dependency, a new top-level directory, a new external service, a new pattern repeated across files. Suggest writing an ADR.
5. Resolution rule: if the code diverges from a correct ADR, fix the code. If the ADR is wrong, supersede it first, then change the code.

## Index

`docs/decisions/architecture/README.md` is regenerated from frontmatter after any change, one line per ADR, so agents can load it cheaply:

```markdown
# Architecture Decision Records

| ADR | Decision | Status | Scope |
|---|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record decisions as MADR 4.0 in docs/decisions/architecture | accepted | ** |
| [0007](0007-access-db-only-through-repositories.md) | Access the DB only through repositories | accepted | src/server/** |
| [0012](0012-cache-diffs-in-redis.md) | Cache PR diffs in Redis | proposed | src/github/** |
| [0003](0003-use-sqlite.md) | ~~Use SQLite for review storage~~ → 0004 | superseded | src/server/db/** |
```

Order: accepted, proposed, then superseded, deprecated, rejected.

## Done checklist
- [ ] The decision passes the "Is this an ADR?" test.
- [ ] Title states the decision; one decision per file.
- [ ] At least two real options; consequences include the bad ones.
- [ ] Every Confirmation rule names concrete code and has a CHECK.
- [ ] `scope` is set and as narrow as the decision.
- [ ] Status is `proposed` unless a human accepted it.
- [ ] Spec/plan reference the ADR; index regenerated.
