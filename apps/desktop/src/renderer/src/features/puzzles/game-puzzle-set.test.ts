import { describe, expect, it } from "vitest";
import { createGameFromFen, importPgnText } from "@chaturanga/shared/chess/pgn";
import type { GamePuzzle } from "@chaturanga/shared/types/game-puzzles";
import { DEFAULT_PUZZLE_FILTERS } from "../../stores/puzzle-draft-store";
import {
  choosePuzzleSet,
  formatPgnDate,
  GAME_PUZZLES_SET_ID,
  gamePuzzleChanceLine,
  gamePuzzleCountText,
  gamePuzzleDifficulty,
  gamePuzzleFilter,
  gamePuzzleFiltersChanged,
  gamePuzzleFor,
  gamePuzzleGameLine,
  gamePuzzleNodeId,
  gamePuzzleOutcome,
  gamePuzzleSample
} from "./game-puzzle-set";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

const puzzle: GamePuzzle = {
  id: "gp1",
  gameId: "g1",
  ply: 2,
  kind: "mistake",
  tags: ["tricky"],
  solverSide: "black",
  startFen: START,
  setupMove: "e2e4",
  solution: ["e7e5"],
  playedMove: "f7f6",
  winBefore: 50,
  winAfter: 30,
  difficulty: 1400,
  difficultyCapped: false,
  userChance: 0.342,
  chanceRating: 1500,
  themes: ["opening"],
  progress: {
    stage: 0,
    dueAt: null,
    lapses: 0,
    lastAttemptAt: null,
    lastOutcome: null,
    attempts: 0
  },
  game: { source: "lichess", opponent: "Magnus", date: "2026.10.04", moveNumber: 1 }
};

describe("gamePuzzleSample", () => {
  it("starts the session on the puzzle position, the solver to move and at the bottom", () => {
    const sample = gamePuzzleSample(puzzle);
    expect(sample).toMatchObject({
      id: "gp1",
      sourceId: GAME_PUZZLES_SET_ID,
      initialFen: AFTER_E4,
      fenBefore: START,
      opponentMove: "e2e4",
      solutionMoves: ["e7e5"],
      sideToMove: "black",
      themes: ["opening"],
      // Never a Lichess rating: nothing to rate the solver against.
      rating: null,
      ratingDeviation: null
    });
  });

  it("starts on the start position itself when the puzzle opens the game", () => {
    const first = { ...puzzle, id: "gp2", setupMove: null, solverSide: "white" as const };
    expect(gamePuzzleSample(first)).toMatchObject({ initialFen: START, opponentMove: null });
  });

  it("is null when the setup move can't be played or there is no solution", () => {
    expect(gamePuzzleSample({ ...puzzle, setupMove: "e2e5" })).toBeNull();
    expect(gamePuzzleSample({ ...puzzle, solution: [] })).toBeNull();
  });

  it("keeps the drawn puzzle for its card, and none for another set's puzzle", () => {
    const sample = gamePuzzleSample(puzzle)!;
    expect(gamePuzzleFor(sample)).toBe(puzzle);
    expect(gamePuzzleFor({ ...sample, sourceId: "lichess-puzzles" })).toBeNull();
  });
});

describe("gamePuzzleOutcome", () => {
  const attempt = { wrongMoves: [], solutionViewed: false };
  const wrong = { solutionIndex: 0, fen: "", uci: "a2a3", san: "a3", expectedUci: "e7e5", at: 1 };

  it("schedules a clean solve as unaided, a wrong move as wrong, the solution shown as reveal", () => {
    expect(gamePuzzleOutcome({ ...attempt, outcome: "solved" })).toBe("unaided");
    expect(gamePuzzleOutcome({ ...attempt, outcome: "failed", wrongMoves: [wrong] })).toBe("wrong");
    expect(gamePuzzleOutcome({ ...attempt, outcome: "failed", solutionViewed: true })).toBe(
      "reveal"
    );
  });

  it("counts a wrong move before the solution was shown as wrong", () => {
    expect(
      gamePuzzleOutcome({ outcome: "failed", wrongMoves: [wrong], solutionViewed: true })
    ).toBe("wrong");
  });
});

describe("the set's filters", () => {
  const draft = { ...DEFAULT_PUZZLE_FILTERS };

  it("asks for every difficulty (puzzles without one too) over the whole Maia grid", () => {
    expect(gamePuzzleFilter(draft)).toStrictEqual({ kinds: [], sources: [], difficulty: null });
    expect(gamePuzzleFiltersChanged(draft)).toBe(false);
  });

  it("sends a narrower range, in order, with the kinds and sources chosen", () => {
    const narrowed = {
      ...draft,
      gameKinds: ["mistake" as const],
      gameSources: ["chesscom" as const],
      gameDifficultyMin: 1800,
      gameDifficultyMax: 1200
    };
    expect(gamePuzzleFilter(narrowed)).toStrictEqual({
      kinds: ["mistake"],
      sources: ["chesscom"],
      difficulty: { min: 1200, max: 1800 }
    });
    expect(gamePuzzleFiltersChanged(narrowed)).toBe(true);
  });

  it("keeps 2600 as the top, which takes the 2600+ puzzles too", () => {
    expect(gamePuzzleFilter({ ...draft, gameDifficultyMin: 2000 }).difficulty).toStrictEqual({
      min: 2000,
      max: 2600
    });
  });
});

describe("choosePuzzleSet", () => {
  const lichess = { id: "db1", sourceId: "lichess-puzzles" };

  it("picks From my games when chosen and available, else the draft's database", () => {
    expect(choosePuzzleSet([lichess], GAME_PUZZLES_SET_ID, true)).toStrictEqual({ kind: "games" });
    expect(choosePuzzleSet([lichess], GAME_PUZZLES_SET_ID, false)).toStrictEqual({
      kind: "database",
      database: lichess
    });
    expect(choosePuzzleSet([lichess], "db1", true)).toStrictEqual({
      kind: "database",
      database: lichess
    });
  });

  it("falls back to From my games without a database, and to nothing without either", () => {
    expect(choosePuzzleSet([], "", true)).toStrictEqual({ kind: "games" });
    expect(choosePuzzleSet([], "", false)).toBeNull();
  });
});

describe("what a finished puzzle says", () => {
  it("names the game, its date and the move", () => {
    expect(gamePuzzleGameLine(puzzle)).toMatch(/^vs Magnus · .*2026.* · move 1$/);
    expect(
      gamePuzzleGameLine({ game: { ...puzzle.game, opponent: null, date: "2026.??.??" } })
    ).toBe("move 1");
  });

  it("says how often players at the user's rating find it, when Maia measured it", () => {
    expect(gamePuzzleChanceLine(puzzle)).toBe("Players at 1500 find this 34% of the time");
    expect(gamePuzzleChanceLine({ userChance: null, chanceRating: null })).toBeNull();
  });

  it("shows the difficulty, 2600+ when no rating finds it, nothing without Maia", () => {
    expect(gamePuzzleDifficulty(puzzle)).toBe("1400");
    expect(gamePuzzleDifficulty({ difficulty: null, difficultyCapped: true })).toBe("2600+");
    expect(gamePuzzleDifficulty({ difficulty: null, difficultyCapped: false })).toBeNull();
  });

  it("reads a PGN date, and leaves out one with unknown parts", () => {
    expect(formatPgnDate("2026.10.04")).toContain("2026");
    expect(formatPgnDate("????.??.??")).toBeNull();
    expect(formatPgnDate(null)).toBeNull();
  });
});

describe("gamePuzzleCountText", () => {
  it("says how many match and are due, or that none match", () => {
    expect(gamePuzzleCountText({ total: 40, due: 12 })).toBe("12 due · 40 puzzles");
    expect(gamePuzzleCountText({ total: 1, due: 0 })).toBe("0 due · 1 puzzle");
    expect(gamePuzzleCountText({ total: 0, due: 0 })).toBe("No puzzles match these filters");
  });
});

describe("gamePuzzleNodeId", () => {
  it("finds the main-line move played from the puzzle position", () => {
    const { moveTree } = importPgnText("1. e4 f6 2. d4 g5 *").game;
    const node = moveTree.find((item) => item.id === gamePuzzleNodeId(moveTree, puzzle));
    expect(node).toMatchObject({ ply: 2, uci: "f7f6" });
  });

  it("is null when the game has no such move", () => {
    const { moveTree } = createGameFromFen({ fen: START, source: "pgn-import", headers: {} });
    expect(gamePuzzleNodeId(moveTree, puzzle)).toBeNull();
  });
});
