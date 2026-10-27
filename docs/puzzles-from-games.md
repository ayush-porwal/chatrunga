# Puzzles from your games

Puzzles made from the user's own imported games, found by Stockfish and Maia 3 in a background
queue, trained with spaced repetition in Puzzles. Everything runs locally.

Rules for finding puzzles are modelled on Lichess's puzzle generator (`ornicar/lichess-puzzler`,
AGPL-3.0): only the ideas are used, none of its code.

## Where it lives

- **Databases → "My games" card**, beside the downloadable databases:
  - games per source (Lichess, Chess.com, imported), games processed, puzzles found, puzzles due;
  - the queue's live progress (game n of N, current game) with Pause / Resume and Cancel;
  - **Generate puzzles** (opens the dialog) and **Train** (opens Puzzles on the "From my games" set).
- **Generate puzzles dialog**:
  - Games: sources (Lichess, Chess.com, imported), time controls (bullet, blitz, rapid, classical,
    correspondence), how many (25 / 50 / 100 / all, newest first), "Skip games already processed"
    (on by default).
  - Puzzle kinds (checkboxes, all on by default): Your mistakes, Missed chances, Opponent's chances,
    Hard finds, Tricky positions. Hard finds and Tricky positions need Maia 3: disabled with a
    "Download Maia 3" link when it isn't installed.
  - Depth: Quick / Standard / Deep, each naming its search depths (see Depths).
  - Shows how many games match before starting.
- **Puzzles → "From my games" set** in the set picker:
  - Queue order: due puzzles first (oldest due first), then new ones (newest game first).
  - Filters: kinds, difficulty range (Maia rating), game source.
  - Solving: the same session as Lichess puzzles (fails on the first wrong move or on showing the
    solution). The board is shown from the solver's side (the opponent's side for Opponent's chances).
  - After the puzzle ends: kind, opponent, date, move number, "Players at {rating} find this {p}% of
    the time" (when it has a difficulty), and **Open game**, which opens the game at that move.
    None of this is shown before the puzzle ends.
  - Attempts never change the puzzle rating (Glicko-2 stays Lichess-sets only).

Nothing else changes: game review, Library, repertoire, the downloaded puzzle sets and the puzzle
rating behave as before.

## Which side is the user

A game's user side is the side whose player name matches a connected Lichess or Chess.com username
(case-insensitive). Games where neither name matches are not eligible (they are counted but skipped).

## The queue

- Runs in main, one game at a time, with its own UCI process of the default engine (custom UCI
  engines only; Lc0 is skipped if it is the default — the dialog says so). Threads and hash from the
  engine settings (it steps aside while the user uses an engine, so it can use them all).
- Yields while the user is using an engine elsewhere (a review, live analysis, a game against an
  engine, puzzle explanation): it finishes the current search and waits until they are idle.
- Persisted: queued games survive a restart and resume (paused state is kept).
- Pause stops the running game at once (no engine process stays open) and puts it back first in
  line; Resume starts it again. Starting from the dialog resumes a paused queue; Cancel empties it
  and clears the pause.
- A game whose generation fails is recorded with its error and the queue moves on. A failed game
  isn't "processed": "Skip games already processed" skips done and skipped games only.
- A default engine that is missing or won't start stops the queue instead (its games stay queued);
  the card says why, and the queue tries again on Start, Resume, app start and when the engines
  change.
- Saves no game reviews.
- **Review hook**: when a game review the user ran finishes (`reviewCompleted`), and the game has a
  user side, the game is queued with that review's evaluations used instead of the quick scan
  (only the deep check runs). Its puzzle kinds and depth are the last ones used in the dialog
  (defaults if never opened). The review code itself is not changed.
- Re-processing a game (skip unchecked) replaces its puzzles of the kinds that ran, keeping the
  progress of puzzles whose position and solution are unchanged.

## Finding puzzles

All scores use the win-% scale of `chess/move-assessment.ts` (`winPercent`, 0–100, from the side to
move). "Clear-cut" below means: the best move is at least `ONLY_MOVE_GAP` = 35 win-% points ahead of
the second best, or the best move mates and either no second move mates or the best non-mating move
leaves the side to move under 80 win-% (a mate in one with an alternative mate in one counts when
every non-mating move is clearly worse), or there is only one legal move (never the first move of a
puzzle).

1. **Quick scan** — every position before a move, score at the scan depth, one line (MultiPV 1).
   With Maia installed, Maia 3 reads each position at the side to move's rating (game header Elo,
   else Settings rating for the time control; `nearestMaia3Rating`; `eloOppo` the other side).
2. **Candidates** (positions; `mover` = side to move, `loss` = win-% the played move gave up):
   - **Your mistake** — mover is the user, loss ≥ 10 (Mistake threshold).
   - **Missed chance** — mover is the user; the opponent's previous move raised the user's win-% by
     ≥ 30 to at least +2 pawns (or a mate); the user was not already winning before it
     (≤ +3 pawns) and not already up material; the played move was not the best.
   - **Opponent's chance** — the same two rules with mover = the opponent (their mistake, or the
     chance the user gave them and they missed).
   - **Hard find** — mover is the user, the played move is the best move, Maia's probability for it
     at the user's rating < 10% (`HARD_PROBABILITY`).
   - **Tricky position** — mover is the user, the user did not lose ≥ 10, and Maia puts ≥ 50% of its
     weight (at the user's rating) on moves that lose ≥ 10 win-%. The weight is measured over Maia's
     most likely moves until they cover 80% of its weight (at most 5), each scored by the engine
     (searchmoves) at the scan depth.
   - Skip: positions with fewer than 2 legal moves; repeated positions (until an irreversible move);
     book moves.
3. **Deep check** — the candidate position at the verify depth, MultiPV 2. Keep it only if the best
   move is clear-cut. For Your mistake / Opponent's chance from a mistake, the played move must not
   be the best move; for Hard find, the played move must be the best move.
4. **Solution** — starting with the best move, alternate: the opponent's reply is the engine's best
   move (MultiPV 1 at verify depth); the solver's next move is kept only while it is clear-cut and,
   for chance kinds, the solver still stands at ≥ +2 pawns (or mates). Mating lines follow the mate
   to the end. The line always ends on a solver move; trailing solver moves that had only one legal
   move are dropped. Minimum length: one solver move for Your mistake, Hard find and Tricky; two
   solver moves for Missed chance and Opponent's chance from a missed chance. Maximum 8 solver moves.
   A one-move solution that only takes back what the previous move captured (same square) is
   dropped.
5. **One puzzle per position** — priority Missed chance > Your mistake > Opponent's chance >
   Tricky position > Hard find (a missed chance is nearly always a mistake too, so the more telling
   kind goes first); every other kind that also applied becomes a tag (e.g. a mistake in a tricky
   position is tagged `tricky`).
6. **Difficulty** (Maia 3 installed) — for each grid rating r in 600–2600: chance(r) = product over
   the solver's moves of Maia's probability of that move at r (`eloOppo` = r, as both sides are
   read at the same rating for the curve). Difficulty = lowest r with chance(r) ≥ 50%, or "2600+"
   (stored as null with a flag) when none. The chance at the user's rating is stored for the
   "Players at … find this …%" line.
7. **Themes** — tagged from `chess/tactics.ts` on the solution where available (fork, pin, mate…);
   the mating move itself is never tagged with a motif.

### Depths

| Preset   | Scan depth | Verify depth |
| -------- | ---------- | ------------ |
| Quick    | 10         | 16           |
| Standard | 12         | 20           |
| Deep     | 14         | 24           |

## Spaced repetition

Reuses `chess/repertoire-scheduler.ts` unchanged (`scheduleAfterOutcome`, stages 1/3/7/14/30/60
days, a lapse returns after 10 minutes). Solved without a wrong move or the solution = `unaided`;
anything else = `wrong` (shown solution = `reveal`). New puzzles are due at once.

## Storage (migration 15)

- `game_puzzles` — id, game_id (FK, cascade), ply, kind, tags_json, solver side, start FEN (before
  the setup move), setup move (the move before the puzzle position, if any), solution UCI JSON,
  played move, eval before/after (win-%), difficulty rating, difficulty_capped, user-rating chance,
  themes JSON, position key, generator version, depths, created_at. Unique (game_id, ply).
- `game_puzzle_progress` — puzzle_id (FK, cascade), stage, due_at, lapses, last_attempt_at,
  last_outcome, attempts.
- `puzzle_generation_games` — game_id (FK, cascade), status (queued / running / done / failed /
  skipped), settings JSON, enqueued_at, finished_at, puzzles_found, error, source
  (dialog / review). Also holds the queue order.
- Queue paused state and last-used dialog settings live in `settings`.
