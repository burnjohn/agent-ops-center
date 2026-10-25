# shared

Zod schemas and inferred TypeScript types that form the contract between `server/` and `web/` (ADR-0010).

## Rules

- `shared/src/**` imports only `zod` and relative paths. No Node APIs, no DOM, no other packages.
- No runtime logic beyond schemas, derived types and tiny pure helpers.
- Contract change rule: shared contracts are consumed by both `server/` and `web/`. Changing or removing an
  existing schema/type needs the change reflected in both consumers in the same task, and a plan or ADR
  entry if it alters an accepted contract. Adding new contracts is fine when the task says so.
- Consumed as source (`exports` points to `src/index.ts`); there is no build step.
- Manifests are frozen after bootstrap: do not edit `package.json` or the lockfile.

## Commands

- Test: `pnpm --filter @agent-ops/shared test`
- Typecheck: `pnpm --filter @agent-ops/shared typecheck`
- Lint (repo root): `pnpm lint`
