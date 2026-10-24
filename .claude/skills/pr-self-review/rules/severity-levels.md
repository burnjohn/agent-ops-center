# Severity Levels

## Overview

Three levels. Only CRITICAL blocks the merge gate.

| Level | Label        | Blocks push?             |
| ----- | ------------ | ------------------------ |
| 🔴    | **CRITICAL** | ✅ YES — fix before push |
| 🟡    | **HIGH**     | ❌ No — recommendation   |
| 🔵    | **MEDIUM**   | ❌ No — recommendation   |

---

## 🔴 CRITICAL — what qualifies

A finding is CRITICAL only if it meets one of these exact conditions:

### 1. UI framework — critical violations (React, once an ADR picks it)

- Business logic (calculations, transformations, conditions) implemented directly inside JSX or component body instead of a hook or service
- Rules of Hooks violated (hook called conditionally, inside a loop, or after an early return)
- `useEffect` with a missing or incorrect dependency array that causes infinite loops or stale data

### 2. Security — high confidence findings

- Secret, token, API key, or password hardcoded in source code (not `.env`)
- User input rendered as raw HTML without sanitization (XSS)
- SQL query built via string concatenation with unsanitized input
- `eval()` or `new Function()` called with user-controlled input
- `dangerouslySetInnerHTML` used with unsanitized data

### 3. Layered/onion architecture — layer violation (once an ADR picks it)

- Direct database query (ORM/SQL) inside a controller or route handler — must go through repository layer
- Infrastructure concern (HTTP client, file system, external API) called directly from domain/use-case layer
- Domain entity imported directly into a controller (bypassing use-case/service layer)

### 4. Accepted ADR — Confirmation rule violated

- A changed file breaks a Confirmation rule of an accepted ADR whose `scope` matches it
  (checked via the `architecture-decisions` skill, section **Checking a diff**)
- A module's Test or Typecheck command (from the AGENTS.md Modules table) fails on the change

### 5. Dependency audit — high/critical vulnerability

- A dependency in a changed manifest (`package.json`, `pyproject.toml`, `go.mod`, …) has a known `high` or `critical` vulnerability per the ecosystem's audit tool

---

## 🟡 HIGH — what qualifies

- Component exceeds 200 lines and mixes rendering + state + side effects
- Custom hook exceeds 100 lines without decomposition
- Fetch/async call inside a component without error handling or loading state
- Input validation missing at a module boundary (API route input, server action, queue/message consumer)
- Change looks like an unrecorded architectural decision (new dependency, new top-level directory, new external service) and no ADR is proposed
- Missing error boundary around a route segment that can throw
- TypeScript `any` used in a public function signature or exported type
- **Test coverage gate:** changed component file has no corresponding updated test file (HIGH, not CRITICAL)
  - Skip for: pure type / constant / config files, and framework entry/route shell files the module's AGENTS.md marks as not unit-tested
  - Skip if fewer than 20 lines changed in the file (minor edits unlikely to break existing tests)
  - Downgrade to MEDIUM if the file is newly created (Added, not Modified)

---

## 🔵 MEDIUM — what qualifies

- File or folder name does not follow project naming conventions (kebab-case folders, PascalCase components)
- Constant hardcoded inline in a template/component that belongs in a constants file
- Utility function duplicated across modules (same logic exists elsewhere)
- Missing `abort controller` / cleanup in `useEffect` with a fetch
- TypeScript `as` cast used instead of proper type guard
- Test file missing `describe` block or uses hardcoded magic values without constants
- **Deep relative import** used instead of the module's configured path alias (e.g. `../../../components/Foo` instead of `@/components/Foo`) — only where the module defines an alias

---

## When in doubt

If unsure between CRITICAL and HIGH → use HIGH.
If unsure between HIGH and MEDIUM → use MEDIUM.
Prefer false negatives on CRITICAL over false positives — CRITICAL blocks the push.
