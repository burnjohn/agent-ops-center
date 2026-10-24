# AGENTS.md

Instructions for AI coding agents (Claude Code, Cursor, Codex, …) working in this repository.
This is the single source of truth. Claude Code (v2.1.277+) reads it natively — do not add a `CLAUDE.md`:
while any `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists, Claude Code ignores this file.

## Project

**Agent Ops Center** — the product is defined in `docs/decisions/product/` and `docs/specs/`.
The stack is **not chosen yet**: until an accepted ADR fixes it, do not scaffold frameworks,
add dependencies or create packages on your own. Propose an ADR first (see below).

## Repository layout

```
AGENTS.md                    project-wide agent instructions (this file)
.claude/agents/              subagents: researcher, spec-creator, implementation-planner,
                             implementer, test-writer, architecture-reviewer, plan-verifier, doc-writer
.claude/skills/              on-demand skills (catalog: .claude/skills/README.md)
docs/architecture/           how the system is built (overview, modules, diagrams)
docs/specs/                  feature specs — WHAT and WHY, EARS acceptance criteria
docs/decisions/architecture/ ADRs (MADR 4.0) — technical decisions that constrain the code
docs/decisions/product/      PDRs — product decisions that constrain the specs
docs/plans/                  implementation plans written by implementation-planner
docs/retros/                 workflow retrospectives + ledger.md
insights/                    project-wide self-learning notes (INSIGHTS.md, gotchas.md)
<module>/                    each package/app, once created (see Modules)
```

## Modules

No modules yet. When a module (package/app) is created, add a row here and give it:
`<module>/AGENTS.md`, `<module>/insights/INSIGHTS.md`
and `<module>/insights/gotchas.md`. Agents read this table to know which modules exist.

| Module | Path | Purpose | Test command | Typecheck command |
|--------|------|---------|--------------|-------------------|
| — | — | — | — | — |

## Workflow: Spec-Driven Development

Work goes through these steps. Do not skip to code.

1. **Decide** — product choices → PDR in `docs/decisions/product/`; technical choices → ADR in
   `docs/decisions/architecture/`. Agents create decisions only with `status: proposed`;
   a human accepts them.
2. **Specify** — `spec-creator` writes `docs/specs/<feature>.md` (template: `docs/specs/_template.md`).
   The spec lists the PDRs and ADRs that constrain it.
3. **Plan** — `implementation-planner` writes `docs/plans/<feature>.md`: phased tasks with
   Type · Skills · Owned paths · Depends-on · Acceptance.
4. **Implement** — `implementer` (one task each, parallel-safe via non-overlapping Owned paths),
   `test-writer` for tests. Orchestrate a whole plan with the `run-plan` skill.
5. **Verify** — `plan-verifier` (every acceptance criterion done), `architecture-reviewer`
   (structure + ADR Confirmation rules), `pr-self-review` skill before push.
6. **Learn** — `engineering-insights` skill appends discoveries to `insights/`;
   `workflow-retro` skill after multi-agent runs → `docs/retros/ledger.md`.

## Architecture decisions

Accepted ADRs live in `docs/decisions/architecture/` (index: `docs/decisions/architecture/README.md`).
Before planning a change, read the ADRs whose `scope` matches the files you will touch. If the plan
conflicts with an accepted ADR or needs a new architectural decision, draft an ADR with
`status: proposed` and stop for review. Never edit the decision of an accepted ADR — supersede it.
Skill: `architecture-decisions`.

## Product decisions

Accepted PDRs live in `docs/decisions/product/` (index: `docs/decisions/product/README.md`).
Specs must not contradict an accepted PDR. If a spec needs a product choice nobody made yet
(audience, scope, pricing, UX principle, what is out of scope), draft a PDR with
`status: proposed` and ask the human. Skill: `product-decisions`.

## Self-learning loop

The repository remembers what agents learn, so the next session does not repeat the same mistakes.

- **Before work:** read `insights/gotchas.md` and `insights/INSIGHTS.md`, plus
  `<module>/insights/*` for every module you touch. Read only the modules you touch.
- **After work:** if you found something non-obvious — a dead end with its reason, a library quirk,
  a decision with trade-offs, a user correction — run the `engineering-insights` skill. It appends
  dated entries with a `ref: file:line` anchor. Append-only; never rewrite existing entries.
- `gotchas.md` = known traps (curated, short). `INSIGHTS.md` = dated log from real sessions.
- A rule that keeps coming up in insights belongs in this file or in an ADR — promote it.

## Rules

- Keep diffs in scope: no drive-by refactors, renames or "improvements" outside the task.
- Never commit secrets. Secrets come from env/secret files listed in `.gitignore`.
- Conventional commits (`git-workflow` skill). Branch from `main`; never push to `main` directly.
- Reply to the user in the language they wrote in; code, identifiers and docs stay in English.

## Claude Code specifics

- Subagents live in `.claude/agents/` (overview: `.claude/agents/README.md`). Route work to them by
  their `description`; the main session orchestrates and keeps the human in the loop.
- Skills live in `.claude/skills/`; agents preload theirs through the `skills:` frontmatter.
- Hooks and env are in `.claude/settings.json`. Personal overrides go to `.claude/settings.local.json`
  (git-ignored). For personal instructions use `~/.claude/CLAUDE.md`, not a `CLAUDE.local.md` here.

## Read when

- **Starting any task** → `insights/gotchas.md`, then the relevant `docs/decisions/*/README.md`
- **Writing a spec** → `docs/specs/README.md`, `docs/decisions/product/README.md`
- **Planning or changing structure** → `docs/architecture/README.md`, `docs/decisions/architecture/README.md`
- **Choosing a library, store, protocol or boundary** → `architecture-decisions` skill
- **Hit unexpected behavior** → `insights/gotchas.md`, `<module>/insights/gotchas.md`
- **Picking a skill** → `.claude/skills/README.md`
