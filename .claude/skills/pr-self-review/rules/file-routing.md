# File Routing Rules

## Inputs

1. The changed file list after noise filtering (SKILL.md Step 2).
2. The **Modules** table in root `AGENTS.md` — columns `Module | Path | Purpose | Test command | Typecheck command`.
   This is the only source of module paths. Never hardcode module names or paths in this skill.

Map each file to its module by longest matching `Path` prefix. A file under no module `Path` is **root-level**.

Assign each file to exactly one bucket using the rules below in order (first match wins). Tests are checked first and override everything else.

---

## Priority 0 — Tests (checked first, overrides all)

Any test file anywhere in the repo → **Tests** bucket:

```
*.test.*            foo.test.ts, foo.test.tsx, foo.test.js
*.spec.*            foo.spec.ts
test_*.py, *_test.py
*_test.go
**/__tests__/**
**/tests/**, **/test/**   (test sources; skip pure fixtures/setup data)
**/e2e/**
```

---

## Priority 1 — Data

Schema and migration files in any module:

```
**/*.sql
**/migrations/**
**/schema.*            ORM / schema definition files
```

---

## Priority 2 — UI Frontend

Either condition:

- File extension is a UI extension: `.tsx`, `.jsx`, `.vue`, `.svelte`, `.css`, `.scss`, `.sass`, `.less`, `.html`
- File is any source file inside a module whose **Purpose** in the Modules table describes a UI (frontend, web app, UI, dashboard, client app)

---

## Priority 3 — Backend/Domain

Any other source file (`.ts`, `.js`, `.mjs`, `.py`, `.go`, `.rs`, `.java`, `.kt`, `.rb`, `.cs`, …) inside a module listed in the Modules table.

---

## Priority 4 — Root / Tooling

Source or config files outside every module path: build scripts, CI workflows (`.github/**`), `.claude/**`, root tooling config.
Reviewed only by the ADR check (Step 6) and `security`; no stack skills unless an ADR picks the tooling (e.g. GitHub Actions).

---

## Bucket summary

| File                                                              | Bucket          |
| ----------------------------------------------------------------- | --------------- |
| Test file patterns (Priority 0)                                    | Tests           |
| `.sql`, `migrations/`, schema files                                | Data            |
| UI extension, or any source in a UI-purpose module                | UI Frontend     |
| Other source file inside a Modules-table `Path`                    | Backend/Domain  |
| Source/config outside all module paths                             | Root / Tooling  |
| Filtered as noise in Step 2                                        | **Skip**        |

If the Modules table is empty (no modules yet), only Tests / Data / UI-by-extension / Root / Tooling apply.

---

## ADR check (special case — not a bucket)

Always run, regardless of buckets: check the whole diff against accepted ADRs using the
`architecture-decisions` skill, section **Checking a diff** (SKILL.md Step 6).
An ADR's `scope` globs decide which changed files it applies to.
