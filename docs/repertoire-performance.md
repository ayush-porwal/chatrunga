# Repertoire performance

Results of the large-collection benchmark for the §11 targets in [repertoire-design.md](repertoire-design.md#11-performance-resilience-and-visual-behavior) (stack plan row 6).

## How to run

```sh
pnpm bench:repertoire            # node scripts/bench-repertoire.mjs
pnpm bench:repertoire --out r.json
```

The benchmark is `apps/desktop/src/perf/repertoire-perf.test.ts`. It runs under vitest because it imports TypeScript modules without a build step: the shared chess modules, the real repertoire service and repository over a temporary SQLite database, the renderer's tree models and the import parser. With `RUN_PERF=1`, which the script sets, it runs at full size. Without it, as in `pnpm test` and CI, the same file runs at tiny sizes (about 150 ms) as a smoke test of the harness.

The collection comes from a seeded PRNG (`apps/desktop/src/perf/large-repertoire.ts`), so every run builds the same data. Moves are random legal moves from chessops. Each tree has a main line, then side lines of geometric length that leave from random earlier nodes, so lines branch off lines at every depth.

| Data            | Size                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Repertoires     | 100 (alternating white and black)                                                              |
| Chapters        | 1,000 (10 per repertoire)                                                                      |
| Occurrences     | 105,900 tree nodes: 999 chapters of 100 moves plus one chapter of 5,000 moves (roots included) |
| Large chapter   | 5,000 moves: 40-ply main line, side lines averaging 10 plies, at most 80 plies deep            |
| Comparison game | 300 plies. It follows the large chapter's main line, then continues with random legal moves    |
| Import PGN      | 1,000 games × 100 moves = 100,000 moves, 0.65 MiB, exported with `exportRepertoirePgn`         |

Seeding takes about 5 s. It covers generation, `chapterRepository.upsert`, and one `saveChapter` per repertoire, which reindexes all 10 of its chapters.

## Reference machine

Apple M4 Pro (14 cores), 24 GiB, macOS (Darwin 27.0.0, arm64), Node v24.16.0. The benchmark runs in plain Node, not a packaged Electron build. Each workload has one warm-up call, then 30 timed runs (10 for `collectDecisions`, 3 for the in-thread import). The import figures through the bundled workers were measured separately by the main-process work on the same machine.

## Results vs. §11 targets

All §11 targets are met.

| §11 workload                                      | Target           | Measured (p95)                                                                   | Status   |
| ------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------- | -------- |
| Open a warm chapter up to 5,000 occurrences       | < 300 ms         | 29.6 ms total for the data work (breakdown below); rendering not measured        | Met      |
| Hub with 100 repertoires / 100,000 occurrences    | < 500 ms         | 21.7 ms for the `listRepertoires` summary query                                  | Met      |
| Finished-game comparison up to 300 plies          | < 250 ms         | 70.2 ms pure; 73.5 ms through `service.compareGame` (SQLite load included)       | Met      |
| Import up to 100,000 occurrences: no task > 50 ms | ≤ 50 ms blocking | Longest main-thread stall 6.3 ms (preview) and 12.3 ms (commit), through workers | Met      |
| Import total duration (measured; no budget yet)   | n/a              | Preview 2.25–2.33 s and commit 1.74–1.82 s for 100,000 moves                     | Recorded |

### Chapter open (5,000 moves)

| Step                                                         | p50 ms | p95 ms |
| ------------------------------------------------------------ | -----: | -----: |
| SQLite load + JSON parse (`service.getChapter`)              |   4.16 |   4.54 |
| `buildChapterLookup`                                         |  22.27 |  23.09 |
| `computeScopeStates`                                         |   0.79 |   0.90 |
| `subtreeSizes` + `collapseStudyTree`                         |   0.61 |   0.81 |
| `buildTreeModel` of the collapsed tree                       |   0.20 |   0.28 |
| `buildTreeModel` of every move (uncollapsed, for comparison) |   1.66 |   2.13 |
| Selecting a deep node (expand its path, collapse, model)     |   0.51 |   0.66 |

`buildChapterLookup` dominates because it computes a position key for every node. The study page now builds it once per tree revision; see "Memoisation" below.

### Other workloads

| Workload                                   | p50 ms | p95 ms | Note                                                                                                                                                                                   |
| ------------------------------------------ | -----: | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collectDecisions` over all 1,000 chapters |  643.3 |  678.4 | No direct §11 target. Real calls cover one repertoire (about 1,000 nodes, roughly 7 ms) from `reindex` and practice start, never the whole collection. Cost grows linearly with nodes. |
| `listRepertoires` (hub summary query)      |   21.2 |   21.7 | Aggregates only; no tree is loaded. Well under target, so no SQL change is needed.                                                                                                     |

## Import through the workers

The preview parse runs in a `worker_threads` parse worker, which also precomputes the position keys. The commit runs in a dedicated writer worker with its own WAL connection. It holds the service's write gate (`withRepertoireWriteGate`) until the worker replies. The main thread only exchanges messages with the workers, so the "no task blocks > 50 ms" target is met.

| Input                                               | Preview     | Longest main-thread stall | Commit      | Longest main-thread stall |
| --------------------------------------------------- | ----------- | ------------------------: | ----------- | ------------------------: |
| 1,000 games × 100 moves (100,000 moves)             | 2.25–2.33 s |                5.5–6.3 ms | 1.74–1.82 s |               8.1–12.3 ms |
| 100 games × 80 moves + 10 variations (10,000 moves) | 0.28 s      |                  ≤ 7.6 ms | 0.22–0.24 s |                    ≤ 2 ms |

Before the writer worker, committing 100,000 moves blocked the main thread for 3.7 s.

### Locking while the writer runs

`node:sqlite` waits for a lock with a synchronous sleep (`busy_timeout`), which stalls the whole main process. So the main thread never waits for the writer's lock in SQLite:

- Every repertoire write goes through the service's async write gate: chapter, decision, metadata, archive, remove, create and duplicate; add from game, game links and the workspace; the import commit; backup restore; and every practice write (start, resume, attempts, actions, end). A write that arrives during a commit waits at the gate asynchronously and runs after it. One gate covers all repertoires, so writes run one at a time.
- Reads never take the write lock. Exports, previews, comparisons and getters use plain deferred transactions or single statements, which in WAL mode read a consistent snapshot while the writer works. Only writes use `BEGIN IMMEDIATE`.
- `busy_timeout` on the main connection is 250 ms, as a safety net. A repertoire write that still finds the database locked fails with "The repertoire database is busy; try again." Writes outside the repertoire service, such as a game autosave, settings or telemetry, don't pass the gate. If one lands during a commit, it waits at most 250 ms and then fails with SQLite's busy error. The library and settings transactions take the write lock up front too, so they never fail halfway through.

Before the gate, a practice round during the 100,000-move commit stalled the main thread for about 1.05 s, and a game autosave for about 0.46 s.

### In-thread parse (benchmark proxy)

The benchmark also runs the parse code in its own thread through `importPreviewFromText`. A self-rescheduling `setImmediate` probes the event loop; the longest gap between two probe turns is the longest blocking task. The packaged app never uses this path on the main thread: a missing worker file fails the import with an actionable error. Inside the worker, the figure only bounds how quickly the worker answers its own messages. Cancel rejects the preview at once either way. The worker stops at its next game or input piece, and is terminated if it hasn't stopped within 200 ms.

| Measure (100,000 moves, 0.65 MiB)      | Value                                          |
| -------------------------------------- | ---------------------------------------------- |
| Total in-thread parse                  | 2.09 s p50, 2.17 s p95                         |
| Longest block, 64 KiB pieces           | 41.9 ms                                        |
| Longest block, 32 KiB pieces (default) | 34.3 ms                                        |
| Longest block, 16 KiB pieces           | 22.1 ms                                        |
| Longest gap between progress events    | 114 ms (throttled to one per 100 ms per phase) |

## Tree rendering: collapsing was needed

TreeView renders one element per move, so a 5,000-move chapter means 5,001 rows. That is well above the 2,000-row threshold for collapsing. The Study tree (`features/repertoire/StudyTree.tsx` over `study-tree-model.ts`) now always shows the main line, and shows each side line up to 6 plies below the main line or an expanded node. Everything deeper becomes one "… N more moves" row that expands on click. Selecting a hidden move from the board, the keyboard or a transposition link expands the rows on its path, and they stay expanded, so clicking around a visible tree never reshuffles it. Chapters under 400 moves render in full, exactly as before. The game TreeView only gained an optional `collapsedRows`/`onExpandRow` pair.

Visible rows for the 5,000-move chapter:

| Collapse depth (plies) | Rows (moves + "more moves" rows) |
| ---------------------- | -------------------------------- |
| 4                      | 181 (33)                         |
| **6 (default)**        | **278 (42)**                     |
| 8                      | 373 (41)                         |
| 12                     | 668 (75)                         |
| uncollapsed            | 5,001                            |

Windowing (virtualised rows) is not needed at these counts. Revisit it only if expanded trees routinely reach thousands of rows.

## Memoisation

- The study page memoises `buildChapterLookup` on the draft's `tree`, not on the whole chapter. Selecting nodes, editing edges or training marks, and renaming keep the lookup.
- After an autosave, the workspace store keeps the draft's tree object when the saved tree has the same content (`reuseUnchangedTree`). Before, every save replaced it with a fresh copy, which rebuilt the lookup (about 25 ms) and every tree row.
- Subtree sizes are computed once per lookup. The collapsed tree is recomputed only when the lookup or the expanded set changes, and nodes that keep all their children keep their identity.

## Caveats

- Numbers are from plain Node on a fast desktop, not a packaged Electron build. Repeat them on the documented reference desktop before choosing release budgets.
- React render and commit time is not measured, since vitest runs without a DOM. Visible row count is the proxy.
- The worker import figures come from the bundled workers. The benchmark's in-thread figures exercise the same parse code without them. Re-run `pnpm bench:repertoire` after changes to `import-job.ts` or the reindex.
