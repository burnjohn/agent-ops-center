# web Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.
See also: `gotchas.md` next to this file for known traps, and root `insights/gotchas.md`.

---

## What Works

## What Doesn't Work

## Codebase Patterns

2026-10-24 — The T57 fake network serves no `GET /agents/:id`; tests visiting agent pages must register one (see `withAgentPages` in navigation.test.tsx). A `hello` that arrives before the Simulation read lands is dropped by `patchSimulation` (no cache entry yet), so tests needing `playing: true` must override `GET /simulation`, not rely on `emitHello`. ref: web/src/app/navigation.test.tsx:9

2026-10-24 — `features/usage/state.ts` has no reset and `setup.ts` does not clear it: Usage/SessionLog tests restore defaults in their own `afterEach` (`cleanup()`, then `setPeriod('30d')`, `setAgentFilter('')`, `setModelFilter('')`, `toggleSort('start')`). The default fake network has no `/usage` route and its `/sessions` ignores period/filter/sort/limit, so Usage tests register both. ref: web/src/features/usage/Usage.test.tsx:16

## Tool & Library Notes

2026-10-24 — Under vitest fake timers RTL's `findBy*`/`waitFor` and `userEvent` hang (RTL only detects jest timers). Use `vi.useFakeTimers({ now, shouldAdvanceTime: true })` and advance the 30 s watchdog / 3.4 s toast explicitly inside RTL's `act`; keep margins generous because real elapsed ms also advance the clock. ref: web/src/app/connection.test.tsx:28

## Recurring Errors & Fixes

2026-10-24 — TanStack Query 5: `invalidateQueries` does NOT restart an in-flight fetch of a query that has no data yet (cancelRefetch only cancels when data exists). To make a hello/event that beat the first Simulation read win, `cancelQueries` then `invalidateQueries`. ref: web/src/api/eventCache.ts:46

2026-10-24 — e2e: Playwright `locator.press`/`click` re-resolve a detached element until the test timeout, so a button that vanishes mid-action (Run to next stage -> Review panel) hangs 60 s; pass an explicit `timeout` to every action in polling loops. `context.setOffline(true)` does NOT kill an established SSE connection; to cut one tab's stream put a Node `http` pass-through proxy in front of the server and destroy its sockets. A lazy route chunk cannot be loaded with the server stopped, so AC-28 (Retry) must be tested on a screen whose bundle is already loaded but whose data is not (e.g. visit T-1, stop server, open T-2). ref: web/e2e/reconnect.spec.ts:1

## Session Notes

## Open Questions

2026-10-24 — UI-AC-30: Simulation panel sits in `<fieldset disabled>` so PLAY/STEP get native `disabled` with no aria-disabled/reason; test marked `it.fails`. ref: web/src/app/AppHeader.tsx:75

2026-10-24 — UI-AC-114: `costXLabels` uses Math.round(29/3)=10 so the chart reads SEP 25 / OCT 5 / OCT 14 / TODAY; the spec's seed labels are OCT 4 (index 9). Test marked `it.fails`. ref: web/src/features/usage/model.ts:50

2026-10-24 — Resolved (G3 fix loop): UI-AC-30 (Simulation buttons now use `useGatedReason`, fieldset removed), UI-AC-114 (`costXLabels` uses floor), `usage/state.ts` has `resetUsageControls` called from `test/setup.ts`; Event Log controls live in `mission-control/eventLogState.ts` (also reset in setup.ts).

2026-10-24 — e2e (T66): the running-tool `pulse` animation exists only while auto-play is on (CurrentActionBox `playing`), so an AC-135 reduced-motion test must press PLAY first and keep a no-preference control, otherwise "no animations" passes vacuously. Animation names are CSS-module hashed (`_pulse_xxx`): match with `includes('pulse')`. Board/Event Log filters live in module state, so AC-14 e2e must navigate in-app (nav links/Back), not `page.goto`. ref: web/e2e/layout.spec.ts:1

2026-10-24 — AC-133 hit areas are measured on the element's own getBoundingClientRect: inline `a` padding-block grows that box without moving the line, so `padding-block: X; margin-block: -X` (base rule `:where(.layout) a` in Layout.module.css, zero specificity) gives >= 40 px with no layout change; a class that sets its own padding/margin must repeat the pair. Unclassed links also need that rule's `color: var(--ink)` (browser blue fails dark-theme contrast). Whole-card `opacity` (offline AgentCard) drops muted labels below AA; dim by surface only. ref: web/src/app/Layout.module.css:13
