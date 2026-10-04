import { describe, expect, it } from "vitest";
import { fenAfterUci } from "@chaturanga/shared/chess/position";
import { validatePuzzleProse } from "@chaturanga/shared/llm/puzzle-explanation";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import type { AnalysisLine, EngineConfig, EngineScore } from "@chaturanga/shared/types/engine";
import type { PuzzleWrongMove } from "../../stores/puzzle-store";
import {
  buildPuzzleExplanationPayload,
  explainEngine,
  explainOutcome,
  explainSearchPlan,
  explanationKey,
  puzzleIdentity,
  swingFor,
  type ExplainAnalysis
} from "./puzzle-explanation";

/** Scholar's mate as a Lichess puzzle: White to play 4.Qxf7#. */
const START = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
const puzzle: PuzzleSample = {
  id: "qA0001",
  databaseId: "db",
  sourceId: "lichess-puzzles",
  sourceName: "Lichess puzzles",
  initialFen: START,
  solutionMoves: ["h5f7"],
  rating: 1500,
  themes: ["mate", "mateIn1", "oneMove"],
  openingTags: ["Italian_Game"],
  sideToMove: "white"
};
const wrong: PuzzleWrongMove = {
  solutionIndex: 0,
  fen: START,
  uci: "h5e5",
  san: "Qxe5+",
  expectedUci: "h5f7",
  at: 1
};
const AFTER_WRONG = fenAfterUci(START, "h5e5")!;

function line(multipv: number, pv: string[], scoreWhite: EngineScore): AnalysisLine {
  return { multipv, depth: 20, score: scoreWhite, scoreWhite, pv };
}

const analysis: ExplainAnalysis = {
  engineName: "Stockfish 17",
  start: [
    line(1, ["h5f7"], { type: "mate", value: 1 }),
    line(2, ["h5e2", "f8c5"], { type: "cp", value: 20 })
  ],
  beforeMistake: [line(1, ["h5f7"], { type: "mate", value: 1 })],
  afterMistake: [line(1, ["c6e5", "c4b3"], { type: "cp", value: -650 })]
};
const settings = { reviewPlayerRating: 1320, reviewCommentaryDetail: "concise" as const };

describe("which case is explained", () => {
  it("is nothing while pending, then solved, failed by a move, or failed by opening the solution", () => {
    expect(explainOutcome("pending", wrong)).toBeNull();
    expect(explainOutcome("void", null)).toBeNull();
    expect(explainOutcome("failed", wrong, true)).toBeNull();
    expect(explainOutcome("solved", null)).toBe("solved");
    expect(explainOutcome("failed", wrong)).toBe("failed_wrong_move");
    expect(explainOutcome("failed", null)).toBe("failed_solution_viewed");
  });

  it("caches per puzzle and outcome, and per wrong move", () => {
    expect(explanationKey(puzzle, "solved", null)).toBe('["db","qA0001"]:solved');
    expect(explanationKey(puzzle, "failed_wrong_move", wrong)).toBe(
      '["db","qA0001"]:failed_wrong_move:0:h5e5'
    );
    expect(explanationKey(puzzle, "failed_wrong_move", { ...wrong, uci: "c4f7" })).not.toBe(
      explanationKey(puzzle, "failed_wrong_move", wrong)
    );
    expect(explanationKey(puzzle, "failed_solution_viewed", null)).toBe(
      '["db","qA0001"]:failed_solution_viewed'
    );
  });

  it("tells apart puzzles with the same id in different databases", () => {
    const other = { ...puzzle, databaseId: "db2" };
    expect(puzzleIdentity(other)).not.toBe(puzzleIdentity(puzzle));
    expect(explanationKey(other, "solved", null)).not.toBe(explanationKey(puzzle, "solved", null));
    expect(puzzleIdentity({ databaseId: "a:b", id: "c" })).not.toBe(
      puzzleIdentity({ databaseId: "a", id: "b:c" })
    );
  });
});

describe("explainSearchPlan", () => {
  it("searches the start with the review's lines, and the wrong move's result with one", () => {
    expect(explainSearchPlan(puzzle, null, 3)).toEqual({
      positions: [{ fen: START, multipv: 3 }],
      start: 0,
      beforeMistake: null,
      afterMistake: null
    });
    expect(explainSearchPlan(puzzle, wrong, 9)).toEqual({
      positions: [
        { fen: START, multipv: 5 },
        { fen: AFTER_WRONG, multipv: 1 }
      ],
      start: 0,
      beforeMistake: 0,
      afterMistake: 1
    });
  });

  it("also searches where a later wrong move was played from", () => {
    const later = {
      ...wrong,
      solutionIndex: 2,
      fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
      uci: "d2d4"
    };
    const plan = explainSearchPlan(puzzle, later, 2);
    expect(plan.positions.map((position) => position.multipv)).toEqual([2, 1, 1]);
    expect(plan).toMatchObject({ beforeMistake: 1, afterMistake: 2 });
  });
});

describe("explainEngine", () => {
  const engine = (id: string, extra: Partial<EngineConfig> = {}) =>
    ({ id, name: id, isAvailable: true, isDefault: false, ...extra }) as EngineConfig;
  it("uses the review engine, else the automatic pick, never a human-prediction or missing one", () => {
    const engines = [
      engine("maia", { isHumanPrediction: true, isDefault: true }),
      engine("sf", { isDefault: true }),
      engine("other")
    ];
    expect(explainEngine(engines, null)?.id).toBe("sf");
    expect(explainEngine(engines, "other")?.id).toBe("other");
    expect(explainEngine(engines, "maia")).toBeNull();
    expect(explainEngine(engines, "gone")).toBeNull();
    expect(explainEngine([engine("sf", { isAvailable: false })], "sf")).toBeNull();
  });
});

describe("swingFor", () => {
  it("names how much a wrong move gave away; a win thrown away is decisive", () => {
    expect(swingFor(1000, -650)).toBe("decisive");
    expect(swingFor(400, 220)).toBe("large");
    expect(swingFor(250, 50)).toBe("decisive");
    expect(swingFor(120, 40)).toBe("moderate");
    expect(swingFor(600, 580)).toBe("small");
  });
});

describe("buildPuzzleExplanationPayload", () => {
  it("grounds a wrong move: the solution, the refutation, how much it gave away and the ideas", () => {
    const payload = buildPuzzleExplanationPayload({
      puzzle,
      kind: "failed_wrong_move",
      wrong,
      analysis,
      settings
    });
    expect(payload).toMatchObject({
      player: { rating: 1320 },
      puzzle: {
        fen: START,
        sideToMove: "white",
        moveNumberSan: "4.",
        rating: 1500,
        themes: ["mate", "mate in 1", "one move"],
        opening: "Italian Game",
        solutionSan: ["Qxf7#"]
      },
      outcome: "failed_wrong_move",
      engine: {
        engineName: "Stockfish 17",
        assessment: "white_has_forced_mate",
        bestMoveSan: "Qxf7#",
        alternatives: [{ rank: 2, san: "Qe2", lineSan: ["Qe2", "Bc5"], assessment: "equal" }]
      },
      mistake: {
        moveNumberSan: "4.",
        san: "Qxe5+",
        playedBeforeSan: [],
        solutionSan: "Qxf7#",
        fenAfter: AFTER_WRONG,
        refutationSan: ["Nxe5", "Bb3"],
        assessmentBefore: "white_has_forced_mate",
        assessmentAfter: "black_winning",
        swing: "decisive",
        stillWinning: false
      },
      commentaryDetail: "concise"
    });
    expect(payload?.ideas?.played.san).toBe("Qxe5+");
    expect(payload?.ideas?.best?.san).toBe("Qxf7#");
    expect(payload?.ideas?.reply?.san).toBe("Nxe5");
  });

  it("builds facts the coach validator grounds an answer against", () => {
    const payload = buildPuzzleExplanationPayload({
      puzzle,
      kind: "failed_wrong_move",
      wrong,
      analysis,
      settings
    })!;
    const answer = JSON.stringify({
      headline: "The f7 pawn was the target",
      body: "Qxe5+ wins a pawn with check, but Nxe5 takes your queen. Only the king guarded f7, so Qxf7# was mate."
    });
    expect(validatePuzzleProse(answer, payload)).toMatchObject({ ok: true });
  });

  it("explains a solved puzzle from the start position, with no mistake", () => {
    const payload = buildPuzzleExplanationPayload({
      puzzle,
      kind: "solved",
      wrong: null,
      analysis: { ...analysis, beforeMistake: null, afterMistake: null },
      settings
    });
    expect(payload?.outcome).toBe("solved");
    expect(payload?.mistake).toBeUndefined();
    expect(payload?.ideas?.played.san).toBe("Qxf7#");
    expect(payload?.ideas?.best).toBeUndefined();
  });

  it("names the moves played before a later mistake, and a still-winning one", () => {
    const longer: PuzzleSample = {
      ...puzzle,
      initialFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      solutionMoves: ["e2e4", "e7e5", "g1f3"],
      sideToMove: "white"
    };
    const fen = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    const later: PuzzleWrongMove = {
      solutionIndex: 2,
      fen,
      uci: "d2d4",
      san: "d4",
      expectedUci: "g1f3",
      at: 1
    };
    const payload = buildPuzzleExplanationPayload({
      puzzle: longer,
      kind: "failed_wrong_move",
      wrong: later,
      analysis: {
        engineName: "SF",
        start: [line(1, ["e2e4", "e7e5"], { type: "cp", value: 30 })],
        beforeMistake: [line(1, ["g1f3"], { type: "cp", value: 400 })],
        afterMistake: [line(1, ["e5d4"], { type: "cp", value: 300 })]
      },
      settings
    });
    expect(payload?.mistake).toMatchObject({
      moveNumberSan: "2.",
      playedBeforeSan: ["e4", "e5"],
      solutionSan: "Nf3",
      swing: "moderate",
      stillWinning: true
    });
  });

  describe("a wrong move that ends the game", () => {
    /** White mates with Qc8#; Qh8# mates too, and Qc7 stalemates. */
    const MATE_START = "k7/8/1K6/8/8/2Q5/8/8 w - - 0 1";
    const mating: PuzzleSample = {
      ...puzzle,
      initialFen: MATE_START,
      solutionMoves: ["c3c8"],
      themes: ["mateIn1"],
      openingTags: []
    };
    const ended = (uci: string): PuzzleWrongMove => ({
      solutionIndex: 0,
      fen: MATE_START,
      uci,
      san: uci,
      expectedUci: "c3c8",
      at: 1
    });
    const mateAnalysis: ExplainAnalysis = {
      engineName: "SF",
      start: [line(1, ["c3c8"], { type: "mate", value: 1 })],
      beforeMistake: [line(1, ["c3c8"], { type: "mate", value: 1 })],
      afterMistake: []
    };

    it("calls another mate a mate, with no refutation and nothing given away", () => {
      const payload = buildPuzzleExplanationPayload({
        puzzle: mating,
        kind: "failed_wrong_move",
        wrong: ended("c3h8"),
        analysis: mateAnalysis,
        settings
      });
      expect(payload?.mistake).toMatchObject({
        san: "Qh8#",
        solutionSan: "Qc8#",
        ends: "checkmate",
        refutationSan: [],
        assessmentAfter: "white_won"
      });
      expect(payload?.mistake?.swing).toBeUndefined();
      expect(payload?.mistake?.stillWinning).toBeUndefined();
      expect(payload?.ideas?.reply).toBeUndefined();
    });

    it("says a stalemate throws the win away, with no reply to it", () => {
      const payload = buildPuzzleExplanationPayload({
        puzzle: mating,
        kind: "failed_wrong_move",
        wrong: ended("c3c7"),
        analysis: mateAnalysis,
        settings
      });
      expect(payload?.mistake).toMatchObject({
        san: "Qc7",
        ends: "stalemate",
        refutationSan: [],
        assessmentAfter: "draw",
        swing: "decisive",
        stillWinning: false
      });
      expect(payload?.ideas?.reply).toBeUndefined();
    });
  });

  it("is null when the engine had nothing for the start, or the solution doesn't replay", () => {
    expect(
      buildPuzzleExplanationPayload({
        puzzle,
        kind: "solved",
        wrong: null,
        analysis: { ...analysis, start: [] },
        settings
      })
    ).toBeNull();
    expect(
      buildPuzzleExplanationPayload({
        puzzle: { ...puzzle, solutionMoves: ["a1a8"] },
        kind: "solved",
        wrong: null,
        analysis,
        settings
      })
    ).toBeNull();
  });
});
