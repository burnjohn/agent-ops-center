# Skills

Reusable skills that give agents specialized knowledge and workflows. They live in `.claude/skills/`,
are shared via version control, and are loaded on demand when relevant (or invoked by name, e.g.
`/pr-self-review`). Agents in `.claude/agents/` preload some of them via their `skills:` frontmatter.

The stack is **not chosen yet** (see `AGENTS.md`). Skills marked **"applies once an ADR picks this
tech"** describe a specific technology: use them only after an accepted ADR in
`docs/decisions/architecture/` selects that technology. Until then they are reference material for
writing the ADR, not rules for the code.

## Catalog

### Process — how work flows (spec-driven development, review, learning)

| Skill | Scope | Description |
|-------|-------|-------------|
| [architecture-decisions](architecture-decisions/SKILL.md) | Process | Write, use and maintain ADRs (MADR 4.0) in `docs/decisions/architecture/`; check a diff against accepted ADRs |
| [product-decisions](product-decisions/SKILL.md) | Process | Write, use and maintain PDRs in `docs/decisions/product/`; keep specs consistent with product choices |
| [brainstorming](brainstorming/SKILL.md) | Process | Refine ideas through structured questions and validate a design before any code is written |
| [writing-plans](writing-plans/SKILL.md) | Process | Turn an approved spec/design into a step-by-step plan of small, verifiable tasks |
| [run-plan](run-plan/SKILL.md) | Process | Execute an approved `docs/plans/<feature>.md` with implementer/test-writer agents, review gate and bounded fix loop |
| [pr-self-review](pr-self-review/SKILL.md) | Process | Pre-push review: routes the diff by the AGENTS.md Modules table, checks accepted ADRs, blocks push on CRITICAL |
| [engineering-insights](engineering-insights/SKILL.md) | Process | Append non-obvious discoveries to `insights/` or `<module>/insights/`; suggest promoting rules to AGENTS.md / gotchas / ADRs |
| [workflow-retro](workflow-retro/SKILL.md) | Process | Retrospective of a multi-agent run (cost, parallelism, waste, recommendations); appends to `docs/retros/ledger.md` |
| [systematic-debugging](systematic-debugging/SKILL.md) | Process | Root-cause analysis before any fix when something is broken |
| [git-workflow](git-workflow/SKILL.md) | Process | Conventional commits, branch naming, PR formatting |

### Shared — any stack

| Skill | Scope | Description |
|-------|-------|-------------|
| [security](security/SKILL.md) | Shared | OWASP Top 10:2025 — auth, input handling, uploads, secrets, API endpoints (examples are stack-specific) |
| [dependency-checker](dependency-checker/SKILL.md) | Shared | Audit external and cross-module dependencies; graph, sizes, prioritized findings; new dependency = possible ADR |
| [architecture-patterns](architecture-patterns/SKILL.md) | Shared | Clean Architecture, Hexagonal Architecture and DDD patterns for maintainable backends |
| [typescript-expert](typescript-expert/SKILL.md) | Shared | TypeScript/JavaScript type-level programming, performance, monorepos, tooling — applies once an ADR picks this tech |
| [zod](zod/SKILL.md) | Shared | Zod schema validation, parsing and error handling — applies once an ADR picks this tech |
| [github-workflow-automation](github-workflow-automation/SKILL.md) | Shared | GitHub Actions CI/CD pipelines and repository automation — applies once an ADR picks this tech |

### Frontend

| Skill | Scope | Description |
|-------|-------|-------------|
| [frontend-architecture](frontend-architecture/SKILL.md) | Frontend | Where code lives in a React 19 + Next.js 15 App Router app — applies once an ADR picks this tech |
| [react-best-practices](react-best-practices/SKILL.md) | Frontend | React component, state and hooks patterns and anti-patterns — applies once an ADR picks this tech |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | Next.js file conventions, RSC boundaries, data patterns, route handlers — applies once an ADR picks this tech |
| [react-hook-form](react-hook-form/SKILL.md) | Frontend | React Hook Form with Zod validation, performance and testing — applies once an ADR picks this tech |
| [react-testing-library](react-testing-library/SKILL.md) | Frontend | React Testing Library + Vitest for components and hooks — applies once an ADR picks this tech |
| [safe-ui-refactoring](safe-ui-refactoring/SKILL.md) | Frontend | Safe, incremental, behavior-preserving React UI refactoring — applies once an ADR picks this tech |

### Backend

| Skill | Scope | Description |
|-------|-------|-------------|
| [onion-architecture](onion-architecture/SKILL.md) | Backend | Onion layers and inward-only dependency rule for a Fastify + Drizzle + Zod backend — applies once an ADR picks this tech |
| [fastify-best-practices](fastify-best-practices/SKILL.md) | Backend | Fastify routes, plugins, JSON Schema validation, errors, performance — applies once an ADR picks this tech |
| [express-best-practices](express-best-practices/SKILL.md) | Backend | Express + Mongoose MVC patterns, middleware, error handling — applies once an ADR picks this tech |
| [backend-testing](backend-testing/SKILL.md) | Backend | Vitest + Supertest tests for Express routes, middleware and Mongoose models — applies once an ADR picks this tech |

### Data

| Skill | Scope | Description |
|-------|-------|-------------|
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Data | PostgreSQL schema design: types, indexing, constraints, performance — applies once an ADR picks this tech |
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Data | Drizzle ORM schemas, queries, relations, transactions, migrations — applies once an ADR picks this tech |

### Docs — diagrams

| Skill | Scope | Description |
|-------|-------|-------------|
| [mermaid-diagram](mermaid-diagram/SKILL.md) | Docs | Mermaid diagrams in Markdown: flowcharts, sequence, class, ER, state |
| [excalidraw-diagram](excalidraw-diagram/SKILL.md) | Docs | Excalidraw diagram JSON for workflows, architectures and concepts |

## Skills vs agents vs AGENTS.md

| Type | Where | Loaded | Purpose |
|------|-------|--------|---------|
| **Project instructions** | `AGENTS.md` (read natively by Claude Code) | Always | Conventions, layout, Modules table, workflow |
| **Skills** | `.claude/skills/<name>/SKILL.md` | On demand, by name or relevance | Specialized knowledge and workflows |
| **Agents** | `.claude/agents/<name>.md` | Via the Agent tool | Subagents with their own context, tools and preloaded skills |
| **Hooks** | `.claude/settings.json` | On harness events | Automation, e.g. `pr-self-review` before `git push` |

## Creating new skills

Each skill has:

- `SKILL.md` — main file with YAML frontmatter (`name`, `description` with trigger phrases) and the rules/workflow (required)
- `rules/*.md` — split-out rule files for larger skills (optional)
- `examples.md` — good/bad code examples (recommended)
- `references.md` — sources and rationale (optional)

Rules for skills in this repo:

- Never hardcode module paths or test commands — read them from the **Modules** table in `AGENTS.md`.
- A stack-specific skill is marked "applies once an ADR picks this tech" here until an ADR is accepted.
- Add a row to this catalog in the right Scope section when you add a skill.
