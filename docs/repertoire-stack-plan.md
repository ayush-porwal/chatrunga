# Repertoire: PR stack after the first slice

[repertoire-implementation-plan.md](./repertoire-implementation-plan.md) describes the first slice
(PR 28, `feat/repertoire`). The deferred items from [repertoire-design.md](./repertoire-design.md)
§12 ship as a stack of PRs, each based on the previous branch so they merge in order.

| # | Branch | Scope | Design |
| --- | --- | --- | --- |
| 1 | `feat/repertoire-compare` | Game review **Opening** tab: compare a finished game's mainline against a repertoire (shared `repertoire-compare.ts`, `repertoires.compareGame`), per-colour remembered repertoire, actions Study this position / Refresh this decision (targeted queue via `PracticeScope.positionKeys`) / Add this response (staged covered reply) / Adopt played alternative (explicit) | §6.3 |
| 2 | `feat/repertoire-add-from-games` | **Add to repertoire** from the Library and from the Analyze board's selected variation; source provenance (`repertoire_game_links`); "Use current game/line" when creating | §6.2 |
| 3 | `feat/repertoire-handoffs` | Study → **Analyze** as an independent game snapshot with a return target; **Play from here** against the engine from a repertoire position/path; Lichess live-game guards on every repertoire command that would replace the board | §6.2, §6.4, §9.3 |
| 4 | `feat/repertoire-rehearse` | **Rehearse lines** practice mode: authored opponent replies with deterministic rotation, out-of-branch accepted move handled as "a repertoire choice in another line", session-only results | §5.3 |
| 5 | `feat/repertoire-backup` | Versioned native JSON **backup/restore** (validated, default new copy, include-progress option, retained copy when replacing) | §10 |
| 6 | `feat/repertoire-import-worker` | PGN parsing in a worker with cancellation/progress, representative large-collection benchmark, tree windowing if the benchmark requires it | §10, §11 |

Rules carried over: main process stays the authority; nothing repertoire-related enters the game
store; contract first, then main and renderer in parallel; every PR gets a read-only review and a
real-app smoke run before it opens; rebase, never merge.
