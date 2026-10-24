# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- Subagents live in `.claude/agents/` (overview: `.claude/agents/README.md`). Route work to them by
  their `description`; the main session orchestrates and keeps the human in the loop.
- Skills live in `.claude/skills/`; agents preload theirs through the `skills:` frontmatter.
- Hooks and env are in `.claude/settings.json`. Personal overrides go to `.claude/settings.local.json`
  (git-ignored).
