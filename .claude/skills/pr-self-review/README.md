# PR Self-Review Skill

Automated pre-push code review orchestrator for this repository.

## What it does

Runs before `git push` (via `PreToolUse` hook) or on demand. Collects the git diff against `origin/main`, routes changed files into buckets derived from the `AGENTS.md` Modules table and file extensions, spawns one sub-agent per bucket applying the relevant skills, checks the diff against accepted ADRs, collects structured findings, and applies a merge gate: **CRITICAL findings block the push**.

## When to invoke

- Manually: `"review my changes"` / `"pr self review"` / `"check before push"`
- Automatically: fires on `PreToolUse(Bash git push*)`

## File structure

```
pr-self-review/
├── SKILL.md                 ← orchestrator — execution algorithm
├── tile.json                ← skill metadata
├── README.md                ← this file
├── references.md            ← all sources and inspirations
└── rules/
    ├── file-routing.md      ← how files are assigned to buckets
    ├── severity-levels.md   ← CRITICAL / HIGH / MEDIUM definitions
    └── output-format.md     ← findings table + PASS/BLOCKER verdict format
```

## Buckets and skills

Module paths come from the **Modules** table in `AGENTS.md` — nothing is hardcoded. Stack skills apply only once an accepted ADR picks that tech.

| Bucket             | Files                                                     | Skills applied                                         |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------ |
| **Tests**          | `*.test.*`, `*.spec.*`, `test_*.py`, `*_test.go`, `e2e/`  | stack test skills (`backend-testing`, `react-testing-library`, …) |
| **Data**           | `.sql`, `migrations/`, schema files                       | `security` + DB skills (`postgresql-table-design`, `drizzle-orm-patterns`, …) |
| **UI Frontend**    | UI extensions, or any source in a UI-purpose module       | `security` + UI skills (`react-best-practices`, `frontend-architecture`, …) |
| **Backend/Domain** | other source files inside a module `Path`                 | `security` + backend skills (`onion-architecture`, `fastify-best-practices`, …) |
| **Root / Tooling** | files outside all module paths                            | `security` (+ `github-workflow-automation` for CI)     |
| **ADR check**      | whole diff                                                | `architecture-decisions` → *Checking a diff*           |

## Severity and merge gate

| Level       | Blocks push? |
| ----------- | ------------ |
| 🔴 CRITICAL | ✅ YES       |
| 🟡 HIGH     | ❌ No        |
| 🔵 MEDIUM   | ❌ No        |

CRITICAL = violated Confirmation rule of an accepted ADR, high-confidence security finding, high/critical dependency vulnerability, failing module test/typecheck command, or a critical stack-specific violation (e.g. Rules of Hooks, layer violation) once an ADR picks that stack.

## Sources

All research URLs → [references.md](references.md)
