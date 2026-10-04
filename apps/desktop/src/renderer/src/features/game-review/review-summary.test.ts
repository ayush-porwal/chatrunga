import { describe, expect, it } from "vitest";
import type {
  AnalysisLine,
  EngineScore,
  MoveAnnotation,
  MoveReview
} from "@chaturanga/shared/types/engine";
import { fenAfterUci } from "@chaturanga/shared/chess/position";
import {
  errorTheme,
  lichessOpeningTags,
  movesAccuracy,
  openingBookLine,
  phaseAccuracy,
  practiceChips,
  scoreboardRows,
  sideAccuracy
} from "./review-summary";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

function line(pv: string[], score: EngineScore): AnalysisLine {
  return { multipv: 1, depth: 20, score, scoreWhite: score, pv };
}

function move(
  ply: number,
  overrides: Partial<MoveReview> & { annotation?: MoveAnnotation | null } = {}
): MoveReview {
  const { annotation = null, ...rest } = overrides;
  return {
    nodeId: `n${ply}`,
    ply,
    san: "e4",
    playedMove: "e2e4",
    fenBefore: ply % 2 === 1 ? START : BLACK_TO_MOVE,
    fenAfter: START,
    evalBefore: null,
    evalAfter: null,
    evalLoss: 0,
    bestMove: null,
    bestLine: [],
    topLines: [],
    motifs: [],
    assessment: {
      policy: 2,
      winBefore: null,
      winAfter: null,
      winLoss: null,
      alternativeGap: null,
      severity: null,
      annotation,
      tags: []
    },
    ...rest
  };
}

/** An error: `uci` played from `fenBefore`, the opponent's best reply `reply`. */
function error(fenBefore: string, uci: string, reply: string, score: EngineScore = cp(300)) {
  const fenAfter = fenAfterUci(fenBefore, uci);
  if (!fenAfter) throw new Error(`illegal ${uci}`);
  return move(1, {
    annotation: "blunder",
    fenBefore,
    fenAfter,
    playedMove: uci,
    replyLines: [line([reply], score)]
  });
}

function cp(value: number): EngineScore {
  return { type: "cp", value };
}

describe("scoreboardRows", () => {
  it("counts each side's marks, best to worst, listing only the marks the game has", () => {
    const moves = [
      move(1, { annotation: "book" }),
      move(2, { annotation: "book" }),
      move(3, { annotation: "blunder" }),
      move(4, { annotation: "great" }),
      move(5, { annotation: "blunder" }),
      move(6, { annotation: "inaccuracy" }),
      move(7)
    ];
    expect(scoreboardRows(moves)).toEqual([
      { annotation: "book", white: 1, black: 1 },
      { annotation: "great", white: 0, black: 1 },
      { annotation: "inaccuracy", white: 0, black: 1 },
      { annotation: "blunder", white: 2, black: 0 }
    ]);
  });

  it("counts by the side to move, so a game set up with Black to move counts right", () => {
    const blackFirst = move(1, { annotation: "mistake", fenBefore: BLACK_TO_MOVE });
    expect(scoreboardRows([blackFirst])).toEqual([{ annotation: "mistake", white: 0, black: 1 }]);
  });
});

describe("accuracy", () => {
  it("is 100 − the average loss ÷ 8, to one decimal, per side", () => {
    const moves = [
      move(1, { evalLoss: 10 }),
      move(2, { evalLoss: 80 }),
      move(3, { evalLoss: 30 }),
      move(4, { evalLoss: null })
    ];
    expect(sideAccuracy(moves, "white")).toBe(97.5);
    expect(sideAccuracy(moves, "black")).toBe(90);
    expect(movesAccuracy([move(1, { evalLoss: 2000 })])).toBe(0);
    expect(movesAccuracy([move(1, { evalLoss: null })])).toBeNull();
  });

  it("by phase uses the shared split and leaves out a phase the game never reached", () => {
    const moves = [1, 2, 3, 4, 5, 6].map((ply) => move(ply, { evalLoss: ply * 16 }));
    // Opening to ply 2, endgame from ply 5.
    expect(phaseAccuracy(moves, { openingEnd: 2, endgameStart: 5 })).toEqual([
      { phase: "opening", white: 98, black: 96 },
      { phase: "middlegame", white: 94, black: 92 },
      { phase: "endgame", white: 90, black: 88 }
    ]);
    expect(phaseAccuracy(moves, { openingEnd: 0, endgameStart: null })).toEqual([
      { phase: "middlegame", white: 94, black: 92 }
    ]);
    // An endgame the split found is listed even when no reviewed move fell in it.
    expect(phaseAccuracy(moves.slice(0, 4), { openingEnd: 2, endgameStart: 9 })).toEqual([
      { phase: "opening", white: 98, black: 96 },
      { phase: "middlegame", white: 94, black: 92 },
      { phase: "endgame", white: null, black: null }
    ]);
  });
});

describe("the opening", () => {
  it("says where the book ended and the move that left it", () => {
    const opening = {
      eco: "A28",
      name: "English Opening: Four Knights System",
      ply: 6,
      bookEndPly: 6,
      firstNonBookMove: { ply: 7, san: "g3" }
    };
    expect(openingBookLine(opening)).toBe("Book until move 3 · left theory with 4. g3");
    expect(openingBookLine({ ...opening, bookEndPly: 7, firstNonBookMove: null })).toBe(
      "Book until move 4"
    );
    expect(
      openingBookLine({ ...opening, bookEndPly: 5, firstNonBookMove: { ply: 6, san: "Nf6" } })
    ).toBe("Book until move 3 · left theory with 3… Nf6");
  });

  it("maps its name to Lichess puzzle OpeningTags: the family and the variation", () => {
    expect(lichessOpeningTags("Sicilian Defense: Najdorf Variation, English Attack")).toEqual({
      family: "Sicilian_Defense",
      variation: "Sicilian_Defense_Najdorf_Variation"
    });
    expect(lichessOpeningTags("King's Gambit Accepted: Fischer Defense")).toEqual({
      family: "Kings_Gambit_Accepted",
      variation: "Kings_Gambit_Accepted_Fischer_Defense"
    });
    expect(lichessOpeningTags("Grünfeld Defense")).toEqual({
      family: "Grunfeld_Defense",
      variation: null
    });
    expect(lichessOpeningTags("Caro-Kann Defense: Advance Variation").variation).toBe(
      "Caro-Kann_Defense_Advance_Variation"
    );
  });
});

describe("practice themes", () => {
  it("finds the fork the opponent's best reply makes", () => {
    // Kd1-e1?? lets the knight fork king and rook from c2.
    expect(errorTheme(error("7k/8/8/8/1n6/8/8/R2K4 w - - 0 1", "d1e1", "b4c2"))).toBe("fork");
  });

  it("finds a piece the error left hanging, when the reply takes it", () => {
    // Qd1-d5?? hangs the queen to the rook.
    expect(errorTheme(error("3r3k/8/8/8/8/8/8/3QK3 w - - 0 1", "d1d5", "d8d5"))).toBe(
      "hangingPiece"
    );
    // The reply goes elsewhere: nothing certain to practise.
    expect(errorTheme(error("3r3k/8/8/8/8/8/8/3QK3 w - - 0 1", "d1d5", "h8g8"))).toBeNull();
  });

  it("names a forced mate by its length", () => {
    const mate = (value: number) =>
      errorTheme(error(START, "f2f3", "e7e5", { type: "mate", value }));
    expect(mate(2)).toBe("mateIn2");
    expect(mate(7)).toBe("mate");
    // A mate for the side that erred is no theme it gave away.
    expect(mate(-3)).toBeNull();
  });

  it("is nothing without a reply line", () => {
    expect(errorTheme(move(1, { annotation: "blunder" }))).toBeNull();
  });

  it("counts the reviewed side's errors per theme, most frequent first", () => {
    const fork = error("7k/8/8/8/1n6/8/8/R2K4 w - - 0 1", "d1e1", "b4c2");
    const hanging = error("3r3k/8/8/8/8/8/8/3QK3 w - - 0 1", "d1d5", "d8d5");
    const moves = [
      fork,
      { ...hanging, nodeId: "h1" },
      { ...hanging, nodeId: "h2" },
      // A success, and the opponent's error: neither counts.
      { ...fork, assessment: { ...fork.assessment!, annotation: "great" as const } }
    ];
    expect(practiceChips(moves, "white")).toEqual([
      { theme: "hangingPiece", label: "Hanging piece", count: 2 },
      { theme: "fork", label: "Fork", count: 1 }
    ]);
    expect(practiceChips(moves, "black")).toEqual([]);
  });
});
