# Specs

One file per feature: `docs/specs/<feature-slug>.md`, based on [`_template.md`](_template.md).
A spec says **what** and **why**; the **how** goes to `docs/plans/<feature-slug>.md`.

Rules:
- Acceptance criteria in EARS form ("When …, the system shall …"), each one testable.
- `## Constraints` lists the accepted PDRs and ADRs the feature must respect.
- A missing product or technical decision → a `proposed` PDR/ADR, not a guess inside the spec.

| Spec | Status | Plan |
|------|--------|------|
| [Abstract Project Spec](abstract-project-spec.md) — Agent Board + Mission Control | draft (revised 2026-10-24 to match the prototype; awaiting re-approval) | TBD — after UI design |
| [Server API](server-api.md) — domain commands, REST endpoints, SSE stream, simulation engine, health & cost (SPEC-server-api) | draft (2026-10-24) | TBD — `docs/plans/server-api.md` |
| [Database](database.md) — schema, `events` journal, seed fixture, reset (SPEC-database) | draft (2026-10-24) | TBD — `docs/plans/database.md` |
| [Web UI](web-ui.md) — routes, screens, components, moves, live updates, a11y (SPEC-web-ui) | draft (2026-10-24) | TBD — `docs/plans/web-ui.md` |
