# web Gotchas

Known traps, curated and short. See also root `insights/gotchas.md`.

## tokens.css is imported once

`docs/design/tokens.css` is imported only in `src/main.tsx` (ADR-0011). The Vite dev server needs
`server.fs.allow` to include the repo root, otherwise the file outside `web/` is blocked.

## react-router is pinned to v7

Local Node is 22.17, so `react-router` is 7.18.x, not v8. Do not bump it without raising Node.

## frontend-architecture skill is Next.js-oriented

Ignore its RSC / `app/` / Server Action rules; this is a Vite SPA.
