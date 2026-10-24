---
status: proposed
date: 2026-10-24
decision-makers: [Ivan Lapa]  # chosen by owner 2026-10-24, drafted by Claude
scope: ["web/**"]
supersedes: ["ADR-0005"]
superseded-by: []
---

# ADR-0011: Build the web UI as a React 19 + Vite SPA with react-router, CSS Modules over the design tokens, and TanStack Query fed by the SSE stream

## Context and Problem Statement
The UI is a local, live, highly interactive app: three nav screens (Board with drag & drop, Mission
Control, Usage & Cost) and three detail pages (ticket with the Agent console, agent, session log). No
SEO, no server rendering, no auth (NFR-05). Every open tab must reflect a change within 500 ms
(NFR-01), recover after a lost connection (NFR-04) and never disagree with another tab (NFR-02).

ADR-0005 (proposed, never accepted) picked React + Vite with Tailwind CSS and a hand-written event
store. Since then the design was finished: `docs/design/tokens.css` holds the colour, type and spacing
tokens for both themes, and `docs/design/components.md` catalogues the components. The owner chose
on 2026-10-24 to style directly over those tokens (no Tailwind) and to keep server state in a query
cache that the SSE stream (ADR-0004) keeps fresh. The server exposes REST reads per screen and one
event stream (SPEC-server-api).

## Considered Options
- React 19 + Vite SPA, react-router, CSS Modules over `tokens.css`, TanStack Query cache updated/invalidated by SSE events
- React 19 + Vite SPA with Tailwind CSS v4 and a custom event-sourced client store (ADR-0005)
- Next.js App Router
- React SPA with a global client store (Zustand/Redux) holding all server state

## Decision Outcome
Chosen option: "React 19 + Vite, react-router, CSS Modules over tokens.css, TanStack Query + SSE",
because the design tokens already are CSS custom properties for both themes, so CSS Modules use them
with no translation layer; TanStack Query gives per-screen reads with caching, refetch and loading/error
states for free; and SSE events map cleanly onto "patch or invalidate these query keys", which keeps
every tab consistent without re-implementing the server's reducer in the browser.

Details:
- Build: Vite with the React plugin; the dev server proxies `/api` (including `/api/stream`) to Fastify;
  the production build is served as static files by the server.
- Routing: react-router (declarative routes) for `/board`, `/mission-control`, `/usage`,
  `/tickets/:id`, `/agents/:id`, `/sessions/:id`; exact routes are owned by SPEC-web-ui.
- Styling: CSS Modules (`*.module.css`) next to components. `docs/design/tokens.css` is the single
  token source, imported once at the app entry; components use only its custom properties for colour,
  type and spacing. Theme switch = a `data-theme` attribute on the root. No Tailwind, no CSS-in-JS runtime.
- Server state: TanStack Query v5. All HTTP calls go through one API client module in `web/src/api/`
  that validates responses with the Zod schemas from `@agent-ops/shared`. One `EventSource` per tab,
  opened in one module, applies each event to the cache (`setQueryData` where the payload is enough,
  otherwise `invalidateQueries` for the affected keys); a `resync` message invalidates everything.
- UI-only state (filters, dialogs, drag, theme, back history) stays in React state / context, not in
  the query cache.

### Consequences
- Good, because design tokens and both themes are used exactly as designed; a token change needs no rebuild of a utility config.
- Good, because loading, error, refetch-on-reconnect and stale-while-revalidate come from the library, not custom code.
- Good, because the server stays the only place with business rules; the client only maps events to cache keys.
- Bad, because every event type needs a mapping to query keys; a missing mapping shows stale data until the next refetch (guarded by a test).
- Bad, because CSS Modules mean more files than utility classes, and token discipline is enforced only by a grep rule and review.
- Bad, because `shared/` ships Zod into the bundle (accepted in ADR-0010).
- Migration work: none (nothing was built on ADR-0005); ADR-0005 is marked superseded.

### Confirmation
- RULE: `web/package.json` has no dependency on `tailwindcss`, `styled-components`, `@emotion/*` or `next`.
  CHECK: `grep -nE '"(tailwindcss|styled-components|@emotion/[a-z-]+|next)"' web/package.json`
- RULE: Components style with CSS Modules; colours in `web/src/**/*.module.css` come from token custom properties, not literals.
  CHECK: `grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(" web/src --include=*.module.css`
- RULE: `tokens.css` is imported exactly once, at the app entry.
  CHECK: `grep -rn "tokens.css" web/src`
- RULE: Only `web/src/api/**` calls `fetch` or creates an `EventSource`; components and hooks use TanStack Query hooks built on that module.
  CHECK: `grep -rnE "fetch\(|new EventSource" web/src | grep -v "web/src/api/"`
- RULE: Request/response/event types come from `@agent-ops/shared`; `web/src` declares no `z.object` of its own.
  CHECK: `grep -rn "z.object" web/src`
- RULE: Every event type in the shared event catalogue has a cache mapping (patch or invalidate), and `resync` invalidates all queries.
  CHECK: `web/src/api/eventCache.test.ts` (iterates the shared event-type enum)
- RULE: Statuses, stages, health and event sources are shown with text or a symbol, not only colour (NFR-06).
  CHECK: reviewer
