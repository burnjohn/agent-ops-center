# Design

Visual design and interaction reference for Agent Ops. Specs say **what** the product does; this folder
says **how it looks and behaves on screen**. Order of authority stays as in `docs/README.md`:
accepted PDRs/ADRs → specs → design → plans → code. Where the prototype and a spec disagree, the spec
wins until it is updated — see [Prototype vs spec](#prototype-vs-spec).

| File | What it is |
|---|---|
| [`tokens.css`](tokens.css) | Design tokens as CSS custom properties, light + dark. Import as-is |
| [`tokens.json`](tokens.json) | The same tokens for a theme object in code |
| [`components.md`](components.md) | Component catalogue: contents, states, tokens |
| [`mock-data.md`](mock-data.md) | The mock dataset the prototype runs on (agents, tickets, sessions, prices) |
The clickable prototype is **not stored in the repository**. It lives in the design canvas
(private to the owner until shared): https://claude.ai/artifact/Sf9BuRyhZ3q9VhFwMRbeha — open it
focused on the `LIVE PROTOTYPE` artboard. Specs, plans and code comments that cite
`docs/design/prototype/*.dc.html` refer to that canvas source; a local copy may sit in
`docs/design/prototype/`, which is git-ignored. The prototype is **not** production code — build real
components from `tokens.css` and `components.md`.

`server/fixture/fixture.json` was generated from the prototype and is committed, so tests and the app
do not need it. Regenerating it (`pnpm --filter @agent-ops/server fixture:generate`) needs a local copy
of `app.dc.html` in `docs/design/prototype/`.

## Style in one paragraph

"Swiss Instrument": monochrome, grid-based, square corners, Geist + Geist Mono. Big light numbers for
metrics, mono uppercase labels, hairline rows, ink rules at section starts. Colour only carries meaning —
orange `--attn` for "needs a human" and errors, blue `--live` for running / just updated / focus — and
every state also has a glyph or a word. Light and dark themes are designed together.

## Screens → spec

| Screen (route in the prototype) | Spec requirements |
|---|---|
| Board (`board`) | BRD-01 … BRD-14, NAV-03, UC-01, UC-06 |
| Ticket (`ticket/:id`) — review, blocked answer, moves, who is on it, **agent console**, sessions & cost, activity | BRD-04 … BRD-12, CON-01 … CON-06, CST-07, UC-04, UC-06, UC-11 |
| Mission Control (`mc`) — KPIs, agent cards, Event Log | MC-01 … MC-06, MC-09, MC-10, UC-07 |
| Agent (`agent/:id`) — said vs did, sessions, tickets | MC-07, MC-08, LOG-01, UC-08 |
| Usage & Cost (`usage`) — period, KPIs, daily chart, breakdowns, prices, sessions table | CST-01 … CST-09, MOCK-01, UC-10 |
| Session Log (`session/:id`) — tokens, where the tokens went, filters, search, errors | LOG-02 … LOG-10, CST-08, UC-11 |
| App shell — nav, back, breadcrumbs, theme, simulation panel | NAV-01 … NAV-05, SIM-06 … SIM-10 |

Layer specs built on this design: [`web-ui.md`](../specs/web-ui.md), [`server-api.md`](../specs/server-api.md),
[`database.md`](../specs/database.md).

## Prototype vs spec

On 2026-10-24 the spec was revised to match this prototype plus the owner's decisions
(PDR-0008 … PDR-0011). Where they still differ, **the spec wins** — do not copy these from the prototype:

- Product-level deviations D-1 … D-15: `docs/specs/abstract-project-spec.md`, section «Прототип і специфікація»
  (e.g. Operator cannot move In Progress → Review; release only In Progress → Ready; reopening Done needs
  a confirmation; assignment is an Operator event, not an Agent Report "Claimed").
- UI-level deviations U-1 … U-18: `docs/specs/web-ui.md`, section «Prototype deviations».
