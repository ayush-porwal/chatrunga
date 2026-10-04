import { describe, expect, it } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { MoveAnnotation, MoveReview } from "@chaturanga/shared/types/engine";
import { mainlineReviewInput, numberedLine } from "../game-review/review-utils";
import {
  bareSan,
  bestLineMoves,
  bestLineText,
  hasBestLine,
  lineMoveNumber,
  lineUnfolded,
  mainlineItems,
  sanPiece,
  setAllLineFolds,
  toggleLineFold,
  type MoveListItem
} from "./move-list-model";
import { buildTreeModel } from "./move-tree-model";

/** A reviewed move with the engine's best line (UCI) from before it, and its mark. */
function reviewed(
  move: ReturnType<typeof mainlineReviewInput>[number],
  annotation: MoveAnnotation | null,
  bestLine: string[] = []
): MoveReview {
  return {
    nodeId: move.nodeId,
    ply: move.ply,
    san: move.san,
    playedMove: move.uci,
    fenBefore: move.fenBefore,
    fenAfter: move.fenAfter,
    evalBefore: null,
    evalAfter: null,
    evalLoss: null,
    bestMove: bestLine[0] ?? null,
    bestLine,
    topLines: [],
    motifs: [],
    assessment: {
      policy: 3,
      winBefore: null,
      winAfter: null,
      winLoss: null,
      alternativeGap: null,
      severity: null,
      annotation,
      tags: []
    }
  };
}

// 4. Nxe5?? (4. c3 was best), after 3… Nd4.
const { game } = importPgnText("1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. O-O *");
const input = mainlineReviewInput(game.moveTree);
const bySan = (san: string) => input.find((move) => move.san === san)!;
const blunder = reviewed(bySan("Nxe5"), "blunder", ["c2c3", "d4c6", "d2d4", "e5d4"]);

describe("sanPiece and bareSan", () => {
  it.each([
    ["e4", "pawn", "e4"],
    ["exd5", "pawn", "exd5"],
    ["e8=Q+", "pawn", "e8=Q+"],
    ["Nxe5", "knight", "xe5"],
    ["Bc4", "bishop", "c4"],
    ["Rad1", "rook", "ad1"],
    ["Qg5", "queen", "g5"],
    ["Kh1", "king", "h1"],
    ["O-O", "king", "O-O"],
    ["O-O-O+", "king", "O-O-O+"]
  ])("%s moves the %s and reads %s after its icon", (san, piece, bare) => {
    expect(sanPiece(san)).toBe(piece);
    expect(bareSan(san)).toBe(bare);
  });
});

describe("hasBestLine", () => {
  it("is offered under marked errors the engine would have played differently", () => {
    for (const mark of ["inaccuracy", "mistake", "blunder", "miss"] as const)
      expect(hasBestLine(reviewed(bySan("Nxe5"), mark, ["c2c3"]))).toBe(true);
  });

  it("is not offered for unmarked, good or book moves, or without a different best move", () => {
    expect(hasBestLine(undefined)).toBe(false);
    expect(hasBestLine(reviewed(bySan("Nxe5"), null, ["c2c3"]))).toBe(false);
    expect(hasBestLine(reviewed(bySan("Nxe5"), "great", ["c2c3"]))).toBe(false);
    expect(hasBestLine(reviewed(bySan("e4"), "book", ["d2d4"]))).toBe(false);
    expect(hasBestLine(reviewed(bySan("Nxe5"), "blunder"))).toBe(false);
    expect(hasBestLine(reviewed(bySan("Nxe5"), "mistake", ["f3e5", "d4c2"]))).toBe(false);
  });

  it("falls back to the best move when the review kept no line", () => {
    const review = { ...reviewed(bySan("Nxe5"), "mistake"), bestMove: "c2c3" };
    expect(hasBestLine(review)).toBe(true);
    expect(bestLineMoves(review).map((move) => move.san)).toEqual(["c3"]);
  });
});

describe("bestLineMoves", () => {
  it("numbers the line from the position before the error, as it reads in the list", () => {
    const moves = bestLineMoves(blunder);
    expect(moves.map((move) => [move.number, move.san])).toEqual([
      ["4.", "c3"],
      [null, "Nc6"],
      ["5.", "d4"],
      [null, "exd4"]
    ]);
    expect(bestLineText(moves)).toBe("4. c3 Nc6 5. d4 exd4");
    expect(bestLineText(moves)).toBe(numberedLine(blunder.fenBefore, ["c3", "Nc6", "d4", "exd4"]));
  });

  it("starts a line for Black with its move number and an ellipsis", () => {
    const move = reviewed(bySan("Qg5"), "mistake", ["d8f6", "e5f3"]);
    expect(bestLineText(bestLineMoves(move))).toBe("4… Qf6 5. Nf3");
    expect(lineMoveNumber(move.fenBefore, 0)).toBe("4…");
    expect(lineMoveNumber(move.fenBefore, 1)).toBe("5.");
    expect(lineMoveNumber(move.fenBefore, 2)).toBeNull();
  });

  it("stops at four moves, and at the first move that doesn't fit the position", () => {
    const long = reviewed(bySan("Nxe5"), "blunder", [...blunder.bestLine, "c3d4", "f8b4"]);
    expect(bestLineMoves(long)).toHaveLength(4);
    const broken = reviewed(bySan("Nxe5"), "blunder", ["c2c3", "a1a8", "d2d4"]);
    expect(bestLineMoves(broken).map((move) => move.san)).toEqual(["c3"]);
  });

  it("carries each move's position for its preview and its UCI for the highlight", () => {
    const [first] = bestLineMoves(blunder);
    expect(first?.uci).toBe("c2c3");
    expect(first?.fenAfter.split(" ")[0]).toBe(
      "r1bqkbnr/pppp1ppp/8/4p3/2BnP3/2P2N2/PP1P1PPP/RNBQK2R"
    );
  });
});

describe("line folds", () => {
  it("are folded by default and unfold one by one", () => {
    let folds = setAllLineFolds(false);
    expect(lineUnfolded(folds, "a")).toBe(false);
    folds = toggleLineFold(folds, "a");
    expect(lineUnfolded(folds, "a")).toBe(true);
    expect(lineUnfolded(folds, "b")).toBe(false);
    folds = toggleLineFold(folds, "a");
    expect(lineUnfolded(folds, "a")).toBe(false);
  });

  it("show every line once all are shown, and a line folded since stays folded", () => {
    let folds = setAllLineFolds(true);
    expect(lineUnfolded(folds, "a")).toBe(true);
    folds = toggleLineFold(folds, "a");
    expect(lineUnfolded(folds, "a")).toBe(false);
    expect(lineUnfolded(folds, "b")).toBe(true);
  });

  it("forget the lines toggled one by one when all are shown or hidden", () => {
    const folds = toggleLineFold(setAllLineFolds(false), "a");
    expect(lineUnfolded(setAllLineFolds(false), "a")).toBe(false);
    expect(lineUnfolded(setAllLineFolds(true), "a")).toBe(true);
    expect(folds.toggled.has("a")).toBe(true);
  });
});

describe("mainlineItems", () => {
  const describeItem = (item: MoveListItem): string => {
    switch (item.kind) {
      case "moves":
        return `${item.number}: ${item.white?.san ?? "…"} ${item.black?.san ?? ""}`.trim();
      case "opening":
        return "opening";
      case "best":
        return `best ${item.node.san}`;
      case "variations":
        return `variations ${item.blocks.map((block) => block.rows.map((row) => row.node.san).join(" ")).join(" | ")}`;
    }
  };

  it("pairs the moves by number, two to a row", () => {
    const model = buildTreeModel(game.moveTree);
    expect(mainlineItems(model).map(describeItem)).toEqual([
      "1: e4 e5",
      "2: Nf3 Nc6",
      "3: Bc4 Nd4",
      "4: Nxe5 Qg5",
      "5: O-O"
    ]);
  });

  it("follows a row with the opening after the last book move, its unfolded BEST lines, then the variations off its moves", () => {
    const { game: branched } = importPgnText(
      "1. e4 e5 2. Nf3 (2. Bc4 Nf6) 2… Nc6 3. Bc4 Nd4 4. Nxe5 (4. c3) 4… Qg5 *"
    );
    const model = buildTreeModel(branched.moveTree);
    const node = (san: string): MoveNode =>
      branched.moveTree.find((item) => item.san === san && item.parentId !== null)!;
    const items = mainlineItems(model, {
      bookEndNodeId: node("Nc6").id,
      showsBestLine: (item) => item.san === "Nxe5" || item.san === "Qg5"
    });
    expect(items.map(describeItem)).toEqual([
      "1: e4 e5",
      "variations Bc4 Nf6",
      "2: Nf3 Nc6",
      "opening",
      "3: Bc4 Nd4",
      // 4. c3 branches off 3… Nd4, so it follows that row.
      "variations c3",
      "4: Nxe5 Qg5",
      "best Nxe5",
      "best Qg5"
    ]);
  });

  it("opens a line that starts with Black with a row that has no White move", () => {
    const { game: fromBlack } = importPgnText(
      '[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"]\n\n1… e5 2. Nf3 *'
    );
    expect(mainlineItems(buildTreeModel(fromBlack.moveTree)).map(describeItem)).toEqual([
      "1: … e5",
      "2: Nf3"
    ]);
  });
});
