import { describe, expect, it } from "vitest";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import { START_FEN } from "@chaturanga/shared/chess/position";
import {
  annotationsFromShapes,
  chessgroundMovableColor,
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
