# AGENTS.md

## Repository

OpenAPI Spec: OpenAPI types and tools, in a pnpm monorepo.

- `packages/*`: the published packages, each with `src`, and `tests` and `benches` where it has them
- `scripts/`: repository scripts

## Commands

```bash
pnpm install
pnpm test                    # vitest
pnpm vitest run <path>       # one test file
pnpm check                   # lint and type check, including *.test-d.ts
pnpm fix                     # check, applying fixes
pnpm format                  # format with oxfmt
pnpm bench
pnpm --filter @openapi-spec/downgrader prepack  # build one package; tests don't need a build
```

Before finishing, run `pnpm format`, `pnpm check` and `pnpm test`. CI doesn't check formatting.

## Pull requests

Titles follow Conventional Commits, scoped by the affected packages, separated by a comma and a space: `fix(downgrader): ...`, `fix(downgrader, router): ...`. Leave out the scope when the change is too broad.
