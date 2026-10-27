/**
 * Puzzles from the user's own games (docs/puzzles-from-games.md): a background queue in main
 * finds them with Stockfish and Maia 3 (chess/puzzle-generator.ts), and Puzzles trains them with
 * spaced repetition as the "From my games" set. These are the shapes the renderer sees over IPC.
 *
 * Times are epoch milliseconds (UTC). Win-% values are the mover's winning chances (0–100,
 * `winPercent` in chess/move-assessment.ts).
 */
import type { PracticeOutcome } from "../chess/repertoire-scheduler";
import type { Color } from "./chess";
import { RATING_MODES, type RatingMode } from "./ratings";

/**
 * The puzzle kinds, highest priority first (one puzzle per position: the first kind that makes a
 * puzzle wins, the lower ones that also applied become its tags).
 * - `mistake`: the user's move lost 10+ win-%; the puzzle is the move they should have played;
 * - `missed-chance`: the opponent's move handed the user a win (+2 pawns or a mate) and the user's
 *   move let it go;
 * - `opponent-chance`: the same two from the opponent's side (their mistake, or the chance the
 *   user gave them), solved as the opponent;
 * - `tricky`: most of Maia's weight at the user's rating goes to moves that lose 10+ win-%;
 * - `hard-find`: the user found the best move although Maia gives it under 10% at their rating.
 */
export const GAME_PUZZLE_KINDS = [
  "mistake",
  "missed-chance",
  "opponent-chance",
  "tricky",
  "hard-find"
] as const;
export type GamePuzzleKind = (typeof GAME_PUZZLE_KINDS)[number];

/** The kinds that read Maia 3's predictions (the dialog disables them while it isn't installed). */
export const MAIA_PUZZLE_KINDS: readonly GamePuzzleKind[] = ["tricky", "hard-find"];

/**
 * Where a game came from, as "My games" groups them: synced from Lichess or Chess.com, or
 * imported from a PGN (`GameSource` "pgn-import").
 */
export const GAME_PUZZLE_SOURCES = ["lichess", "chesscom", "imported"] as const;
export type GamePuzzleSource = (typeof GAME_PUZZLE_SOURCES)[number];

/** The engine depths of one generation: the quick scan of every position, and the deep check. */
export type GamePuzzleDepths = { scan: number; verify: number };

export const GAME_PUZZLE_DEPTH_PRESETS = ["quick", "standard", "deep"] as const;
export type GamePuzzleDepthPreset = (typeof GAME_PUZZLE_DEPTH_PRESETS)[number];

/** The depths each preset searches at (the dialog names them). */
export const GAME_PUZZLE_DEPTHS: Readonly<Record<GamePuzzleDepthPreset, GamePuzzleDepths>> = {
  quick: { scan: 10, verify: 16 },
  standard: { scan: 12, verify: 20 },
  deep: { scan: 14, verify: 24 }
};

/** How many games a generation takes (newest first); `null` in the settings is every game. */
export const GAME_PUZZLE_GAME_LIMITS = [25, 50, 100] as const;

/** The Generate puzzles dialog's choices (also the review hook's kinds and depth: the last used). */
export type GamePuzzleSettings = {
  sources: GamePuzzleSource[];
  /** The game's mode (chess/review-rating.ts `gameRatingMode`). */
  timeControls: RatingMode[];
  /** One of GAME_PUZZLE_GAME_LIMITS, newest games first; null: every matching game. */
  limit: number | null;
  /** Leave out games already processed (done, failed or skipped). */
  skipProcessed: boolean;
  kinds: GamePuzzleKind[];
  depth: GamePuzzleDepthPreset;
};

/** The dialog's settings before it was ever used. */
export const DEFAULT_GAME_PUZZLE_SETTINGS: Readonly<GamePuzzleSettings> = {
  sources: [...GAME_PUZZLE_SOURCES],
  timeControls: [...RATING_MODES],
  limit: 50,
  skipProcessed: true,
  kinds: [...GAME_PUZZLE_KINDS],
  depth: "standard"
};

/* ------------------------------------------------------------------ the queue */

/**
 * A queued game's state: `skipped` has no user side (neither player is a connected account) or
 * nothing to search; `failed` keeps its error and the queue moves on.
 */
export type GamePuzzleGameStatus = "queued" | "running" | "done" | "failed" | "skipped";

/** Who queued the game: the Generate puzzles dialog, or a finished game review (the review hook). */
export type GamePuzzleQueueSource = "dialog" | "review";

/**
 * A generation's steps: `scan` reads every position at the scan depth, `find` picks the candidates
 * (Tricky positions search Maia's likeliest moves), `check` verifies each candidate and builds its
 * solution at the verify depth.
 */
export type GamePuzzleGenerationPhase = "scan" | "find" | "check";

/** Progress through one game: positions (scan, find) or candidates (check) done of total. */
export type GamePuzzleGameProgress = {
  phase: GamePuzzleGenerationPhase;
  done: number;
  total: number;
};

/** The game the queue is working on. */
export type GamePuzzleCurrentGame = {
  gameId: string;
  white: string | null;
  black: string | null;
  /** The PGN Date tag ("2026.10.04"), when the game has one. */
  date: string | null;
  source: GamePuzzleQueueSource;
  /** Null until its first search. */
  progress: GamePuzzleGameProgress | null;
};

export type GamePuzzleQueueStatus = {
  /** Paused by the user (kept across restarts): nothing runs until resumed. */
  paused: boolean;
  /** Waiting while the user uses an engine elsewhere (a review, live analysis, a game, …). */
  waitingForEngine: boolean;
  /** Games of the queue since it was last empty: finished (done, failed or skipped) and in all. */
  done: number;
  total: number;
  current: GamePuzzleCurrentGame | null;
};

/** How a queued game ended. */
export type GamePuzzleGameResult = {
  gameId: string;
  status: Extract<GamePuzzleGameStatus, "done" | "failed" | "skipped">;
  puzzlesFound: number;
  /** Why it failed (null otherwise). */
  error: string | null;
};

/** `gamePuzzles.onGenerationProgress`: the queue's state, and the game that just finished (if any). */
export type GamePuzzleGenerationEvent = {
  status: GamePuzzleQueueStatus;
  finished: GamePuzzleGameResult | null;
};

/* ------------------------------------------------------------------ the "My games" card */

export type GamePuzzleSourceSummary = {
  games: number;
  /** Games with a user side (a player name matches a connected account). */
  eligible: number;
  /** Games the queue has finished (done, failed or skipped). */
  processed: number;
  /** Puzzles found in this source's games. */
  puzzles: number;
};

/**
 * Whether the queue can search: `ready` (the default engine is a custom UCI engine), `missing` (no
 * default engine) or `lc0` (the default is Lc0, which the queue skips; the dialog says so).
 */
export type GamePuzzleEngineState = "ready" | "missing" | "lc0";

export type GamePuzzleSummary = {
  sources: Record<GamePuzzleSource, GamePuzzleSourceSummary>;
  puzzles: number;
  /** Puzzles due now (new ones are due at once). */
  due: number;
  engine: GamePuzzleEngineState;
  /** Maia 3 is installed (Tricky positions and Hard finds, and the puzzles' difficulty, need it). */
  maiaInstalled: boolean;
};

/** How many games the dialog's settings would queue. */
export type GamePuzzleGameCount = {
  /** Games that would be queued (with a user side; `limit` applied). */
  eligible: number;
  /** Matching games neither of whose players is a connected account (counted, never queued). */
  withoutUserSide: number;
};

/* ------------------------------------------------------------------ puzzles */

/**
 * A puzzle as the generator finds it and the database stores it. The puzzle position is the one
 * before the game's move at `ply`; the board starts one move earlier (`startFen`) and plays
 * `setupMove` into it, as Lichess puzzles do.
 */
export type GamePuzzleContent = {
  /** The game ply of the move played from the puzzle position (an odd ply is White's move). */
  ply: number;
  kind: GamePuzzleKind;
  /** Lower-priority kinds that also applied to the position, in priority order. */
  tags: GamePuzzleKind[];
  /** The side that solves it: the mover in the game (the opponent for Opponent's chance). */
  solverSide: Color;
  /** The position before `setupMove`, or the puzzle position itself when it starts the game. */
  startFen: string;
  /** The move into the puzzle position (UCI); null when the puzzle position starts the game. */
  setupMove: string | null;
  /** UCI moves from the puzzle position: the solver's first, then alternating; ends on the solver's. */
  solution: string[];
  /** The move played in the game from the puzzle position (UCI). */
  playedMove: string;
  /** The solver's win-% with best play before the played move, and after it. */
  winBefore: number;
  winAfter: number;
  /**
   * The lowest Maia rating (600–2600) at which players find the whole solution at least half the
   * time; null when they never do (`difficultyCapped`, shown as 2600+) or without Maia.
   */
  difficulty: number | null;
  difficultyCapped: boolean;
  /** How often players at `chanceRating` (the user's, on Maia's grid) find it, 0–1; null without Maia. */
  userChance: number | null;
  chanceRating: number | null;
  /** Lichess theme names found on the solution (`fork`, `pin`, `skewer`, `mate`, `mateIn2`, …). */
  themes: string[];
};

/** How an attempt ends for the scheduler: clean solve, a wrong move, or the solution shown. */
export type GamePuzzleOutcome = Extract<PracticeOutcome, "unaided" | "wrong" | "reveal">;
export const GAME_PUZZLE_OUTCOMES: readonly GamePuzzleOutcome[] = ["unaided", "wrong", "reveal"];

/** A puzzle's spaced-repetition state (chess/repertoire-scheduler.ts). */
export type GamePuzzleProgress = {
  /** 0 (new or lapsed) to 6. */
  stage: number;
  /** Null: never attempted (due at once). */
  dueAt: number | null;
  lapses: number;
  lastAttemptAt: number | null;
  lastOutcome: GamePuzzleOutcome | null;
  attempts: number;
};

/** A stored puzzle with what the session shows once it ends. */
export type GamePuzzle = GamePuzzleContent & {
  id: string;
  gameId: string;
  progress: GamePuzzleProgress;
  game: {
    source: GamePuzzleSource;
    /** The user's opponent in the game (the PGN name), when known. */
    opponent: string | null;
    /** The PGN Date tag, when the game has one. */
    date: string | null;
    /** The move number of the played move (`ceil(ply / 2)`). */
    moveNumber: number;
  };
};

/** The "From my games" set's filters; an omitted or empty list allows every value. */
export type GamePuzzleFilter = {
  kinds?: GamePuzzleKind[];
  /**
   * Difficulty (Maia rating) range, inclusive. A maximum of 2600 also takes 2600+ puzzles; with a
   * range, puzzles without a difficulty are left out.
   */
  difficulty?: { min: number; max: number } | null;
  sources?: GamePuzzleSource[];
};

/** The set's queue order: due puzzles (oldest due first), then new ones (newest game first). */
export type GamePuzzleQuery = GamePuzzleFilter & {
  /** Puzzles already shown in this session. */
  excludeIds?: string[];
  /** At most this many puzzles (`list`). */
  limit?: number;
};

export type GamePuzzleList = {
  puzzles: GamePuzzle[];
  /** Puzzles matching the filters, and how many of them are due now. */
  total: number;
  due: number;
};

/** A finished attempt; it schedules the puzzle and never changes the puzzle rating. */
export type GamePuzzleAttemptInput = {
  puzzleId: string;
  outcome: GamePuzzleOutcome;
};
