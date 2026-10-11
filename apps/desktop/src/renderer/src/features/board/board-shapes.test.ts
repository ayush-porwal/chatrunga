import { describe, expect, it } from "vitest";
import type { DrawShape } from "@lichess-org/chessground/draw";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { MoveAssessment, MoveReview } from "@chaturanga/shared/types/engine";
import {
  annotationsFromShapes,
  chessgroundMovableColor,
  liveAnalysisShapes,
  movableDests,
  reviewMoveShapes,
  shapesFromAnnotations,
  sideToMoveIsMovable
} from "./board-shapes";

const BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

describe("shapesFromAnnotations", () => {
  it("turns arrows and highlights into Chessground shapes with the colour as brush", () => {
    expect(
      shapesFromAnnotations(
        [{ orig: "e2", dest: "e4", color: "green" }],
        [{ square: "d5", color: "red" }]
      )
    ).toStrictEqual([
      { orig: "e2", dest: "e4", brush: "green" },
      { orig: "d5", brush: "red" }
    ]);
  });
});

describe("annotationsFromShapes", () => {
  it("splits shapes into arrows and highlights", () => {
    const shapes: DrawShape[] = [
      { orig: "g1", dest: "f3", brush: "blue" },
      { orig: "e5", brush: "yellow" }
    ];
    expect(annotationsFromShapes(shapes)).toStrictEqual({
      arrows: [{ orig: "g1", dest: "f3", color: "blue" }],
      highlights: [{ square: "e5", color: "yellow" }]
    });
  });

  it("falls back to green for unknown brushes and drops off-board squares", () => {
    const shapes: DrawShape[] = [
      { orig: "a1", dest: "a2", brush: "paleGreen" },
      { orig: "a0", brush: "red" },
      { orig: "b1", dest: "a0", brush: "red" },
      { orig: "c3" }
    ];
    expect(annotationsFromShapes(shapes)).toStrictEqual({
      arrows: [{ orig: "a1", dest: "a2", color: "green" }],
      highlights: [{ square: "c3", color: "green" }]
    });
  });

  it("round-trips stored annotations", () => {
    const arrows = [{ orig: "e2", dest: "e4", color: "red" }] as const;
    const highlights = [{ square: "h7", color: "blue" }] as const;
    expect(annotationsFromShapes(shapesFromAnnotations(arrows, highlights))).toStrictEqual({
      arrows,
      highlights
    });
  });
});

describe("movableDests", () => {
  it("offers every legal move when the side to move may move", () => {
    const dests = movableDests(START_FEN, "white");
    expect(dests.get("e2")).toStrictEqual(["e3", "e4"]);
    expect(dests.size).toBe(10);
    expect(movableDests(BLACK_TO_MOVE, "black").get("g8")).toStrictEqual(["f6", "h6"]);
    expect(movableDests(START_FEN, "both").size).toBe(10);
  });

  it("offers nothing to the side not to move, a view-only board or an unreadable FEN", () => {
    expect(movableDests(START_FEN, "black").size).toBe(0);
    expect(movableDests(BLACK_TO_MOVE, "white").size).toBe(0);
    expect(movableDests(START_FEN, "none").size).toBe(0);
    expect(movableDests("not a fen", "both").size).toBe(0);
  });
});

describe("sideToMoveIsMovable", () => {
  it("follows the side to move", () => {
    expect(sideToMoveIsMovable(START_FEN, "white")).toBe(true);
    expect(sideToMoveIsMovable(START_FEN, "black")).toBe(false);
    expect(sideToMoveIsMovable(BLACK_TO_MOVE, "both")).toBe(true);
    expect(sideToMoveIsMovable(BLACK_TO_MOVE, "none")).toBe(false);
    expect(sideToMoveIsMovable("garbage", "white")).toBe(false);
  });
});

describe("chessgroundMovableColor", () => {
  it("maps none to nobody and passes the rest through", () => {
    expect(chessgroundMovableColor("none")).toBeUndefined();
    expect(chessgroundMovableColor("both")).toBe("both");
    expect(chessgroundMovableColor("black")).toBe("black");
  });
});

describe("liveAnalysisShapes", () => {
  const RUY = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"];
  const white = { bestMoveArrow: true, planArrows: 0 } as const;
  const arrows = (shapes: DrawShape[]) =>
    shapes.map(({ orig, dest, brush }) => `${orig}${dest}:${brush}`);

  it("draws the single best-move arrow with plan arrows off, and nothing with it off too", () => {
    expect(liveAnalysisShapes(START_FEN, RUY, white)).toStrictEqual([
      { orig: "e2", dest: "e4", brush: "blue" }
    ]);
    expect(liveAnalysisShapes(START_FEN, RUY, { ...white, bestMoveArrow: false })).toStrictEqual(
      []
    );
  });

  it("draws that many moves of the line, numbered, in the default arrow colour", () => {
    const shapes = liveAnalysisShapes(START_FEN, RUY, { ...white, planArrows: 3 });
    expect(arrows(shapes)).toStrictEqual(["e2e4:blue", "e7e5:blue", "g1f3:blue"]);
    expect(shapes.map((shape) => shape.label?.text)).toStrictEqual(["1", "2", "3"]);
    // Engine arrows off hides them too: the plan count only says which arrows show.
    expect(
      liveAnalysisShapes(START_FEN, RUY, { ...white, planArrows: 2, bestMoveArrow: false })
    ).toStrictEqual([]);
  });

  it("starts with Black's move when Black is to move, and draws castling and at most four moves", () => {
    const line = ["e7e5", "g1f3", "b8c6", "f1c4", "g8f6"];
    expect(
      arrows(liveAnalysisShapes(BLACK_TO_MOVE, line, { ...white, planArrows: 4 }))
    ).toStrictEqual(["e7e5:blue", "g1f3:blue", "b8c6:blue", "f1c4:blue"]);
    const castles = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
    expect(
      arrows(liveAnalysisShapes(castles, ["e1g1", "g8f6"], { ...white, planArrows: 9 }))
    ).toStrictEqual(["e1g1:blue", "g8f6:blue"]);
  });

  it("stops at the first move that isn't legal in turn (a line of another position)", () => {
    const plan = { ...white, planArrows: 4 };
    expect(arrows(liveAnalysisShapes(START_FEN, ["e2e4", "e2e4", "g1f3"], plan))).toStrictEqual([
      "e2e4:blue"
    ]);
    expect(liveAnalysisShapes(START_FEN, ["e7e5", "g1f3"], plan)).toStrictEqual([]);
    expect(liveAnalysisShapes(START_FEN, ["e7e5"], white)).toStrictEqual([]);
    expect(liveAnalysisShapes(START_FEN, ["zz"], plan)).toStrictEqual([]);
    expect(liveAnalysisShapes("not a fen", RUY, plan)).toStrictEqual([]);
  });
});

describe("reviewMoveShapes", () => {
  // 1. e4 e5 2. Nf3 Nc6, White to move: the review's best line is 3. Bb5 a6 4. Ba4 Nf6.
  const RUY = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
  const ERROR: MoveAssessment = {
    policy: 1,
    winBefore: 55,
    winAfter: 40,
    winLoss: 15,
    alternativeGap: -15,
    severity: "mistake",
    annotation: "mistake",
    tags: []
  };
  const move = (overrides: Partial<MoveReview> = {}): MoveReview => ({
    nodeId: "n5",
    ply: 5,
    san: "Bc4",
    playedMove: "f1c4",
    fenBefore: RUY,
    fenAfter: RUY,
    evalBefore: null,
    evalAfter: null,
    evalLoss: null,
    bestMove: "f1b5",
    bestLine: ["f1b5", "a7a6", "b5a4", "g8f6"],
    topLines: [],
    motifs: [],
    ...overrides
  });
  const bestOnly = { bestMoveArrow: true, planArrows: 0 } as const;
  const arrows = (shapes: DrawShape[]) =>
    shapes.map(({ orig, dest, brush, label }) =>
      [`${orig}${dest ?? ""}:${brush}`, label?.text].filter(Boolean).join(":")
    );

  it("draws the best move green and the played move blue, or red when it cost something", () => {
    expect(arrows(reviewMoveShapes(move(), bestOnly))).toStrictEqual(["f1b5:green", "f1c4:blue"]);
    expect(arrows(reviewMoveShapes(move({ assessment: ERROR }), bestOnly))).toStrictEqual([
      "f1b5:green",
      "f1c4:red"
    ]);
  });

  it("leaves out the played arrow only when it was the best move itself", () => {
    expect(arrows(reviewMoveShapes(move({ playedMove: "f1b5" }), bestOnly))).toStrictEqual([
      "f1b5:green"
    ]);
    // Same piece, another square (it used to be dropped for sharing the best move's square).
    expect(arrows(reviewMoveShapes(move({ playedMove: "f1e2" }), bestOnly))).toStrictEqual([
      "f1b5:green",
      "f1e2:blue"
    ]);
  });

  it("draws that many moves of the best line numbered in blue, in place of the best-move arrow", () => {
    expect(
      arrows(reviewMoveShapes(move({ assessment: ERROR }), { ...bestOnly, planArrows: 3 }))
    ).toStrictEqual(["f1b5:blue:1", "a7a6:blue:2", "b5a4:blue:3", "f1c4:red"]);
  });

  it("keeps only the played arrow with engine arrows off, whatever the plan count", () => {
    expect(arrows(reviewMoveShapes(move(), { bestMoveArrow: false, planArrows: 4 }))).toStrictEqual(
      ["f1c4:blue"]
    );
  });

  it("numbers the best move alone without a stored line, and falls back to it for a line of another position", () => {
    const plan = { ...bestOnly, planArrows: 2 };
    expect(arrows(reviewMoveShapes(move({ bestLine: [] }), plan))).toStrictEqual([
      "f1b5:blue:1",
      "f1c4:blue"
    ]);
    expect(arrows(reviewMoveShapes(move({ bestLine: ["e7e5", "g1f3"] }), plan))).toStrictEqual([
      "f1b5:green",
      "f1c4:blue"
    ]);
  });

  it("draws the best and played arrows pale on request, and the plan's numbers in the live blue", () => {
    const error = move({ assessment: ERROR });
    expect(arrows(reviewMoveShapes(error, { ...bestOnly, pale: true }))).toStrictEqual([
      "f1b5:paleGreen",
      "f1c4:paleRed"
    ]);
    expect(
      arrows(reviewMoveShapes(move(), { ...bestOnly, planArrows: 2, pale: true }))
    ).toStrictEqual(["f1b5:blue:1", "a7a6:blue:2", "f1c4:paleBlue"]);
  });

  it("draws nothing without a reviewed move, and no engine arrow without a best move", () => {
    expect(reviewMoveShapes(null, bestOnly)).toStrictEqual([]);
    expect(
      arrows(
        reviewMoveShapes(move({ bestMove: null, bestLine: [] }), { ...bestOnly, planArrows: 3 })
      )
    ).toStrictEqual(["f1c4:blue"]);
  });
});
