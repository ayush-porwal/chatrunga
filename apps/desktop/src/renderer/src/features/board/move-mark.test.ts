import { describe, expect, it } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { MoveAnnotation, MoveReview } from "@chaturanga/shared/types/engine";
import { compatibleReviewMoves } from "../../stores/review-validity";
import { mainlineReviewInput } from "../game-review/review-utils";
import {
  boardMoveMark,
  mainBoardSurface,
  showsMoveMarks,
  squareOffset,
  type MarkSurface
} from "./move-mark";

const { game } = importPgnText("1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 *");

/** The main line reviewed, with `marks` by SAN (every other move unmarked). */
function reviewed(marks: Record<string, MoveAnnotation>): MoveReview[] {
  return mainlineReviewInput(game.moveTree).map(
    (move) =>
      ({
        nodeId: move.nodeId,
        ply: move.ply,
        san: move.san,
        playedMove: move.uci,
        fenBefore: move.fenBefore,
        fenAfter: move.fenAfter,
        assessment: { annotation: marks[move.san] ?? null }
      }) as MoveReview
  );
}

const moves = reviewed({ Nd4: "inaccuracy", Nxe5: "blunder" });
const nodeOf = (san: string) => moves.find((move) => move.san === san)?.nodeId ?? "";
const finished = { running: false, moves };

describe("showsMoveMarks", () => {
  it.each<[MarkSurface, boolean]>([
    ["review", true],
    ["analysis", true],
    ["freeplay", false],
    ["engine", false],
    ["online", false],
    ["puzzle", false]
  ])("on %s: %s", (surface, shown) => {
    expect(showsMoveMarks(surface)).toBe(shown);
  });
});

describe("mainBoardSurface", () => {
  it("is the Analyze board for live analysis and for the free board Analyze opens", () => {
    expect(showsMoveMarks(mainBoardSurface("analysis", "pgn-import"))).toBe(true);
    expect(showsMoveMarks(mainBoardSurface("freeplay", "analysis"))).toBe(true);
  });

  it("is play for a free board of a game, and an engine or Lichess game", () => {
    expect(showsMoveMarks(mainBoardSurface("freeplay", "pgn-import"))).toBe(false);
    expect(showsMoveMarks(mainBoardSurface("engine", "engine-game"))).toBe(false);
    expect(showsMoveMarks(mainBoardSurface("online", "lichess"))).toBe(false);
    expect(showsMoveMarks(mainBoardSurface("puzzle", "puzzle"))).toBe(false);
  });
});

describe("boardMoveMark", () => {
  it("marks a marked move's destination square, named for screen readers", () => {
    expect(boardMoveMark("review", { ...finished, nodeId: nodeOf("Nxe5") })).toEqual({
      nodeId: nodeOf("Nxe5"),
      square: "e5",
      annotation: "blunder",
      label: "Blunder: Nxe5"
    });
    expect(boardMoveMark("analysis", { ...finished, nodeId: nodeOf("Nd4") })).toMatchObject({
      square: "d4",
      label: "Inaccuracy: Nd4"
    });
  });

  it("never marks a move while playing or solving a puzzle", () => {
    for (const surface of ["freeplay", "engine", "online", "puzzle"] as const)
      expect(boardMoveMark(surface, { ...finished, nodeId: nodeOf("Nxe5") })).toBeNull();
  });

  it("leaves ordinary moves, the starting position and unreviewed moves unmarked", () => {
    expect(boardMoveMark("review", { ...finished, nodeId: nodeOf("Nf3") })).toBeNull();
    expect(boardMoveMark("review", { ...finished, nodeId: "root" })).toBeNull();
    expect(boardMoveMark("review", { ...finished, nodeId: "variation-move" })).toBeNull();
  });

  it("marks a book move like any other", () => {
    const book = { running: false, moves: reviewed({ e4: "book", Nxe5: "blunder" }) };
    expect(boardMoveMark("review", { ...book, nodeId: nodeOf("e4") })).toEqual({
      nodeId: nodeOf("e4"),
      square: "e4",
      annotation: "book",
      label: "Book: e4"
    });
    expect(boardMoveMark("review", { ...book, nodeId: nodeOf("Nxe5") })?.annotation).toBe(
      "blunder"
    );
  });

  it("waits for a running review to finish", () => {
    expect(boardMoveMark("review", { running: true, moves, nodeId: nodeOf("Nxe5") })).toBeNull();
  });

  it("drops the mark of a move the game no longer has (a stale review)", () => {
    // The game was edited after the analysis: 4. c3 played where 4. Nxe5 was.
    const edited = game.moveTree.map((node) =>
      node.san === "Nxe5" ? { ...node, san: "c3", uci: "c2c3" } : node
    );
    const still = compatibleReviewMoves(moves, edited);
    expect(
      boardMoveMark("review", { running: false, moves: still, nodeId: nodeOf("Nxe5") })
    ).toBeNull();
    expect(
      boardMoveMark("review", { running: false, moves: still, nodeId: nodeOf("Nd4") })
    ).toMatchObject({
      label: "Inaccuracy: Nd4"
    });
  });
});

describe("squareOffset", () => {
  it("places a square from White's side, and mirrored on a flipped board", () => {
    expect(squareOffset("a1", "white")).toEqual({ left: 0, top: 87.5 });
    expect(squareOffset("e5", "white")).toEqual({ left: 50, top: 37.5 });
    expect(squareOffset("a1", "black")).toEqual({ left: 87.5, top: 0 });
    expect(squareOffset("e5", "black")).toEqual({ left: 37.5, top: 50 });
    expect(squareOffset("h8", "black")).toEqual({ left: 0, top: 87.5 });
  });
});
