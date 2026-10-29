# Repertoire: your games, practice and the explorer

What the Repertoire overhaul adds, modelled on outofbookchess.com (ideas and behaviour only),
and the places where it goes further: local game statistics, Maia, a repertoire health check, and
in-app game review. Everything runs locally. It extends `docs/repertoire-design.md`; where the two
disagree, this page wins.

Decided with the user on 29 October 2026:

- Insights is a title-bar tab in Repertoire.
- A slip in a real game counts as a practice miss.
- Study adds moves through a staged **New moves** card.
- The games compared are synced and imported games with a user side (the puzzle rule).
- Scheduling keeps our stages and adds Learning, Mastered, Practice early and a daily new-move
  limit.
- Progress shows the mastery bar and Perfect lines only.
- The explorer shows your games, Maia and the health check.
- There is no typed-move entry anywhere: moves are made on the board.

## 1. Where it lives

Repertoire gets title-bar tabs: **Repertoires · Practice · Insights**, with the settings cog last.
Study, practice sessions and Game review open from these tabs. Back returns to the tab and scroll
position they came from.

The screens, components and UI strings are in
[repertoire-games-and-practice-ui.md](repertoire-games-and-practice-ui.md). Where the two
disagree about behaviour, this page wins.

## 2. Repertoires tab (the hub)

- Repertoires are grouped by colour (**White**, **Black**). Within a colour, chapters are grouped
  by opening family: the opening name before the colon, e.g. "Caro-Kann Defense".
- Each repertoire shows:
  - "N chapters · M moves · K to practise" (K is the number of the player's trainable decisions);
  - a **learned** bar, "L of K learned", where learned means stage ≥ 1;
  - Study, and Practice (due count, or Resume);
  - the existing ⋯ actions: Edit, Import PGN, Export PGN, Duplicate, Archive, Delete.
- Each chapter row shows its title, the detected opening (name and ECO), its kind (Opening or
  Reference), and its due count. Its actions are **Practise this chapter** and **Open in Study**.
- An empty colour says what to do: import a PGN (for example a Lichess study export), or create
  one.
- The existing title search and Archived toggle stay.

### Opening detection

- A chapter's opening is the deepest position along its mainline that the bundled opening book
  names (`apps/desktop/src/main/engine/opening-book.ts`). Its name and ECO are stored on the
  chapter and can be edited in Edit chapter.
- Detection runs on import, when a chapter is created, and, for existing chapters, once in the
  background.
- An edited opening is never overwritten.

### Import preview additions

- The opening (name and ECO) per game, editable.
- A repertoire name inferred from the most common opening family, and a colour from the
  `Orientation` tag (else from the side whose moves branch less). Both apply only to a new
  repertoire and are editable.
- Three counts:
  - **New moves**;
  - **New practice moves** (the existing decisions count);
  - **Positions with several of your moves**, which warns that the PGN gives the player more than
    one move at a position, including by transposition.

## 3. Study

### Choices panel

Beside the move tree, for the current position:

- **Your move** (the player to move) or **Their replies** (the opponent to move): every move in
  this repertoire from this position, across all chapters, because decisions are per position.
- Each row shows:
  - the SAN;
  - its kind: practised, study-only, or covered;
  - Preferred, when it is the preferred move;
  - the chapter(s) it comes from;
  - health flags, if any (see §6.3);
  - a ⋯ menu with Make preferred, Make study-only / Practise it, and **Remove…**. Remove deletes
    the move and what follows in this chapter, with Undo.
- **Also in your repertoire**: the moves played elsewhere in the tree at this ply (siblings). Each
  is a chip that jumps to it.

### Repertoire arrows

On the board: green for the player's practised moves and blue for covered replies; study-only
moves are not drawn. A Study setting ("Repertoire arrows", on by default) turns them off for
quizzing yourself. Practice never shows them.

### Staged moves (New moves → Add)

- Playing a move that is not in the chapter at this node **stages** it; nothing is saved. Engine
  lines picked in the engine panel are staged the same way.
- The **New moves** card lists the staged moves as chips with ×, which drops that move and what
  follows. It also shows:
  - one sentence per decision change, e.g. "3…c5 becomes another move of yours there (you also
    play Bf5)" or "4.Nf3 becomes a reply you prepare for";
  - "N new practice moves" (or "No new practice moves").
- **Add N moves to [chapter ▾]**:
  - The chapter menu lists every chapter of the repertoire, plus **New chapter**, which is named
    after the line's opening.
  - The default is the current chapter.
  - The player's moves are added as practised moves, and the opponent's as covered.
  - A secondary **Add as study-only** adds the player's moves as study-only.
  - The add is one undoable edit.
- Moving through the current chapter keeps the staged moves. Opening another chapter or leaving
  Study with staged moves asks "Discard N unsaved moves?" first. Nothing is discarded unless the
  navigation goes ahead.
- No typed-move input.

### From your games banner

Opened from Insights, Study shows a dismissible banner at the top of the side panel:

- **Forgot**: "From your games: you played 4…Bf5 here in 38 games, 4…Nf6 in 6. Your repertoire
  move: 4…Nc6." It offers **Practise this position**.
- **Unprepared**: "From your games: opponents played 3.e5 here in 32 games. Your repertoire
  doesn't cover it yet. Play your answer and add it." The reply is staged.
- **Health flag**: the flag's explanation (§6.3).

## 4. Practice tab

### Sets

One card per set: **Everything**, **White**, **Black**, and each repertoire. Each card shows
"D due · N new · L learning" and its buttons:

- **Review** when anything is due; **Practice early (L)** when nothing is due but some cards are
  learning; otherwise a quiet "Nothing due. Next review {when}".
- **Learn new (n)**, while there are new positions and today's new limit isn't reached.
- Practise one chapter from the hub row, or from Study.

A **Weak spots from your games** banner (when Insights has forgotten positions) shows "N positions
where you left your repertoire in real games" with **Practise weak spots** and **See the
report**.

### Progress

- A mastery bar per colour and per repertoire: **Mastered · Learning · New**. Mastered means the
  next review is 21 or more days after the last attempt. Learning means attempted but not
  mastered, or due within 20 minutes after a miss. New means never attempted. It reads "L of K
  learned".
- **Perfect lines**: "P of T lines" per repertoire.
  - A line is a path from a chapter's training start to an authored stop or leaf in an enabled
    opening chapter, deduplicated by the positions it practises.
  - It is perfect when every practised decision on it is learned (stage ≥ 1). A miss, in practice
    or in a recent game (§5.4), sends a decision back to stage 0, so the line stops being perfect
    until the decision is answered right again.

### Practice settings (the cog)

- **New positions per day**: 5 / 10 / 20 / 50 / no limit; default 10. It counts positions
  answered for the first time today (local day), across all repertoires.
- **Show the move on new positions** (default on): the first time a position comes up, its move
  is shown (arrow and text) and the player plays it. This first sight schedules it as learning,
  due in 10 minutes, with no success credit.
- **Sounds** (default on): a chime for a right answer and a low tone for a wrong one, on top of the
  board's move sounds.

A **How it works** popover defines Due, Learning, New, Review, Practice early, Learn new, Mastered
and Perfect line in one or two sentences each, matching this section.

### Scheduling

- The stages (1/3/7/14/30/60 days), per-position grading and the hint rules stay as they are.
- New: Learning and Mastered (defined above) are derived and not stored.
- New: Practice early uses the learning cards and doesn't count as overdue reviews. Answers
  schedule as usual.
- New: one global daily new limit replaces the per-repertoire "New cards after due ones" setting.
  The per-repertoire cards, depth and chapter settings stay. Review adds at most 10 new positions
  after the due ones, and never more than are left today.
- **Game misses**: see §5.4.

### Session

- Counters: "Due D · New N · Done X · P% right".
- Wrong move: "Not 1…e5. Your move here is 1…c6." with the answer's arrow, then "Play it to
  continue." The grade stays as the first answer left it. Authored wrong-move feedback is shown
  under it.
- Weak spots mode (§5.5).
- The summary is unchanged.

## 5. Insights tab

### 5.1 Comparing games

A background comparer in main checks every eligible game against the repertoires of the user's
colour.

- **Eligible games**: Lichess, Chess.com and imported games whose player name matches a connected
  account (`userSideOfGame`, as for puzzles). The rest are counted as "no user side" and skipped.
- Each game is compared with **each** repertoire of the user's colour, using
  `compareGameToRepertoire`. The game's outcome comes from the repertoire it followed longest
  (most `matchedPlies`; ties go to the first created).
- **Outcomes**:

  | Outcome         | From the comparison                            |
  | --------------- | ---------------------------------------------- |
  | `forgot`        | `player-deviation`                             |
  | `new-reply`     | `uncovered-opponent`                           |
  | `ended-in-book` | `preparation-ends`                             |
  | `in-book`       | no issue: the game ended inside the repertoire |
  | `not-covered`   | `no-applicable-chapter` (another opening)      |
  | `no-repertoire` | there is no repertoire of the user's colour    |

- Results are stored per game with the content hash, repertoire revision and algorithm version.
  - They are recomputed when a game is added, changed or deleted, when a repertoire's revision
    changes, or when the algorithm version changes.
  - Work runs in chunks that yield to the event loop and never block the UI.
- The comparer starts at app start and after a games sync, import, delete or repertoire edit.

### 5.2 Report

Filters, saved, and used by the report and weak-spots practice:

- date: all time / last 3 months / 6 months / 1 year / 2 years / since a date;
- time controls (multi-select, with counts);
- rated + casual / rated only;
- account (each connected account, plus Imported).

Sections:

- **N games**: a stacked bar with Forgot a move, Unprepared reply, Stayed in book (in-book plus
  ended-in-book) and Other openings, with counts.
- **Practise weak spots** call to action.
- **Moves you forgot**, grouped by repertoire and position:
  - the number of games;
  - the line, in its most common move order, with the repertoire move highlighted;
  - "You played X (n), Y (m)";
  - your score in those games;
  - last seen;
  - **Practise** (that position only), **Open in Study** (with the banner) and **Games** (the
    filtered games list).
  - The top 8 are shown, with Show all.
- **Replies you haven't prepared**, grouped by repertoire, position and reply: the number of
  games, the line with the reply highlighted, your score, last seen, **Prepare** (Study with the
  reply staged and the banner) and **Games**.
- **Openings not in your repertoire**, a summary line plus See all, in three columns:
  - **Your opponents chose**: the opponent's first move outside the repertoire at the root;
  - **You chose**: you played a different first move;
  - **No repertoire for this colour**.

  Each lists its first moves with the opening name and game count. Explanation: "Not mistakes:
  hints on what to prepare."

- **Score by line**: games are grouped by their moves up to move N, where a select offers moves 2
  to 8 and the default is 4. Only games that were still in the repertoire at that point are
  counted. Each line shows the games, W/D/L, score % (the user's points divided by games), the
  after-book average, and **Open**. Sorted by games.
- **After leaving book**: for games that have a saved review, the average win-% the user lost over
  the 10 plies after leaving the repertoire, per forgotten position and per unprepared reply. It
  appears as a column on those rows, e.g. "−12% after" (from 5 reviewed games), and only when at
  least one game was reviewed.
- **Repertoire health** (§6.3): the latest flags per repertoire, with **Check now**.

### 5.3 Games list

- The Games card at the bottom of Insights. A row's **Games** button or a segment of the bar
  filters it and scrolls to it.
- A table of 50 per page:
  - date;
  - account;
  - your colour;
  - opponent (rating);
  - result pill;
  - time control;
  - opening;
  - **outcome pill**: "Forgot 4…Nc6" (its title says "You played 4…Nf6; your repertoire has
    Nc6"), "New reply 3.e5", "In book", "Ended in book", "Not covered: 1.e3", "No White
    repertoire", or "No user side".
- Filters: the report's, plus colour, repertoire, outcome, and "up to move N" (the issue happened
  at or before move N).
- Clicking a row opens the game in **Game review** at the issue ply. The opening section is
  already there; nothing about review changes.

### 5.4 Game misses feed the schedule

When a game's outcome is `forgot` at a decision, it applies a miss **once per (game, repertoire,
position)** if all of these hold:

- the game was played in the last 30 days;
- the game was played after that position's current accepted move set was first accepted;
- the position has been practised before, and the game was played after the last practice attempt
  there and after the last miss applied there;
- the position isn't paused.

The miss counts as a practice attempt (it sets the last attempt time) and is
`scheduleAfterOutcome(…, "wrong")` at the time it is detected: stage 0, lapses + 1, due
in 10 minutes. A game that **followed** a decision (the repertoire move was played) changes nothing.

Decisions gain an `acceptedAt` timestamp: when the current accepted set was first stored. Existing
decisions take their own last update time.

### 5.5 Weak-spots practice

- A practice mode, `weak`, built from the report's filters.
- First, the forgotten positions, most games first, as position cards (with the lead-up replay).
- Then the lines you meet most: a Lines rehearsal where, at each opponent position, the reply is
  the one most often played in your games against this repertoire (by count; untried replies
  rotate in after the top one), until a stop, a leaf or the end of your games' data.
- Weak-spots answers schedule like Review.
- **Practise** on a single forgot row starts this mode for that position only.

## 6. Explorer and health check (Study)

The Explorer is a Study side-panel section with two tabs.

### 6.1 Your games

- For the current position: every move played from it in the user's eligible games, by either
  side.
- Each row shows the move (SAN), the number of games, **your score** after it (W/D/L and %), and
  last played. It is marked when the move is in the repertoire, and offers **Stage** (§3).
- It uses a local position index of eligible games: position key → move, game, user colour and
  result, for the first 40 moves (80 plies). It is built in the background and kept up to date
  with the games.
- Empty: "None of your games reached this position."

### 6.2 Maia

- Maia 3's move probabilities for the side to move at a rating. The default is the user's rating
  for the chosen time control: the Settings rating, else the median of their recent games.
- A rating select on Maia's grid, and a time control select.
- It shows the top moves to 90% of the weight, at most 8, each with % and its repertoire mark.
- At an opponent-to-move position the heading reads "What players at {rating} play here".
  Unprepared moves at 10% or more are marked **Prepare** (staging them).
- When Maia 3 isn't installed: "Maia 3 isn't installed" with a link to Settings → Engines.

### 6.3 Health check

A background queue in main checks one repertoire at a time, on **Check now** (Insights, or the
repertoire's ⋯ menu) and after an edit (debounced 30 s, only for repertoires checked before).

- It uses the default engine, with the engine settings' threads and hash, depth 18, and yields
  while the user's engine is busy (the puzzle queue's rules).
- It runs only when Lc0 isn't the default and an engine exists. Otherwise it reports the problem,
  as the puzzle card does.
- **Flags**, stored per repertoire and position and shown in the choices panel, the Insights
  health section and the banner:
  - **Engine disagrees**: a practised move of the player's loses at least 10 win-% compared with
    the engine's best move (MultiPV 2). It shows both moves and the loss.
  - **No answer**: a covered reply after which the player has no practised move, and the position
    isn't a chapter end or stop. Found without the engine.
  - **Their common mistake**: at a covered opponent position, Maia (at the user's rating) puts at
    least 30% on a move that loses at least 20 win-% for them. It shows the move, the probability,
    and the engine's best punishment. Needs Maia 3.
- Flags come with the repertoire revision they were made against and are dropped when their
  position no longer exists.

## 7. Storage

Migrations, in stack order:

- **16 (practice)**:
  - chapters gain `opening_name`, `opening_eco` and `opening_edited`;
  - a `repertoire_practice_settings` row in `settings` (new per day, show move, sounds);
  - `repertoire_new_introductions(day, repertoire_id, position_key)` for the daily limit;
- **17 (insights)**:
  - `repertoire_game_outcomes`: game_id FK cascade, repertoire_id FK cascade, color, outcome, ply,
    position_key, played_uci, expected_ucis JSON, chapter_id, matched_plies, game_hash, revision,
    algo_version, compared_at;
  - `repertoire_game_misses(game_id, repertoire_id, position_key)`, unique;
  - decisions gain `accepted_at`;
  - Insights filters live in `settings`.
- **18 (explorer)**:
  - `game_position_moves`: position_key, game_id FK cascade, ply, move_uci, user_color, result,
    played_at, with an index on position_key;
  - `repertoire_health_flags`: repertoire_id FK cascade, position_key, kind, data JSON, revision,
    checked_at;
  - `repertoire_health_queue`.

## 8. Not changed

Game review, Library, the puzzle sets, the puzzle rating, and Play behave as before, apart from
the links into them described here. Existing repertoire data, backups and PGN export keep
working. New columns are optional in backups, and a backup without them restores.
