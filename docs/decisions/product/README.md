# Product Decision Records

Product decisions that constrain the specs: audience, problem, scope, principles, success metrics.
How to write and use them: `.claude/skills/product-decisions/SKILL.md`.
New file: copy [`_template.md`](_template.md) to `NNNN-<decision-slug>.md`.

| PDR | Decision | Status | Affects |
|---|---|---|---|
| [0001](0001-record-product-decisions.md) | Record product decisions as PDRs in docs/decisions/product | accepted | docs/specs/** |
| [0004](0004-no-wip-limit.md) | No WIP limit on In Progress in the MVP | proposed | docs/specs/abstract-project-spec.md |
| [0006](0006-operator-can-release-ticket.md) | Operator can release an In Progress ticket back to Ready | proposed | docs/specs/abstract-project-spec.md |
| [0007](0007-cost-and-session-logs-on-mock-data.md) | Usage & Cost and Session Log screens ship on mock data only | proposed | docs/specs/abstract-project-spec.md |
| [0008](0008-mvp-runs-on-simulated-agents-only.md) | The MVP runs on simulated agents only; real-agent integration (MCP, telemetry) is the next iteration | proposed | docs/specs/abstract-project-spec.md |
| [0009](0009-operator-assigns-and-moves-tickets-within-guards.md) | Operator assigns tickets to free agents and moves tickets within lifecycle guards; agents still pull in auto-play | proposed | docs/specs/abstract-project-spec.md |
| [0010](0010-offline-agents-stay-in-grid.md) | Offline agents stay in the Mission Control grid, dimmed and sorted last | proposed | docs/specs/abstract-project-spec.md |
| [0011](0011-health-thresholds-with-capped-tool-grace-and-heartbeat.md) | Stale after 30 s, Offline after 2 min; a running tool keeps an agent Online for at most 10 min; a waiting agent with a heartbeat stays Online | proposed | docs/specs/abstract-project-spec.md |
| [0002](0002-health-thresholds.md) | ~~Agent is Stale after 30 s and Offline after 2 min of silence, except while a tool runs~~ → 0011 | superseded | docs/specs/abstract-project-spec.md |
| [0003](0003-agents-pull-work.md) | ~~Agents pull work themselves; Operator does not assign tickets in the MVP~~ → 0009 | superseded | docs/specs/abstract-project-spec.md |
| [0005](0005-offline-agents-collapse.md) | ~~Agents Offline for over an hour move to a collapsed Offline section, history kept~~ → 0010 | superseded | docs/specs/abstract-project-spec.md |
