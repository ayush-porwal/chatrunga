# Repertoire overhaul: screens and strings

Companion to `repertoire-games-and-practice.md` (behaviour). This page fixes the layout, components and
UI strings; where they disagree on behaviour, the behaviour page wins. Component names are
those in `components/ui`, `features/board`, `features/repertoire`, `features/database`.

## 1. Information architecture

The window's title bar stays the page's title, `Repertoire` (plus the live game's button), like Play,
Puzzles and Databases. The tabs live in the hub card's own title bar (`WorkspaceTabBar`, as Analyze and
Game review), with the shown tab's actions at its right end:

```
 Repertoire                                                          ← window title bar: title only
 ┌───────────────────────────────────────────────────────────────────────────┐
 │ Repertoires ①   Practice ⑫   Insights            🔍  Archived  [+ New ▾] │ ← the card's tab bar
 ├───────────────────────────────────────────────────────────────────────────┤
 │ (the tab's content)                                                       │
 └───────────────────────────────────────────────────────────────────────────┘
```

- Pills: Repertoires = active repertoires, Practice = due positions (none for 0).
- Actions at the bar's right end, per tab (`HubTabActions` portals them there from the tab):
  - Repertoires: search, an `Archived` ghost toggle (only when some are archived, or while it is on),
    `+ New ▾` (Blank repertoire / Import PGN / Import book (PDF)…). No cog: backups live in Settings.
  - Practice: `How it works`, then `Practice settings` (the cog, last).
  - Insights: `Filters` (a funnel with a dot while they leave games out; its label names them),
    opening the Filters dialog: Period, Time controls and Accounts with counts, Rated + casual /
    Rated only, Reset and Done. Changes save at once.
- The tab is remembered in settings, so the sidebar's Repertoire and Back return to it, with its scroll.
- Practice and Insights content sits in the same card as sections under hairlines (no card in a card).
- Study and sessions stay full board routes with `WorkspaceTitlebar`. A session started from a set
  tile or a weak-spot row gets "Back to Practice" in its summary footer (beside "Practice again").
- Insights → Game review opens at the deviation ply; `RepertoireHandoffActions` gains "Back to
  Insights". Insights → Study uses `StudyOpenTarget.stage` (exists) plus a `fromGames` payload for
  the banner (§2c).
- `ReviewOpeningPanel` keeps its one-game comparison; "Add this response"/"Adopt" now stage into the
  New moves card (one authoring path, no more silent study-only writes).

## 2. Screens

### 2a. Repertoires tab (hub)

A table (`RepertoireTable`, Play's Recent games pattern): rows are memoised and counts compare across
repertoires.

```
   Repertoire                    Chapters   Learned              Last studied
White · 2
▸ 1.e4 for White                    7       ███░░░ 4 of 238      Today        [Practice 12] ⋯
▾ London System                     3       █████░ 60 of 90      3 days ago   [Practice]    ⋯
     London System · 3 chapters
       Main line   D02  Queen's Pawn Game: London System   41 moves · 2 due   [Practise]
Black · 1
▸ Caro-Kann                         7       █░░░░░ 4 of 118      Yesterday    [Practice]    ⋯
```

- Sunken group rows "White · 2" / "Black · 1"; a colour without repertoires has no group.
- Columns: Repertoire (expander, name, tags, Book/Archived badges) · Chapters · Learned (`Progress` +
  "4 of 7,496", stage ≥ 1 of your moves) · Last studied · actions. No board thumbnail (the group gives
  the colour), no separate "Your moves" (Learned's total) or Due (the Practice button's pill).
- Rows are compact (`h-14`); numbers use thousands separators.
- The expander ▸ (`IconButton` "Show chapters", first in the name cell) lists chapters grouped by
  opening family ("Caro-Kann Defense · 7 chapters"), each: title · `Badge` ECO · variation · "41 moves ·
  2 due" · "Practise" (chapter preset). Title click → Study at that chapter.
- No repertoire at all: `HubEmptyState` inside the card (the bar's tools are hidden; its New is the
  one). Loading: `SkeletonRow` ×3. Error: Notice + Try again.
- A book's repertoire is marked by its books row (the Book badge), never by a tag.

### 2b. Import preview (`ImportPgnPreview`)

Above the list:

1. New-repertoire line (only when creating): `Input` Name prefilled from the first chapter's opening
   family; `SegmentedControl` White/Black from the `Orientation` tag, else the side with decisions. Hint:
   "Suggested from the PGN. Chapters are grouped by the part of the opening before the colon."
2. `StatStrip grid-cols-3`: "New moves" 238 · "Your moves to practise" 118 · "Positions with several
   of your moves" 1 (`text-warn` when > 0, link-button "Show" filters the rows). The per-row practice
   count goes; `importPracticeNote` stays for reference rows only.

Per row (existing `well`): checkbox · Name · Opening `Input` with a `<datalist>` from the bundled
opening book (text, not a move) + ECO `Badge` that follows it · kind `Select`. Second line `font-mono
text-2xs`: "1. e4 c6 2. d4 d5 3. e5 Bf5 … · 4 lines · 65 moves". Warnings/illegal branches unchanged.
Detection pending: ECO badge is a `Skeleton`; failed: placeholder "Opening not detected", import still
allowed.

### 2c. Study

Panel tabs: **Moves · Chapters · Explorer · Book** (Book for book repertoires). Right: Undo, Redo
(Moves only), Export PGN, cog last.

```
┌ Moves ──────────────────────────────────────────────────────────┐
│ summary: 1.e4 c6 2.d4 [+4] d5 3.e5 ● Black to move               │ ← line strip
│ notices: [From your games …] [New moves …] [save notices]       │
│ (engine panel while Analyze is on)                               │
│ ▾ Choices   Your move      4…Nc6 ★  4…Bf5                [⋯]     │ ← choices panel
│             Their replies  5.Nf3  5.c4  5.Bd3            [⋯]     │
│ Starting position / tree …                                        │
└ footer: move nav · Practice ────────────────────────────────────┘
```

- **Line strip** = `BoardWorkspace.summary`: SAN chips of the path; a "+N" chip after a move with
  siblings opens an `OverflowMenu` "Also in this chapter: 2.Nc3 · 2.c4 · 2.d3 · 2.Nf3" and jumps. Staged
  moves in the warn tone.
- **Choices panel** (`CollapsibleSection`, open by default) above the tree: rows "Your move" and
  "Their replies" as SAN chips; the preferred move carries ★ (existing icon). Chip click selects; its
  always-drawn xs ⋯ is the existing `StudyMoveMenu`. Empty rows: "No move of yours here yet — play one
  on the board." / "No replies covered yet."
- **Arrows**: green = your moves (preferred solid, others dashed), blue = covered replies, orange engine
  (exists). One setting: `RepertoireSettingsDialog` → Board → `Switch` "Repertoire arrows", hint "Off:
  quiz yourself while studying." Default on.
- **Staged adds**: an off-repertoire move is appended to the draft as _staged_ (warn tone, never
  autosaved, outside the undo stack). `notices` shows `Notice tone="info"` "New moves":
  chips "3…c5 ×"; one sentence: "3…c5 becomes another move of yours here (you also play 3…Bf5)." /
  "3.e5 is a reply you'll cover; play your answer to practise it." / "Already in Caro-Kann — sidelines by
  transposition."; "1 new practice move"; `Button primary` "Add 1 move ▾" (`OverflowMenu`: chapters,
  current first, then "New chapter — Caro-Kann Defense: Advance Variation"), `outline` "Add as
  study-only", `ghost` "Discard". Leaving with staged moves asks "Discard 2 unsaved moves?". Promotion
  of already-saved study-only moves stays as today.
- **From your games** banner (`Notice info`, dismissable): "From your games: you played 4…Bf5 here in 38
  games, 4…Nf6 in 6. Your repertoire move: 4…Nc6." or "From your games: opponents played 3.e5 here in
  32 games. It isn't covered yet; play your answer and add it." (reply pre-staged). Link "Review a game".
- **Explorer tab**, three `CollapsibleSection`s for the selected position:
  1. "Your games": Move · Games · Your score (W/D/L bar + %) · `Badge` "In repertoire" · xs "Add"
     (stages). Line: "Filters: last 12 months · all time controls (set in Insights)". Empty: "None of
     your games reached this position." Loading: skeleton rows. Error: Notice + Try again.
  2. "Likely replies (Maia 3)": "Players rated 1600–1800 play:" Move · Share % ; rating `Select`
     (default: connected account's rating). xs "Add". Not installed: "Maia 3 isn't installed." + "Open
     Settings".
  3. "Health": `Switch` "Whole repertoire"; rows `Badge` kind (Weak move / No answer / Trap) · line ·
     detail ("6.h3: −9% win chance; engine prefers 6.Be2" / "After 5…Nf6 you have no answer" / "Players
     at your level play 5…e5 (23%), which loses to 6.Nxe5") · xs "Open" · "Add" (stages the fix). Queue
     line with Pause/Cancel (MyGamesCard's `QueueProgress`). Flagged tree moves get a small warn glyph
     (BoardMoveMarkBadge style) so they are findable from Moves.

### 2d. Practice tab

At the right end of the hub card's tab bar: `IconButton` "How it works" (CircleHelp), then the cog
"Practice settings" (last).

```
[!] Weak spots from your games: 12 positions where you left your repertoire, then the replies you
    meet most.                                        [See the report] [Practice weak spots]

┌ Everything ──────────┐ ┌ All White ───────────┐ ┌ Caro-Kann (Black) ───┐
│ 3 repertoires · 446  │ │ 2 repertoires · 328  │ │ 7 chapters · 118     │
│ 3 due · 114 new ·    │ │ 0 due · 200 new ·    │ │ …                    │
│ 4 learning           │ │ 4 learning           │ │                      │
│ [Review 3][Learn new]│ │ [Practice early 4][Learn new]                 │
└──────────────────────┘ └──────────────────────┘ └──────────────────────┘
Progress
 Mastery  White ████████░░░░░░░░ 12 mastered · 9 learning · 307 new   21 of 328 learned
          Black ██░░░░░░░░░░░░░░  0 mastered · 4 learning · 114 new    4 of 118 learned
 Perfect lines  1.e4 for White 3 of 17 · London System 9 of 12 · Caro-Kann 0 of 9
```

- Set tiles reuse `DatabaseCard`'s `titleBar/body/footer` on a sunken, borderless tile (thumbnail = first
  chapter); Progress is a section under a hairline, not a card.
  "Review N" primary when due > 0, else "Practice early N" (outline, learning > 0); "Learn new"
  (outline; disabled, title "Daily limit reached, 10 of 10"; absent when nothing is new).
- Weak spots banner: `Notice warn`, only when ≥ 1 forgotten position. No accounts: "Connect Lichess or
  Chess.com in Settings to find weak spots from your games." + "Open Settings".
- Progress: 3-segment stacked `Progress` per colour + perfect lines per repertoire. Nothing else
  (decided). Loading: card skeletons. Error: Notice + Try again.
- Practice settings (global `Dialog sm`): `Select` "New moves per day" (No limit · 5 · 10 · 20 · 50);
  `Switch` "Show the move on new positions", hint "The first time a position comes up, its move is
  shown; play it to continue."; `Switch` "Right and wrong sounds". The per-repertoire "New cards after
  due ones" is removed (one limit); depth/cards/chapters stay per repertoire.
- How it works: "Every move of yours is practised on its own. Right answers push its next review
  further out (1, 3, 7, 14, 30, 60 days); a miss — in practice or in a recent game — brings it back to
  the start. Due: scheduled for today or earlier. Learning: new or missed recently; it comes back within
  20 minutes. Mastered: next review 21 or more days away. Learn new: moves you haven't practised,
  nearest the start of each line first, up to the daily limit. Practice early: today's learning moves
  without waiting. Perfect line: a line from its chapter's start to its end where your latest answer to
  every move of yours was right."

### 2e. Practice session

- Summary strip `StatGroup`: Due · New · Done · Right ("67%"); weak spots: Left · Done · Right.
- Heading above the board: "Review · Caro-Kann (Black) · Advance Variation"; weak spots: "Weak spot 3
  of 12 · seen in 49 games".
- Wrong move: `Notice warn` "Not 1…e5. Your move here is 1…c6. Play it to continue." + authored
  feedback + green arrow; board stays movable (existing `retrying`). Hints/Reveal/Skip unchanged.
- First sight (setting on, stage new): `Notice info` "New position: your move is 4…Nc6." + arrow;
  playing it continues, graded as seen (enters Learning), not as right.
- Weak-spots mode: forgotten positions most frequent first; replies by frequency in your games instead
  of rotation; lead-up replay kept (skippable).

### 2f. Insights tab

Inside the hub card: three sections under hairlines (no cards, no nested tabs). The filters are
in a dialog behind the tab bar's funnel (§1), not on the page:

1. **Filters** dialog (`Dialog sm`): Period `Select` (All time · Last 3 months · … · Since… with a
   date), Time controls and Accounts as chips with game counts, Games `SegmentedControl` (Rated +
   casual / Rated only). Description "Saved; weak-spots practice and the Study explorer use them
   too." Footer: Reset (counts every game; disabled when nothing is left out), Done.
2. **Report** (`CardTitleBar`, count = games; action "Practice weak spots" primary xs):
   - 4-segment stacked bar + legend "Forgot a move 71 · Unprepared reply 231 · Stayed in book 0 · Other
     openings 1,399"; segment click sets the Games outcome filter.
   - "Moves you forgot" (top 8, "Show all"): `49 games` (link → Games filtered) · repertoire · line with
     the expected move in accent · "You played 4…Bf5 (38), 4…Nf6 (6)" · last seen · xs "Practice" ·
     "Open".
   - "Replies you haven't prepared": `32 games` · line, reply highlighted · last seen · "Prepare" ·
     "Review game" (latest, Game review at the move).
   - "Openings not in your repertoire": three columns "Your opponents chose" / "You chose" / "No
     repertoire for this colour" (rows "1.d4 · 219"; third column rows carry "New repertoire"). Footnote:
     "Games that left at the very first moves. Not mistakes: what to prepare next."
   - "Score by line": `Select` "Lines at move 4"; Line · Games · Score (W/D/L bar, %) · "After leaving
     book: avg −1.2" (reviewed games only, else "—") · "Open".
     Empty: `EmptyState` "No games to compare yet" + "Open Settings" / "Import games". Loading: skeleton
     bar + rows. Running: quiet line "Comparing 1,701 games… 62%". Error: Notice + Try again.
3. **Repertoire health**: row per repertoire: name · `Badge`s "3 weak moves · 5 no answer · 2 traps"
   · queue state · xs "Open" (Study → Explorer → Health). Title-bar: "Run check" / Pause / Cancel (the
   MyGamesCard controls). No engine: `BlockerNote` + "Open Settings".
4. **Games** (`CardTitleBar`, count; title-bar `Select` outcome: All · Forgot · New reply · In book ·
   Ended in book · Not covered · No repertoire, and `Input` "Up to move"): Date · Account · `SideDot`
   colour · Opponent (rating) · Result pill · Time control · Opening · Outcome pill ("Forgot 4…Nc6",
   title "You played 4…Nf6; your repertoire has Nc6.") · xs "Review". Row click = Review (Game review at
   the deviation ply). Newer/Older, 50 per page. Empty: "No games match these filters."

## 3. Where we differ from Out of Book

- Table, not cards, in the library; cards only for practice sets (scanning counts vs. one-off actions).
- Study keeps the full tree; the choices panel and line strip sit above it rather than replacing it.
- Explorer (your games, Maia, health) and in-app Game review: local data they don't have.
- Staged adds also offer "Add as study-only"; reference chapters, prompts/hints, training marks stay.
- No typed moves; no streak/accuracy/heatmap (progress = mastery + perfect lines only).
- Weak-spots practice keeps our skippable lead-up replay instead of always replaying from move 1.
- One global daily new-move limit replaces the per-session count.

## 4. Settled points

1. Staged moves live outside the undo stack and are never autosaved; adding them is one undoable edit.
2. "Learned" = stage ≥ 1 (answered right unaided at least once); "Your moves" = the trainable decision
   count. Used the same way on the hub, Practice and Insights.
3. Game misses: only games from the last 30 days, played after the position's moves were accepted, at
   most one miss per position per comparer run.
4. The Study explorer follows the Insights filters and shows them as a line (no own control).
5. The health check runs on demand ("Run check") and after edits to checked repertoires; it waits while
   the puzzle queue is running a game (one engine-heavy queue at a time).
6. The tabs sit in the hub card's title bar (`WorkspaceTabBar`), never in the window's title bar, which
   keeps only the page's title.
