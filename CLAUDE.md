# Chaturanga

Use the Node/pnpm versions in package.json.

- Renderer uses window.chaturanga; privileged operations belong in main.
- Preload exposes a narrow typed bridge; reuse shared contracts/validators.
- Read adjacent code/tests; make the smallest coherent change.
- Preserve Hooks dependencies, Query keys, cancellation, and cleanup.
- Handle Promise failures; validate external data instead of casting it.
- Fix diagnostics at the cause; never weaken rules or coverage to pass.
- Add focused behavior/regression tests; extend existing tests before duplicating.
- Remove low-value tests only after identifying retained behavioral proof.
- Skip new tests for mechanical edits; avoid markup/wiring-only assertions.
- Await async milestones; no real sleeps to hide races.
- Run focused tests, `pnpm lint`, relevant typechecks (`pnpm -r typecheck`), and `pnpm format:check`.
- Verify affected Electron journeys (`pnpm --filter @chaturanga/desktop build`, then `test:e2e:run`); CI runs full checks before merge.
- Preserve unrelated edits; report results and unverified checks.

Checks: `pnpm lint` (Oxlint, type-aware; `oxlint.config.ts`), `pnpm format:check` (`pnpm format` writes), `pnpm -r typecheck`, `pnpm --filter @chaturanga/desktop exec vitest run <file>` (focused), `pnpm test:coverage`, `node --test scripts/*.test.mjs`. A lint exception is `// oxlint-disable-next-line <rule> -- <why it is safe>`.
