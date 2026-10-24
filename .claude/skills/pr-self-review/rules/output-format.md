# Output Format

## Final report structure

Always output in this exact format. No free text outside this structure.

---

> Module paths below (`web/`, `api/`) are illustrative — real ones come from the AGENTS.md Modules table.

```
## 🔍 PR Self-Review Report

⚠️  Large PR detected: 52 files, 1240 lines changed.     ← only if threshold exceeded
Consider splitting into smaller PRs for more accurate review.

### Files analyzed
- UI Frontend: N files
- Backend/Domain: N files
- Data: N files
- Tests: N files
- Root / Tooling: N files
- ADRs checked: ADR-NNNN, ADR-MMMM (or "none accepted yet")

### Findings

| Severity | File:Line | Issue | Fix | Skill |
|---|---|---|---|---|
| 🔴 CRITICAL | web/src/runs/RunList.tsx:47 | Duration calculation inside JSX render | Extract to useRunDurations hook | react-best-practices |
| 🔴 CRITICAL | api/src/runs/runs.controller.ts:112 | [ADR-0003] controller queries the database directly | Move query to RunRepository | architecture-decisions |
| 🟡 HIGH | web/src/runs/RunList.tsx:0 | Source changed but no test file updated | Update RunList.test.tsx | pr-self-review |
| 🔵 MEDIUM | api/src/runs/runs.service.ts:34 | Missing input validation at boundary | Parse input with the schema | security |

### Ignored lines
- web/src/lib/legacy.ts:88 — intentional any cast until migration complete

---

🚫 BLOCKER — 2 CRITICAL issues must be fixed before push
```

**Or if no critical issues:**

```
---

✅ PASS — no critical issues found

### 📝 Suggested PR Description

## What changed
Adds a status filter to the agent run list with activeStatus state.

## Modules affected
- web/ — RunList: filter UI, constants, helpers
- api/ — no changes

## Decisions
- none

## How to test
- [ ] Open the run list, pick a status filter, verify only matching runs are shown

## Screenshots
<!-- Add screenshot or GIF of UI changes if applicable -->
```

---

## Rules for filling the table

- **Severity** — emoji + label: `🔴 CRITICAL`, `🟡 HIGH`, `🔵 MEDIUM`
- **File:Line** — relative path from repo root + `:line`. Use `0` if line unknown (e.g. missing test file, failed module command)
- **Issue** — one sentence, max 10 words, factual. No "you should", no "consider"
- **Fix** — one sentence, max 10 words, actionable. Start with a verb
- **Skill** — exact skill folder name (e.g. `security`, `architecture-decisions`)

## Sorting

Sort findings by severity descending: CRITICAL first, then HIGH, then MEDIUM.
Within the same severity, sort by file path alphabetically.

## Empty state

If diff has zero files after filtering:

```
## 🔍 PR Self-Review Report

No changed files to review (all filtered as noise or no diff found).

✅ PASS
```

## Verdict line

Always the last line of the report. One of:

- `🚫 BLOCKER — N CRITICAL issue(s) must be fixed before push`
- `✅ PASS — no critical issues found`
