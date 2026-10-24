---
name: pr-self-review
description: >
  PR self-review orchestrator. Runs before git push (PreToolUse hook) or on demand.
  Collects the git diff against the merge-base with origin/main, routes changed files into buckets
  (UI Frontend, Backend/Domain, Data, Tests) derived from the AGENTS.md Modules table and file
  extensions, spawns one sub-agent per bucket, checks the diff against accepted ADRs, collects
  structured findings, deduplicates, and applies the merge gate: CRITICAL findings block the push.
  Non-critical findings are reported as HIGH / MEDIUM recommendations.
  TRIGGER when: "review my changes", "self review", "pr review", "check before push",
  "pr self review", "review pr", "check my diff", or automatically on PreToolUse(Bash git push).
  Does NOT cover: generated code, lockfiles, node_modules / build output, deployment config.
---

# PR Self-Review

> **Review your changes locally before opening a PR. Catch critical problems before they reach review.**

## How to invoke

- **Manually:** "review my changes" / "pr self review" / "check before push"
- **Automatically:** fires on `PreToolUse` when a `git push` command is detected

## Setup (one-time)

Add the following to `.claude/settings.json` to enable the automatic `git push` hook:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash(git push*)",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Before executing this git push command, invoke the pr-self-review skill and follow its execution algorithm exactly."
          }
        ]
      }
    ]
  }
}
```

For manual invocation, no setup needed — just ask Claude to run the skill.

## Execution algorithm

### Step 1 — Collect diff

```bash
git diff $(git merge-base origin/main HEAD)...HEAD --name-only --diff-filter=AM
```

`--diff-filter=AM` — only Added and Modified files. Skip Deleted/Renamed.

### Step 1.5 — Diff size guard

Count total changed lines:

```bash
git diff $(git merge-base origin/main HEAD)...HEAD --stat | tail -1
```

- If **files > 50** OR **lines changed > 1000** → print a warning before the report:
  ```
  ⚠️  Large PR detected: N files, N lines changed.
  Consider splitting into smaller PRs for more accurate review.
  ```
  Continue the review regardless — this is a warning, not a blocker.

### Step 2 — Filter noise

Exclude the following from analysis (do not pass to sub-agents):

- dependency / build output: `**/node_modules/**`, `**/vendor/**`, `**/dist/**`, `**/build/**`, `**/.next/**`, `**/target/**`, `**/__pycache__/**`
- generated files and lockfiles: `**/*.lock`, `**/package-lock.json`, `**/pnpm-lock.yaml`, `**/*.generated.*`, `**/*.min.*`
- `**/*.log`
- prose and data: `**/*.md`, `**/*.json` (but keep dependency manifests for Step 6.6)

Keep `docs/decisions/**` changes in mind for Step 6 (a changed ADR changes what the code is checked against), even though `*.md` is not sent to sub-agents.

Also skip any **line** in a file that has the annotation (in the language's comment syntax):

```
// pr-self-review-ignore: <reason>
```

Do not report findings on that line. The reason is logged in the report footer as: `Ignored: file:line — reason`.

### Step 3 — Route files to buckets

Read the **Modules** table in `AGENTS.md` first — it is the only source of module paths, test commands and typecheck commands. Never hardcode module paths. Then route by module + file extension. See [file-routing](rules/file-routing.md) for exact rules.

| Bucket             | Rule (first match wins, Tests first)                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| **Tests**          | Test files in any location: `*.test.*`, `*.spec.*`, `test_*.py`, `*_test.py`, `*_test.go`, files under `__tests__/`, `tests/`, `e2e/` |
| **UI Frontend**    | UI extensions: `.tsx`, `.jsx`, `.vue`, `.svelte`, `.css`, `.scss`, `.html` — or any source file in a module whose Purpose is UI / frontend / web app |
| **Data**           | Schema & migrations: `.sql`, `**/migrations/**`, `**/schema.*`, ORM schema files                     |
| **Backend/Domain** | Any other source file (`.ts`, `.js`, `.py`, `.go`, `.rs`, `.java`, `.kt`, …) inside a module listed in the Modules table |
| **Root / Tooling** | Source or config outside every module path (scripts, CI, `.claude/`) — reviewed only by the ADR check (Step 6) and security |

If a bucket has zero files after filtering → skip that sub-agent entirely. If the Modules table is empty, everything that is not Tests / Data / UI by extension goes to **Root / Tooling**.

### Step 4 — Spawn sub-agents (fan-out, parallel)

Spawn **one sub-agent per non-empty bucket**. Each sub-agent receives:

1. Only its slice of the diff — **full `git diff` content** (not just file names) for each file in the bucket
2. Explicit skill rules extracted from each assigned skill file
3. The structured output schema (see Step 5)

**Diff format to pass to sub-agents:**

```bash
# Get full diff content for specific files only:
git diff $(git merge-base origin/main HEAD)...HEAD -- <file1> <file2> ...
```

If the total diff content exceeds ~8000 tokens, split into batches of files and spawn multiple sub-agents per bucket, merging their findings afterward.

**Sub-agent instructions template:**

```
You are a code reviewer for this repository. Stack and constraints: <one line per accepted ADR that fixes the stack, from docs/decisions/architecture/README.md>.

Invoke each of the following skills in order using the Skill tool, then apply their rules to the diff:
  1. Call the Skill tool with skill: "<skill-name>" — read its rules and check the diff against them
  [repeat for each skill in this bucket]

For each violation found, return a finding in this exact JSON format:
{ "file": "path/to/file.ext", "line": 42, "severity": "CRITICAL|HIGH|MEDIUM", "skill": "skill-name", "issue": "one sentence", "fix": "one sentence" }

Return ONLY a JSON array of findings. No prose. No explanations outside the array.
If no issues found, return [].

Changed files diff:
[FULL GIT DIFF CONTENT]
```

**Important:** The sub-agent must call the Skill tool for each assigned skill — it does not automatically know the rules unless it loads each skill file via the Skill tool. Listing skill names without calling the tool = no rules loaded = hallucinated review.

**Skill assignments per bucket.** Always-on skills apply regardless of stack. Stack skills apply **only once an accepted ADR picks that tech** — check `docs/decisions/architecture/README.md`; never assign a skill for a technology the project has not chosen.

| Bucket         | Always-on               | Stack skills (only if an accepted ADR picks the tech)                                                                 |
| -------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| UI Frontend    | `security`              | React → `react-best-practices`, `frontend-architecture`; Next.js → `next-best-practices`; TypeScript → `typescript-expert`; Zod → `zod`; React Hook Form → `react-hook-form` |
| Backend/Domain | `security`              | Onion/layered architecture → `onion-architecture`; Fastify → `fastify-best-practices`; Express → `express-best-practices`; TypeScript → `typescript-expert`; Zod → `zod` |
| Data           | `security`              | PostgreSQL → `postgresql-table-design`; Drizzle → `drizzle-orm-patterns`                                              |
| Tests          | —                       | Backend tests → `backend-testing`; React → `react-testing-library`; TypeScript → `typescript-expert`                  |
| Root / Tooling | `security`              | GitHub Actions → `github-workflow-automation`                                                                         |

If a bucket ends up with no skills at all, still spawn it with `security` only (Tests: skip).

### Step 5 — Collect and deduplicate findings

Collect findings arrays from all sub-agents. Deduplicate on `file + line`: if two skills report the same `file:line`, keep the one with higher severity; if equal severity, merge `issue` fields.

### Step 6 — Check the diff against accepted ADRs

Run separately from the bucket sub-agents. Invoke the `architecture-decisions` skill and follow its **Checking a diff** section with base `$(git merge-base origin/main HEAD)`:

1. Select accepted ADRs in `docs/decisions/architecture/` whose `scope` matches any changed path, plus ADRs with scope `["**"]`.
2. Evaluate every Confirmation rule (run tests/lint/grep on changed files; judge reviewer rules from the diff and quote the lines).
3. Each violated Confirmation rule → **CRITICAL** finding:

```json
{
  "file": "path/to/file.ext",
  "line": 12,
  "severity": "CRITICAL",
  "skill": "architecture-decisions",
  "issue": "[ADR-NNNN] violates: <rule>",
  "fix": "Change the code, or supersede ADR-NNNN first"
}
```

4. A change that looks like an unrecorded decision (new dependency, new top-level directory, new external service, new pattern repeated across files) → **HIGH** finding with `fix: "Draft an ADR with status: proposed"`.

If there are no accepted ADRs yet, skip steps 1–3 but still run step 4.

### Step 6.5 — Test coverage gate

For each changed source file (UI Frontend, Backend/Domain, Data buckets), check if a corresponding test file was also changed — same base name with the module's test convention (e.g. `foo.ts` → `foo.test.ts` / `foo.spec.ts`; `foo.py` → `test_foo.py`; `foo.go` → `foo_test.go`):

```
<module>/src/feature/Foo.tsx changed?
→ look for a matching test file for Foo in the diff
→ if missing → HIGH finding
```

Finding format:

```json
{
  "file": "<module>/src/feature/Foo.tsx",
  "line": 0,
  "severity": "HIGH",
  "skill": "pr-self-review",
  "issue": "Source changed but no test file updated",
  "fix": "Update or add a test covering the change"
}
```

Skip this check for:

- Pure type / constant / config files (`types/`, `constants/`, `*.d.ts`, `config.*`)
- Framework entry/route shell files the module's AGENTS.md marks as not unit-tested
- Files that are themselves test files
- Files where the entire file is new (Added) and no test exists yet → downgrade to **MEDIUM**
- Files with < 20 lines changed (minor edits unlikely to break existing tests)

Optionally run the module's **Test command** and **Typecheck command** from the Modules table for every touched module; a failing command → CRITICAL finding (`file: <module path>`, `line: 0`).

### Step 6.6 — Dependency audit

Run only if a dependency manifest appears in the raw diff (before noise filtering): `package.json`, `pyproject.toml`, `requirements*.txt`, `go.mod`, `Cargo.toml`, etc.

Run the ecosystem's audit from the directory that contains the changed manifest, e.g.:

```bash
cd <module path> && npm audit --audit-level=high --json 2>/dev/null | head -50   # package.json
cd <module path> && pip-audit -f json 2>/dev/null | head -50                       # Python
cd <module path> && govulncheck ./... 2>/dev/null | head -50                       # Go
```

If vulnerabilities with severity `high` or `critical` found → add one CRITICAL finding per vulnerability:

```json
{
  "file": "<module path>/package.json",
  "line": 0,
  "severity": "CRITICAL",
  "skill": "security",
  "issue": "Dependency has high/critical vulnerability: <package>@<version>",
  "fix": "Update <package> to a safe version"
}
```

If the audit tool is not available or exits with unparseable output → skip silently.

A newly **added** dependency is also a possible ADR trigger — it is already flagged by Step 6.4; see the `dependency-checker` skill.

### Step 7 — Apply merge gate and output report

See [severity-levels](rules/severity-levels.md) for severity definitions.
See [output-format](rules/output-format.md) for exact report format.

**Merge gate:**

- `CRITICAL count > 0` → **BLOCKER** — do NOT execute `git push`, tell user to fix CRITICAL issues
- `CRITICAL count === 0` → **PASS** — execute `git push` (or allow user to proceed), show HIGH/MEDIUM as recommendations

### Step 8 — PR description generator (on PASS only)

After `✅ PASS`, automatically generate a PR description template based on the diff:

```
## What changed
<1-3 sentences summarizing the main change based on diff>

## Modules affected
- <module path>/ — <summary of changes>   (one line per touched module from the AGENTS.md Modules table; root-level changes as "root")

## Decisions
- <ADRs/PDRs this change implements or touches, if any>

## How to test
- [ ] <suggested manual test step based on changed files>

## Screenshots
<!-- Add screenshot or GIF of UI changes if applicable -->
```

Print this after the findings report under heading `### 📝 Suggested PR Description`.
Do not generate it if verdict is BLOCKER.

---

## Related skills (used by sub-agents, not directly)

| Skill                     | Bucket                                    |
| ------------------------- | ----------------------------------------- |
| `architecture-decisions`  | ADR check (Step 6) — always               |
| `security`                | All buckets except Tests — always         |
| `dependency-checker`      | Dependency audit (Step 6.6)               |
| Stack skills              | Per bucket, only once an ADR picks the tech (Step 4 table) |
