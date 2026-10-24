# Agents

Custom Claude Code subagents for Agent Ops Center. Each agent is a Markdown file with YAML
frontmatter (`name`, `description`, `model`, `tools`, optional `skills:`) plus a system-prompt body.
Claude routes work to an agent by its `description`, so descriptions are written as trigger rules
("Use proactively when…"). Adapted from the DevDigest course setup; stack-neutral until ADRs pick a stack.

| Agent | Model | Role | Writes |
|-------|-------|------|--------|
| [`researcher`](./researcher.md) | sonnet | Read-only research (project + internet), strict structured output | nothing |
| [`spec-creator`](./spec-creator.md) | opus | Writes the feature spec with EARS criteria and PDR/ADR constraints | `docs/specs/<feature>.md` |
| [`implementation-planner`](./implementation-planner.md) | opus | Verifies requirements, checks ADRs, produces a phased plan | `docs/plans/<feature>.md` |
| [`implementer`](./implementer.md) | sonnet | Implements ONE plan task inside its Owned paths, self-verifies | code |
| [`test-writer`](./test-writer.md) | sonnet | Writes tests per module conventions, self-verifies | test files |
| [`architecture-reviewer`](./architecture-reviewer.md) | sonnet | Read-only structural review + ADR Confirmation rules | nothing |
| [`architecture-reviewer-lite`](./architecture-reviewer-lite.md) | sonnet | Relaxed variant of the reviewer for quick passes | nothing |
| [`plan-verifier`](./plan-verifier.md) | sonnet | Read-only check: every acceptance criterion and plan item is done | nothing |
| [`doc-writer`](./doc-writer.md) | sonnet | Docs (Diátaxis + Mermaid), proposed ADR/PDR drafts | `docs/**`, module docs |

## Workflow

```
human ── decides ──> docs/decisions/{product,architecture}/   (agents only propose)
  └─ spec-creator ──> docs/specs/<feature>.md
       └─ implementation-planner ──> docs/plans/<feature>.md
            └─ run-plan skill: implementer(s) ∥ test-writer   (non-overlapping Owned paths)
                 └─ plan-verifier + architecture-reviewer ──> pr-self-review (pre-push hook)
                      └─ engineering-insights ──> insights/, <module>/insights/
                           └─ workflow-retro ──> docs/retros/ledger.md
```

This follows Claude Code's Explore → Plan → Implement → Commit loop: planning is read-only, implementers
work from a written plan, review runs in a fresh context.

## Shared contracts

- **Modules** come from the table in `/AGENTS.md`: path, test command, typecheck command. No agent
  hardcodes module names or commands.
- **Decisions**: every agent reads the ADR/PDR indexes; accepted records bind, proposed ones block.
- **Self-learning**: agents read `insights/` and `<module>/insights/` before work and append via the
  `engineering-insights` skill after it.

## Sources

- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) — `description` as routing signal, `skills:` preload
- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) — Explore → Plan → Implement, plan as handoff artifact
- [wshobson/agents](https://github.com/wshobson/agents) — model tiering (opus for design, sonnet for execution)
