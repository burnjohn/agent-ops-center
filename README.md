# Agent Ops Center

Built with AI agents through Spec-Driven Development.

- Agent instructions: [`AGENTS.md`](AGENTS.md) — read natively by Claude Code, Cursor, Codex
- Docs, specs and decisions: [`docs/`](docs/README.md)
- Subagents: [`.claude/agents/`](.claude/agents/README.md) · Skills: [`.claude/skills/`](.claude/skills/README.md)
- What agents learned: [`insights/`](insights/INSIGHTS.md)

## How we work

1. Record product and technical choices as PDRs/ADRs in `docs/decisions/`.
2. `spec-creator` → `docs/specs/<feature>.md`.
3. `implementation-planner` → `docs/plans/<feature>.md`.
4. `implementer` / `test-writer` build it; `plan-verifier` and `architecture-reviewer` check it.
5. `engineering-insights` records what we learned; `workflow-retro` reviews multi-agent runs.
