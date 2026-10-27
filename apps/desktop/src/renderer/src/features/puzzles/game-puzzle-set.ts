import { fenAfterUci } from "@chaturanga/shared/chess/position";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { InstalledDatabase, PuzzleSample } from "@chaturanga/shared/types/database";
import type {
  GamePuzzle,
  GamePuzzleFilter,
  GamePuzzleKind,
  GamePuzzleOutcome,
  GamePuzzleSource
} from "@chaturanga/shared/types/game-puzzles";
import type { PuzzleDraft } from "../../stores/puzzle-draft-store";
import type { DecidedPuzzleAttempt } from "../../stores/puzzle-store";
import { mainlinePath } from "../game/move-tree-model";
import type { PuzzleSessionConfig } from "./PuzzlePage";
import { selectedPuzzleDatabase } from "./puzzle-set";

/**
 * The "From my games" set (docs/puzzles-from-games.md): puzzles found in the user's own games,
 * drawn with `gamePuzzles.next` and played by the same session as the downloaded sets. Its id
 * stands where a database id would (the Puzzles page's set picker, a puzzle's `sourceId`).
 */
export const GAME_PUZZLES_SET_ID = "my-games";
export const GAME_PUZZLES_SET_NAME = "From my games";

/** One kind, as a finished puzzle names it. */
export const GAME_PUZZLE_KIND_LABELS: Record<GamePuzzleKind, string> = {
  mistake: "Your mistake",
  "missed-chance": "Missed chance",
  "opponent-chance": "Opponent's chance",
  tricky: "Tricky position",
  "hard-find": "Hard find"
};

/** The kinds as filters and the Generate puzzles dialog list them. */
export const GAME_PUZZLE_KIND_PLURALS: Record<GamePuzzleKind, string> = {
  mistake: "Your mistakes",
  "missed-chance": "Missed chances",
  "opponent-chance": "Opponent's chances",
  tricky: "Tricky positions",
  "hard-find": "Hard finds"
};

export const GAME_PUZZLE_SOURCE_LABELS: Record<GamePuzzleSource, string> = {
  lichess: "Lichess",
  chesscom: "Chess.com",
  imported: "Imported"
};

/** Maia's rating grid, which difficulties are measured on. */
const GAME_PUZZLE_DIFFICULTY_MIN = 600;
const GAME_PUZZLE_DIFFICULTY_MAX = 2600;
export const GAME_PUZZLE_DIFFICULTY_STEPS: readonly number[] = Array.from(
  { length: (GAME_PUZZLE_DIFFICULTY_MAX - GAME_PUZZLE_DIFFICULTY_MIN) / 100 + 1 },
  (_, index) => GAME_PUZZLE_DIFFICULTY_MIN + index * 100
);

/** A difficulty bound as shown: the top of the grid also takes the puzzles no rating finds ("2600+"). */
export function difficultyBoundLabel(value: number): string {
  return value >= GAME_PUZZLE_DIFFICULTY_MAX ? `${GAME_PUZZLE_DIFFICULTY_MAX}+` : String(value);
}

/**
 * The set's filters from the Puzzles page's draft. The whole grid is no range at all, so puzzles
 * without a difficulty (found without Maia) are drawn too.
 */
export function gamePuzzleFilter(
  draft: Pick<PuzzleDraft, "gameKinds" | "gameSources" | "gameDifficultyMin" | "gameDifficultyMax">
): GamePuzzleFilter {
  const min = Math.max(
    GAME_PUZZLE_DIFFICULTY_MIN,
    Math.min(draft.gameDifficultyMin, draft.gameDifficultyMax)
  );
  const max = Math.min(
    GAME_PUZZLE_DIFFICULTY_MAX,
    Math.max(draft.gameDifficultyMin, draft.gameDifficultyMax)
  );
  const wholeGrid = min <= GAME_PUZZLE_DIFFICULTY_MIN && max >= GAME_PUZZLE_DIFFICULTY_MAX;
  return {
    kinds: [...draft.gameKinds],
    sources: [...draft.gameSources],
    difficulty: wholeGrid ? null : { min, max }
  };
}

/** Whether the set's filters differ from the defaults (Reset filters shows). */
export function gamePuzzleFiltersChanged(
  draft: Pick<PuzzleDraft, "gameKinds" | "gameSources" | "gameDifficultyMin" | "gameDifficultyMax">
): boolean {
  return (
    draft.gameKinds.length > 0 ||
    draft.gameSources.length > 0 ||
    draft.gameDifficultyMin !== GAME_PUZZLE_DIFFICULTY_MIN ||
    draft.gameDifficultyMax !== GAME_PUZZLE_DIFFICULTY_MAX
  );
}

/** The session config of a "From my games" set (no database; the Lichess filters stay as drafted). */
export function gamePuzzleSetConfig(
  base: PuzzleSessionConfig,
  draft: Parameters<typeof gamePuzzleFilter>[0]
): PuzzleSessionConfig {
  return {
    ...base,
    databaseId: null,
    mode: "my-games",
    difficulty: null,
    games: gamePuzzleFilter(draft)
  };
}

/** Each drawn game puzzle by id, so the puzzle card can say where it came from once it ends. */
const drawn = new Map<string, GamePuzzle>();

/** The game puzzle a session puzzle was made from (null for any other set's puzzle). */
export function gamePuzzleFor(puzzle: Pick<PuzzleSample, "id" | "sourceId">): GamePuzzle | null {
  return puzzle.sourceId === GAME_PUZZLES_SET_ID ? (drawn.get(puzzle.id) ?? null) : null;
}

/**
 * A game puzzle as the puzzle session plays it: the board starts on the puzzle position (after the
 * setup move, as a Lichess puzzle does), the solver's side to move and at the bottom. Null when its
 * setup move can't be played (broken data).
 */
export function gamePuzzleSample(puzzle: GamePuzzle): PuzzleSample | null {
  const initialFen = puzzle.setupMove
    ? fenAfterUci(puzzle.startFen, puzzle.setupMove)
    : puzzle.startFen;
  if (!initialFen || !puzzle.solution.length) return null;
  drawn.set(puzzle.id, puzzle);
  return {
    id: puzzle.id,
    databaseId: GAME_PUZZLES_SET_ID,
    sourceId: GAME_PUZZLES_SET_ID,
    sourceName: GAME_PUZZLES_SET_NAME,
    initialFen,
    fenBefore: puzzle.startFen,
    opponentMove: puzzle.setupMove,
    solutionMoves: [...puzzle.solution],
    rating: null,
    ratingDeviation: null,
    themes: [...puzzle.themes],
    gameUrl: null,
    openingTags: [],
    sideToMove: puzzle.solverSide,
    difficulty: null
  };
}

/**
 * How an attempt at a game puzzle is scheduled: a clean solve is `unaided`; a wrong move `wrong`;
 * the solution shown before any wrong move `reveal`.
 */
export function gamePuzzleOutcome(
  attempt: Pick<DecidedPuzzleAttempt, "outcome" | "wrongMoves" | "solutionViewed">
): GamePuzzleOutcome {
  if (attempt.outcome === "solved") return "unaided";
  return attempt.wrongMoves.length || !attempt.solutionViewed ? "wrong" : "reveal";
}

/** "Players at 1500 find this 34% of the time" (null without Maia's chance). */
export function gamePuzzleChanceLine(
  puzzle: Pick<GamePuzzle, "userChance" | "chanceRating">
): string | null {
  if (puzzle.userChance === null || puzzle.chanceRating === null) return null;
  return `Players at ${puzzle.chanceRating} find this ${Math.round(puzzle.userChance * 100)}% of the time`;
}

/** A puzzle's difficulty as shown: "1400", "2600+", or null without one. */
export function gamePuzzleDifficulty(
  puzzle: Pick<GamePuzzle, "difficulty" | "difficultyCapped">
): string | null {
  if (puzzle.difficultyCapped) return difficultyBoundLabel(GAME_PUZZLE_DIFFICULTY_MAX);
  return puzzle.difficulty === null ? null : String(puzzle.difficulty);
}

/** A PGN Date tag as a date ("2026.10.04" → "Oct 4, 2026"); unknown parts keep it as written. */
export function formatPgnDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(value);
  if (!match) return value.includes("?") ? null : value;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString(
    undefined,
    { dateStyle: "medium" }
  );
}

/**
 * The main-line node of the move played from a game puzzle's position (Open game shows the game
 * there): the move at its ply, preferably the one it records as played; null when the game has none.
 */
export function gamePuzzleNodeId(
  moveTree: readonly MoveNode[],
  puzzle: Pick<GamePuzzle, "ply" | "playedMove">
): string | null {
  const atPly = mainlinePath(moveTree).filter((node) => node.ply === puzzle.ply && node.parentId);
  return (atPly.find((node) => node.uci === puzzle.playedMove) ?? atPly.at(0))?.id ?? null;
}

/** Where a game puzzle was played: "vs Magnus · Oct 4, 2026 · move 23" (unknown parts left out). */
export function gamePuzzleGameLine(puzzle: Pick<GamePuzzle, "game">): string {
  const { opponent, date, moveNumber } = puzzle.game;
  return [opponent ? `vs ${opponent}` : null, formatPgnDate(date), `move ${moveNumber}`]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/** The set's size with its filters: "12 due · 40 puzzles", or why it is empty. */
export function gamePuzzleCountText({ total, due }: { total: number; due: number }): string {
  if (!total) return "No puzzles match these filters";
  return `${due.toLocaleString()} due · ${total.toLocaleString()} ${total === 1 ? "puzzle" : "puzzles"}`;
}

/** The set the Puzzles page draws from: "From my games", a downloaded database, or none. */
export type PuzzleSetChoice<T> = { kind: "games" } | { kind: "database"; database: T } | null;

/**
 * Which set the Puzzles page shows: "From my games" when the draft chose it, or when it is the only
 * set there is (`gameSetAvailable`: it has puzzles, or some are being found); else the draft's
 * database as selectedPuzzleDatabase picks it; null with neither.
 */
export function choosePuzzleSet<T extends Pick<InstalledDatabase, "id" | "sourceId">>(
  databases: readonly T[],
  draftDatabaseId: string,
  gameSetAvailable: boolean
): PuzzleSetChoice<T> {
  const database = selectedPuzzleDatabase(databases, draftDatabaseId);
  if (gameSetAvailable && (draftDatabaseId === GAME_PUZZLES_SET_ID || !database))
    return { kind: "games" };
  return database ? { kind: "database", database } : null;
}
