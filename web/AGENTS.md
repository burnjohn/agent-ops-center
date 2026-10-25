# web — AGENTS.md

React 19 SPA on Vite (ADR-0011): React Router, TanStack Query, CSS Modules. Types and schemas come from
`@agent-ops/shared`. Root `AGENTS.md` rules also apply.

## Commands

- Test: `pnpm --filter @agent-ops/web test` (Vitest + jsdom + RTL)
- Typecheck: `pnpm --filter @agent-ops/web typecheck`
- Build: `pnpm --filter @agent-ops/web build`
- E2E: `pnpm --filter @agent-ops/web e2e` (Playwright, Chromium; `testDir: e2e`)
- Dev: `pnpm --filter @agent-ops/web dev` (proxies `/api` to `127.0.0.1:3000`)

## Rules (ADR-0011)

- Style with CSS Modules (`*.module.css`). Only token custom properties from `docs/design/tokens.css`; no
  colour literals (`#hex`, `rgb()`).
- `tokens.css` is imported exactly once, in `src/main.tsx`. Never import it elsewhere.
- Only `src/api/**` calls `fetch` or creates an `EventSource`. Components and hooks use TanStack Query hooks
  built on that module.
- No `z.object` in `web/src`; import request/response/event types from `@agent-ops/shared`.
- Status, stage, health and source are shown with text or a symbol, never colour alone.
- No new dependencies and no manifest edits outside an approved plan task.

## Tests

- RTL query priority: `getByRole` > `getByLabelText` > `getByText`; `getByTestId` last resort. Use
  `userEvent`, `findBy*` for async. Assert behaviour, not implementation.
- Stub `fetch` / `EventSource` directly (no MSW).
- Colocated unit tests `*.test.ts(x)` under `src`; Playwright specs in `e2e/`.
