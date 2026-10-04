# Repertoire: first working slice — implementation plan

Companion to [repertoire-design.md](./repertoire-design.md). This plan picks the slice of that
design that ships as one working, end-to-end feature, and records the contracts each layer
builds against so the layers can be developed in parallel.

## Slice in scope

A player can:

1. Create a White or Black repertoire (from the initial position or a custom FEN).
2. Open it in a **Study** workspace: play moves on an interactive board, see the chapter tree,
   mark own-side moves **accepted** / **preferred**, mark opponent moves **covered**, set
   **Start training here** / **Stop branch here**, edit comments. Edits autosave with revision
   checks.
3. **Import PGN** into chapters (every game, not just the first; illegal branches reported and
   excluded explicitly) and **export** a repertoire as multi-game PGN with `SetUp`/`FEN`.
4. **Practice** with **Review due** (scheduler v1) and **Learn new**: hidden-answer board, any
   accepted move succeeds, "outside your repertoire" on legal misses, hints, Reveal, attempts
   persisted idempotently in the main process, session summary.
5. See a **Repertoire** entry in the sidebar, a Home card with due count, hash routes and
   history entries that restore chapter/node.

Deferred to follow-up PRs (design §12 M4 and follow-ups): game-review comparison, engine
"Play from here" handoff, Lichess live-game guards, native JSON backup, Rehearse-lines mode,
Library "Add to repertoire", import worker threads, large-collection profiling.

## Layering and ownership

| Layer                       | Files                                                                                                                                                                      | Owner agent |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Shared types + API contract | `packages/shared/src/types/repertoire.ts`, `ipc/chaturanga-api.ts` (`repertoires` namespace)                                                                               | Phase 1     |
| Shared pure domain          | `packages/shared/src/chess/repertoire-position.ts`, `repertoire-index.ts`, `repertoire-scheduler.ts`, `repertoire-pgn.ts` + tests                                          | Phase 1     |
| Main process                | migration 7 in `main/db/index.ts`, `main/repertoire/repository.ts`, `service.ts`, `main/ipc/repertoire-handler.ts`, validators in `main/ipc/validate.ts`, preload exposure | Phase 2a    |
| Renderer                    | `features/repertoire/*`, `features/board/ControlledBoard.tsx`, `stores/repertoire-*-store.ts`, `queries/repertoire.ts`, App/Router/Sidebar/History wiring                  | Phase 2b    |
| Integration + verification  | run app, exercise the loop, fix seams                                                                                                                                      | Phase 3     |

## Rules every agent follows

- `pnpm lint`, `pnpm -r --if-present typecheck`, `pnpm test` must stay green; coverage
  thresholds are never lowered.
- Renderer never imports Electron/Node; main never imports renderer. Oxlint enforces it (oxlint.config.ts).
- Nothing repertoire-related is loaded into `useGameStore` (autosave would create library games).
- IPC channels are `repertoires:<method>`; the `channels.test.ts` contract test must pass.
- Runtime validation follows `validate.ts` style (hand-written parsers, `Invalid <label>: …`).
- Position identity uses the versioned `positionKey` from `repertoire-position.ts`; never SAN or
  the first four FEN fields.
- Grading authority lives in the main process; the renderer submits moves, never a success flag.
- Conventional Commits, scope `repertoire`.
