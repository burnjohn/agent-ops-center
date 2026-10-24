# Product Decision Records

Product decisions that constrain the specs: audience, problem, scope, principles, success metrics.
How to write and use them: `.claude/skills/product-decisions/SKILL.md`.
New file: copy [`_template.md`](_template.md) to `NNNN-<decision-slug>.md`.

| PDR | Decision | Status | Affects |
|---|---|---|---|
| [0001](0001-record-product-decisions.md) | Record product decisions as PDRs in docs/decisions/product | accepted | docs/specs/** |
| [0002](0002-health-thresholds.md) | Agent is Stale after 30 s and Offline after 2 min of silence, except while a tool runs | proposed | docs/specs/abstract-project-spec.md |
| [0003](0003-agents-pull-work.md) | Agents pull work themselves; Operator does not assign tickets in the MVP | proposed | docs/specs/abstract-project-spec.md |
| [0004](0004-no-wip-limit.md) | No WIP limit on In Progress in the MVP | proposed | docs/specs/abstract-project-spec.md |
| [0005](0005-offline-agents-collapse.md) | Agents Offline for over an hour move to a collapsed Offline section, history kept | proposed | docs/specs/abstract-project-spec.md |
| [0006](0006-operator-can-release-ticket.md) | Operator can release an In Progress ticket back to Ready | proposed | docs/specs/abstract-project-spec.md |
