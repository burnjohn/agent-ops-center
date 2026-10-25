# Project Insights

Non-obvious discoveries from real sessions that are not tied to one module. Specific and actionable —
pass the cold-read test. Written by the `engineering-insights` skill; append-only.
Module-specific notes go to `<module>/insights/INSIGHTS.md`.
See also: `insights/gotchas.md` for known traps.

---

## What Works

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions

## Tool & Library Notes

2026-10-24 — typescript-eslint 8.72 peers `typescript <6.1`, so the repo pins typescript 6.0.3 even though 7.0.2 is "latest"; react-router is pinned to 7.18.4 because 8.5 needs Node >=22.22 (local is 22.17). Postgres 18 images mount the volume at `/var/lib/postgresql` (not `/data`). ref: package.json:1, web/package.json, compose.yaml
