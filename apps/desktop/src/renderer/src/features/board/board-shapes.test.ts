import { describe, expect, it } from "vitest";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import { START_FEN } from "@chaturanga/shared/chess/position";
import {
  annotationsFromShapes,
  chessgroundMovableColor,
  liveAnalysisShapes,
  movableDests,
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
    ).toEqual([
      { orig: "e2", dest: "e4", brush: "green" },
      { orig: "d5", brush: "red" }
    ]);
  });
});

describe("annotationsFromShapes", () => {
  it("splits shapes into arrows and highlights", () => {
    const shapes: DrawShape[] = [
      { orig: "g1" as Key, dest: "f3" as Key, brush: "blue" },
      { orig: "e5" as Key, brush: "yellow" }
    ];
    expect(annotationsFromShapes(shapes)).toEqual({
      arrows: [{ orig: "g1", dest: "f3", color: "blue" }],
      highlights: [{ square: "e5", color: "yellow" }]
    });
  });

  it("falls back to green for unknown brushes and drops off-board squares", () => {
    const shapes: DrawShape[] = [
      { orig: "a1" as Key, dest: "a2" as Key, brush: "paleGreen" },
      { orig: "a0" as Key, brush: "red" },
      { orig: "b1" as Key, dest: "a0" as Key, brush: "red" },
      { orig: "c3" as Key }
    ];
    expect(annotationsFromShapes(shapes)).toEqual({
      arrows: [{ orig: "a1", dest: "a2", color: "green" }],
      highlights: [{ square: "c3", color: "green" }]
    });
  });

  it("round-trips stored annotations", () => {
    const arrows = [{ orig: "e2", dest: "e4", color: "red" }] as const;
    const highlights = [{ square: "h7", color: "blue" }] as const;
    expect(annotationsFromShapes(shapesFromAnnotations(arrows, highlights))).toEqual({
      arrows,
      highlights
    });
  });
});

describe("movableDests", () => {
  it("offers every legal move when the side to move may move", () => {
    const dests = movableDests(START_FEN, "white");
    expect(dests.get("e2" as Key)).toEqual(["e3", "e4"]);
    expect(dests.size).toBe(10);
    expect(movableDests(BLACK_TO_MOVE, "black").get("g8" as Key)).toEqual(["f6", "h6"]);
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
    expect(liveAnalysisShapes(START_FEN, RUY, white)).toEqual([
      { orig: "e2", dest: "e4", brush: "blue" }
    ]);
    expect(liveAnalysisShapes(START_FEN, RUY, { ...white, bestMoveArrow: false })).toEqual([]);
  });

  it("draws that many moves of the line, numbered, in the default arrow colour", () => {
    const shapes = liveAnalysisShapes(START_FEN, RUY, { ...white, planArrows: 3 });
    expect(arrows(shapes)).toEqual(["e2e4:blue", "e7e5:blue", "g1f3:blue"]);
    expect(shapes.map((shape) => shape.label?.text)).toEqual(["1", "2", "3"]);
    // Engine arrows off hides them too: the plan count only says which arrows show.
    expect(
      liveAnalysisShapes(START_FEN, RUY, { ...white, planArrows: 2, bestMoveArrow: false })
    ).toEqual([]);
  });

  it("starts with Black's move when Black is to move, and draws castling and at most four moves", () => {
    const line = ["e7e5", "g1f3", "b8c6", "f1c4", "g8f6"];
    expect(arrows(liveAnalysisShapes(BLACK_TO_MOVE, line, { ...white, planArrows: 4 }))).toEqual([
      "e7e5:blue",
      "g1f3:blue",
      "b8c6:blue",
      "f1c4:blue"
    ]);
    const castles = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
    expect(
      arrows(liveAnalysisShapes(castles, ["e1g1", "g8f6"], { ...white, planArrows: 9 }))
    ).toEqual(["e1g1:blue", "g8f6:blue"]);
  });

  it("stops at the first move that isn't legal in turn (a line of another position)", () => {
    const plan = { ...white, planArrows: 4 };
    expect(arrows(liveAnalysisShapes(START_FEN, ["e2e4", "e2e4", "g1f3"], plan))).toEqual([
      "e2e4:blue"
    ]);
    expect(liveAnalysisShapes(START_FEN, ["e7e5", "g1f3"], plan)).toEqual([]);
    expect(liveAnalysisShapes(START_FEN, ["e7e5"], white)).toEqual([]);
    expect(liveAnalysisShapes(START_FEN, ["zz"], plan)).toEqual([]);
    expect(liveAnalysisShapes("not a fen", RUY, plan)).toEqual([]);
  });
});
