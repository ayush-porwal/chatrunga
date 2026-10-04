# Test audit (October 2026)

Every unit test file was read against the policy in `CODE_QUALITY_IMPROVEMENTS.md`: keep focused
behaviour and regression tests; simplify, merge, replace or remove only static-markup,
callback-wiring, implementation-mirroring or duplicated tests, and only after naming the defect a
test catches and the test that still catches it. Regressions, malformed inputs, chess invariants,
persistence, IPC, error handling, cancellation, cleanup and accessibility contracts stay.

The suite had no snapshot or static-markup tests (it runs in Node, without a DOM), so nearly every
file is **keep**. The changes are small and listed below; fewer tests was not the aim.

| Area                                                                | Files | Classification                                 |
| ------------------------------------------------------------------- | ----- | ---------------------------------------------- |
| `main/repertoire`                                                   | 9     | keep; 1 merge                                  |
| `main` (db, ipc, engine, databases, lichess, telemetry, commentary) | 46    | keep; 1 replace, 4 simplify                    |
| `renderer` app, stores, lib, ipc, queries, sounds                   | 41    | keep; 1 replace, 4 simplify, 1 move            |
| `renderer/features`                                                 | 34    | keep; 1 remove, 2 merge, 2 simplify/strengthen |
| `packages/shared`                                                   | 30    | keep; 3 merge, 1 simplify, 1 move              |
| `perf`                                                              | 1     | keep; 1 replace                                |
| e2e specs                                                           | 10    | keep (journeys are distinct); sleeps reviewed  |

## Removed, merged and replaced

| Test                                                                             | Action  | Defect it caught                                                           | Still caught by                                                                                                                                                          |
| -------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| repertoire-model › "adopts a save result only when nothing was edited meanwhile" | remove  | a save result adopted over newer edits                                     | repertoire-workspace-store › "adopts a save result unless the draft changed while it ran" (the store calls `shouldAdoptSaveResult`; the removed test restated `a === b`) |
| repertoire-model › the two draft-key tests                                       | merge   | draft key collisions (field, repertoire, wrong move, `paused` vs feedback) | the merged test, every assertion kept                                                                                                                                    |
| import-progress › "starts with the jobId … no progress yet"                      | merge   | a new run with the wrong jobId or leftover progress                        | the merged "follows only that job's events" test                                                                                                                         |
| renderer ipc/commentary › "does not expose a secret-read method"                 | replace | nothing: it checked its own stub                                           | main/ipc/channels › "never gives the renderer a way to read a secret": the preload's real `commentary:*` channels, and no key/secret/token channel at all                |
| backup › "reads a picked file that starts with a byte order mark"                | merge   | a BOM not stripped from a picked backup                                    | the picked-file test, now writing its file with a BOM                                                                                                                    |
| tactics › "returns an array of all detected motifs without duplication"          | merge   | a fork reported twice                                                      | the king-and-queen fork test, now asserting exactly one fork                                                                                                             |
| rating-curve › "preserves probability values exactly"; the second `probFor` test | merge   | rounded probabilities; the wrong bucket                                    | the merged tests, every assertion kept                                                                                                                                   |
| pgn › three `[%clk]` comment-shape tests                                         | merge   | a clock missed for a comment shape                                         | one `it.each`, one row per shape                                                                                                                                         |
| perf › `p95 >= 0` assertions                                                     | replace | nothing (they can't fail)                                                  | the timed work's result: decisions collected, every repertoire listed                                                                                                    |

## Simplified or strengthened

- review-utils › the main-line test has a variation now, so following one fails it (it passed on a
  single-line tree before).
- repertoire-practice-store › the lead-up and flip test now checks the graded session is untouched,
  as its name claimed.
- repertoire-scheduler › interval and retry expectations are the spec's numbers
  (`[1, 3, 7, 14, 30, 60, 60, 60]` days, 10 minutes), not the implementation's constants.
- onboarding-state › a constant compared to its own literal is gone (the step test implies it).
- channels › no hard-coded channel count; migrations › no hard-coded schema version.
- repertoire-handler › handlers are registered in `beforeAll`, so a test no longer depends on the
  first one running; telemetry/service › dead fake-timer cleanup removed.
- game-store, settings-write, saved-game › mocks, pending settings and stubbed globals are cleaned
  up in `afterEach`, so a failing test can't leak into the next; a misnamed clock test renamed.
- The play-draft test moved from ui-stores to play-draft-store (with its reset), and the
  lightweight-model test to `llm/models.test.ts`.
- `toThrow()` with no message (49 malformed-input tests) now names the error it expects, and
  conditional `expect`s in tactics and repository tests became unconditional (earlier commit).

## Sleeps

Real sleeps were replaced by the milestone they stood for: a `quit` sent to the engine, a chunk on
disk, a logged failure, progress events, the heartbeat's next tick, a cancel on the second check.
Four "no full scan started" sleeps were removed: a full scan starts inside `samplePuzzle`. Three
absence checks keep a short window, with the reason beside them (no spawn during a draw probe, no
second quick scan, and the e2e check that an answered card doesn't auto-advance). Zero-delay
macrotask flushes stay. `chaturanga/no-test-sleep` now rejects new sleeps in tests.

## Considered and kept

- Constant checks that guard saved-data compatibility or user-visible output (commentary-scheduler
  keys, opening-comparison hashes, the 20 MiB import cap, settings defaults, review labels).
- Call-order assertions where the order is the contract (the draft flush before a load, the write
  gate, dialog options, sent IPC events, the reindex spies).
- The four stale-chapter practice tests: each takes a different path and asserts a different result.
- The busy-lock tests' 1 s waits: the blocked thread orders them deterministically.
- EngineClock's `remainingClockMs` test: the fastest direct check of the stopped-clock contract.

Coverage (statements / branches / functions / lines), thresholds unchanged:

|         | Before this work              | After the lint fixes          | After this audit              |
| ------- | ----------------------------- | ----------------------------- | ----------------------------- |
| shared  | 93.44 / 82.30 / 96.73 / 96.47 | 93.43 / 82.33 / 96.75 / 96.52 | 93.43 / 82.33 / 96.75 / 96.52 |
| desktop | 89.62 / 83.43 / 88.46 / 92.27 | 89.62 / 83.31 / 88.58 / 92.30 | 89.62 / 83.29 / 88.58 / 92.30 |

The branch dip comes from the type guards the lint work added (their failure branches), not from
removed tests. Tests: shared 340 → 342, desktop 1375 → 1373.
