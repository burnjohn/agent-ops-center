---
status: superseded
date: 2026-10-24
decision-makers: []  # drafted by Claude 2026-10-24; superseded by ADR-0011 after owner chose the stack 2026-10-24
scope: ["web/**"]
supersedes: []
superseded-by: ["ADR-0011"]
---

# ADR-0005: Build the web UI as a React 19 + Vite single-page app with Tailwind CSS

## Context and Problem Statement
The UI is a local, live, highly interactive two-screen app (board with drag & drop, dispatch console).
No SEO, no server rendering, no auth.

## Considered Options
- React 19 + Vite SPA, Tailwind CSS v4, react-router
- Next.js 15 App Router
- Vanilla TypeScript

## Decision Outcome
Chosen option: "React + Vite SPA", because everything is client-side live state from one SSE stream;
Next.js server components and routing add a server we already have in Fastify.

### Consequences
- Good, because the dev server proxies `/api` to Fastify; production build is served by Fastify itself.
- Bad, because `next-best-practices` does not apply; use `react-best-practices` and `frontend-architecture`.

### Confirmation
- RULE: All server state in the UI comes from the event stream store in `web/src/state/`; components do not fetch state ad hoc.
  CHECK: reviewer
- RULE: Statuses, stages and health are shown with text or icon, not only colour (NFR-06).
  CHECK: reviewer
