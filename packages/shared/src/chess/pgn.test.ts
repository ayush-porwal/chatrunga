import { describe, expect, it } from "vitest";
import {
  addMoveNode,
  clocksOnPathToNode,
  createEmptyGame,
  createGameFromFen,
  exportGameToPgn,
  importPgnText,
  nodeIdForBoardFen,
  withRealPlies,
  type PgnAnalysis,
  type PgnAnalysisMove
} from "./pgn";
import { applyUserMove, START_FEN } from "./position";
import type { MoveNode } from "../types/chess";
import type { EngineScore, MoveAnnotation } from "../types/engine";

describe("PGN import/export", () => {
  it("imports a simple PGN and builds a move tree", () => {
    const imported = importPgnText(
      '[Event "Demo"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 *'
    );
    expect(imported.game.headers.event).toBe("Demo");
    expect(imported.game.moveTree.filter((node) => node.uci).map((node) => node.uci)).toStrictEqual(
      ["e2e4", "e7e5", "g1f3"]
    );
  });

  it("round trips PGN arrows", () => {
    const imported = importPgnText("1. e4 { [%cal Gg1f3] [%csl Ye4] } *");
    const node = imported.game.moveTree.find((item) => item.uci === "e2e4");
    expect(node?.arrows).toStrictEqual([{ color: "green", orig: "g1", dest: "f3" }]);
    expect(node?.highlights).toStrictEqual([{ color: "yellow", square: "e4" }]);
    expect(exportGameToPgn(imported.game)).toContain("[%cal Gg1f3]");
  });

  it.each([
    [
      "packed tags (Lichess-style), eval before or after clk",
      '[White "W"][Black "B"][Result "*"]\n1. e4 {[%eval 0.10][%clk 0:01:00]} e5 {[%clk 0:00:59][%eval 0.12]} *'
    ],
    ["no space after the opening brace", "1. e4 {[%clk 0:01:00]} e5 { [%clk 0:00:59] } *"],
    [
      "eval and clk spaced in one comment",
      '[White "W"][Black "B"][Result "*"]\n1. e4 { [%eval 0.17] [%clk 0:01:00] } e5 { [%clk 0:00:59] } 2. Nf3 *'
    ]
  ])("reads move clocks from comments: %s", (_shape, pgn) => {
    const { moveTree } = importPgnText(pgn).game;
    expect(moveTree.find((n) => n.uci === "e2e4")?.clockAfter).toBe("0:01:00");
    expect(moveTree.find((n) => n.uci === "e7e5")?.clockAfter).toBe("0:00:59");
  });

  it("imports En Croissant export: root eval, fractional clk, Orientation", () => {
    const pgn = `[Event "Player vs Engine"]
[Site "En Croissant"]
[Date "2026.05.09"]
[Round "?"]
[White "Maia"]
[Black "Ayush Porwal"]
[Result "*"]
[Orientation "black"]
[TimeControl "180+0.001"]

{[%eval +0.35] } 1. e4 {[%eval +0.29] [%clk 0:03:00] } c5 {[%eval +0.30] [%clk 0:02:58.246] } *`;
    const imported = importPgnText(pgn);
    expect(imported.game.headers.orientationHint).toBe("black");
    expect(imported.game.moveTree.find((n) => n.san === "e4")?.clockAfter).toBe("0:03:00");
    expect(imported.game.moveTree.find((n) => n.san === "c5")?.clockAfter).toBe("0:02:58.246");
  });

  it("captures extended headers and move clocks", () => {
    const pgn = `[Event "Rapid"]
[White "Carlsen, Magnus"]
[Black "Nepo, Ian"]
[WhiteElo "2830"]
[BlackElo "2795"]
[TimeControl "600+5"]
[Result "*"]

1. e4 { [%clk 0:10:00] } e5 { [%clk 0:09:55] } *`;
    const imported = importPgnText(pgn);
    expect(imported.game.headers.whiteElo).toBe("2830");
    expect(imported.game.headers.timeControl).toBe("600+5");
    const e4 = imported.game.moveTree.find((n) => n.uci === "e2e4");
    const e5 = imported.game.moveTree.find((n) => n.uci === "e7e5");
    expect(e4?.clockAfter).toBe("0:10:00");
    expect(e5?.clockAfter).toBe("0:09:55");
    const exported = exportGameToPgn(imported.game);
    expect(exported).toContain('[WhiteElo "2830"]');
    expect(exported).toContain('[TimeControl "600+5"]');
    expect(exported).toContain("[%clk 0:10:00]");
  });

  it("creates empty and FEN-backed games", () => {
    expect(createEmptyGame()).toMatchObject({
      currentNodeId: "root",
      currentFen: START_FEN,
      pgn: "*"
    });
    expect(
      createGameFromFen({ fen: START_FEN, source: "analysis", headers: { white: "Alice" } })
    ).toMatchObject({
      source: "analysis",
      currentFen: START_FEN,
      headers: { white: "Alice", result: "*" }
    });
  });

  it("adds moves, reuses duplicate lines, and resolves board FEN nodes", () => {
    const game = createEmptyGame();
    const e4 = applyUserMove(START_FEN, { from: "e2", to: "e4" });
    expect(e4).not.toBeNull();
    const first = addMoveNode(game.moveTree, "root", {
      san: e4!.san,
      uci: e4!.uci,
      fenBefore: START_FEN,
      fenAfter: e4!.fen
    });
    const duplicate = addMoveNode(first.moveTree, "root", {
      san: e4!.san,
      uci: e4!.uci,
      fenBefore: START_FEN,
      fenAfter: e4!.fen
    });

    expect(duplicate.node.id).toBe(first.node.id);
    expect(nodeIdForBoardFen(first.moveTree, e4!.fen, "root")).toBe(first.node.id);
    expect(nodeIdForBoardFen(first.moveTree, "missing", "root")).toBe("root");
  });

  it("reads clocks on the current path", () => {
    const imported = importPgnText("1. e4 {[%clk 0:10:00]} e5 {[%clk 0:09:30]} *");
    expect(clocksOnPathToNode(imported.game.moveTree, imported.game.currentNodeId)).toStrictEqual({
      white: "0:10:00",
      black: "0:09:30"
    });
    expect(clocksOnPathToNode(imported.game.moveTree, "missing")).toStrictEqual({
      white: null,
      black: null
    });
  });

  it("warns when importing multiple PGNs and rejects empty input", () => {
    expect(importPgnText("1. e4 *\n\n1. d4 *").warning).toBe("Imported the first PGN game only.");
    expect(() => importPgnText("")).toThrow("No PGN game found");
  });

  it("drops an unplayable move and what follows, unless strict", () => {
    const pgn = "1. e4 e5 2. Ke3 Nc6 *";
    expect(
      importPgnText(pgn)
        .game.moveTree.map((node) => node.san)
        .filter(Boolean)
    ).toStrictEqual(["e4", "e5"]);
    expect(() => importPgnText(pgn, { strict: true })).toThrow(/Illegal move/);
    expect(importPgnText("1. e4 (1. d4 d5) e5 *", { strict: true }).game.moveTree).toHaveLength(5);
  });
});

describe("PGN from a set-up position", () => {
  const fen = "4k3/8/8/8/8/8/8/4K3 b - - 0 42";

  it("numbers moves from the FEN and exports SetUp/FEN so the game reimports", () => {
    const imported = importPgnText(`[SetUp "1"]\n[FEN "${fen}"]\n\n42... Kf7 43. Ke2 *`).game;
    expect(imported.moveTree.map((node) => node.ply)).toStrictEqual([83, 84, 85]);

    const pgn = exportGameToPgn(imported);
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain(`[FEN "${fen}"]`);
    expect(pgn.split("\n").pop()).toBe("42... Kf7 43. Ke2 *");

    const again = importPgnText(pgn).game;
    expect(again.rootFen).toBe(fen);
    expect(again.moveTree.filter((node) => node.san).map((node) => node.san)).toStrictEqual([
      "Kf7",
      "Ke2"
    ]);
  });

  it("attributes clocks to the side that moved", () => {
    const imported = importPgnText(
      `[SetUp "1"]\n[FEN "${fen}"]\n\n42... Kf7 { [%clk 0:01:00] } 43. Ke2 { [%clk 0:02:00] } *`
    ).game;
    expect(clocksOnPathToNode(imported.moveTree, imported.currentNodeId)).toStrictEqual({
      white: "0:02:00",
      black: "0:01:00"
    });
  });

  it("keeps the standard start free of SetUp/FEN", () => {
    expect(exportGameToPgn(createEmptyGame())).not.toContain("[FEN");
  });

  it("writes FEN for games created from a position", () => {
    expect(createGameFromFen({ fen }).pgn).toContain(`[FEN "${fen}"]`);
    expect(createGameFromFen({ fen }).moveTree[0]?.ply).toBe(83);
  });

  it("renumbers trees saved with a ply-0 root", () => {
    const legacy = importPgnText(`[SetUp "1"]\n[FEN "${fen}"]\n\n42... Kf7 *`).game.moveTree.map(
      (node) => ({
        ...node,
        ply: node.ply - 83
      })
    );
    expect(withRealPlies(legacy).map((node) => node.ply)).toStrictEqual([83, 84]);
    const standard = createEmptyGame().moveTree;
    expect(withRealPlies(standard)).toBe(standard);
  });
});

describe("PGN variations", () => {
  it.each([
    "1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 *",
    "1. e4 (1. d4 d5) 1... e5 2. Nf3 *",
    "1. e4 e5 2. Nf3 (2. Bc4 Nf6 (2... Bc5)) 2... Nc6 *"
  ])("places each variation after the move it replaces: %s", (movetext) => {
    const exported = exportGameToPgn(importPgnText(movetext).game).split("\n").pop();
    expect(exported).toBe(movetext);
  });
});

/** The tree with node `from` given the id `to`, its parent and children links following. */
function withNodeRenamed(tree: readonly MoveNode[], from: string, to: string): MoveNode[] {
  const rename = (id: string) => (id === from ? to : id);
  return tree.map((node) => ({
    ...node,
    id: rename(node.id),
    parentId: node.parentId === null ? null : rename(node.parentId),
    children: node.children.map(rename)
  }));
}

describe("PGN with the analysis", () => {
  const game = importPgnText(
    '[Event "Demo"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 (2. Nf3 Nc6 3. Bb5) 2... Nc6 { [%eval 0.50] } 3. Bc4 $1 Nf6 4. Qxf7# 1-0'
  ).game;
  const byId = new Map(game.moveTree.map((node) => [node.id, node]));
  const mainline: MoveNode[] = [];
  for (let id = byId.get("root")?.children[0]; id; id = byId.get(id)?.children[0]) {
    const node = byId.get(id);
    if (node) mainline.push(node);
  }
  const cp = (value: number): EngineScore => ({ type: "cp", value });
  /** A reviewed main-line move (by index): its mark, eval after it, and the best line before it. */
  const reviewed = (
    index: number,
    annotation: MoveAnnotation | null,
    evalAfter: EngineScore | null,
    best: { line: string[]; evalAfter: EngineScore } | null = null
  ): PgnAnalysisMove => ({
    nodeId: mainline[index].id,
    fenBefore: mainline[index].fenBefore,
    evalAfter,
    bestEvalAfter: best?.evalAfter ?? null,
    bestMove: best?.line[0] ?? null,
    bestLine: best?.line ?? [],
    assessment: { annotation }
  });
  const analysis: PgnAnalysis = {
    opening: { eco: "C23", name: "Bishop's Opening" },
    moves: [
      reviewed(0, "book", cp(30)),
      reviewed(1, null, cp(32)),
      // A best line already explored by hand: only its new move is added.
      reviewed(2, "inaccuracy", cp(0), { line: ["g1f3", "b8c6", "f1c4"], evalAfter: cp(35) }),
      // Replaces the eval the imported game brought.
      reviewed(3, "excellent", cp(60)),
      // Replaces the imported $1; its best line starts with the move played, so it adds nothing.
      reviewed(4, "mistake", cp(20), { line: ["f1c4", "f8c5"], evalAfter: cp(25) }),
      reviewed(
        5,
        "blunder",
        { type: "mate", value: 1 },
        { line: ["d8e7", "g1f3"], evalAfter: cp(40) }
      ),
      // Checkmate (`mate 0`): no eval.
      reviewed(6, "great", { type: "mate", value: 0 })
    ]
  };

  it("writes marks as NAGs, evals, the opening and best lines as variations", () => {
    const pgn = exportGameToPgn({ ...game, analysis });
    expect(pgn).toContain('[ECO "C23"]\n[Opening "Bishop\'s Opening"]');
    expect(pgn.split("\n").pop()).toBe(
      "1. e4 { [%eval 0.30] } e5 { [%eval 0.32] } 2. Qh5 $6 { [%eval 0.00] } " +
        "(2. Nf3 { [%eval 0.35] } Nc6 3. Bb5 (3. Bc4)) 2... Nc6 { [%eval 0.60] } " +
        "3. Bc4 $2 { [%eval 0.20] } Nf6 $4 { [%eval #1] } (3... Qe7 { [%eval 0.40] } 4. Nf3) " +
        "4. Qxf7# $1 1-0"
    );
  });

  it("drops an imported quality NAG the review marks without a glyph", () => {
    // 3. Bc4 came with $1; reviewed as excellent (no standard glyph), it carries no NAG.
    const pgn = exportGameToPgn({ ...game, analysis: { moves: [reviewed(4, "excellent", null)] } });
    expect(pgn).toContain("3. Bc4 Nf6");
    expect(pgn).not.toContain("$1");
  });

  it("keeps every node when a best line's new id is already taken", () => {
    // 3. Bb5 (in the 2. Nf3 line) gets the id 3... Nf6's best line would take for Qe7.
    const taken = `${mainline[5].id}~best-0`;
    const bb5 = game.moveTree.find((node) => node.san === "Bb5")!;
    const moveTree = withNodeRenamed(game.moveTree, bb5.id, taken);
    const pgn = exportGameToPgn({ ...game, moveTree, analysis });
    expect(pgn.split("\n").pop()).toBe(
      "1. e4 { [%eval 0.30] } e5 { [%eval 0.32] } 2. Qh5 $6 { [%eval 0.00] } " +
        "(2. Nf3 { [%eval 0.35] } Nc6 3. Bb5 (3. Bc4)) 2... Nc6 { [%eval 0.60] } " +
        "3. Bc4 $2 { [%eval 0.20] } Nf6 $4 { [%eval #1] } (3... Qe7 { [%eval 0.40] } 4. Nf3) " +
        "4. Qxf7# $1 1-0"
    );
  });

  it("re-imports with every move, NAG and header, and exports the same again", () => {
    const pgn = exportGameToPgn({ ...game, analysis });
    const again = importPgnText(pgn, { strict: true }).game;
    expect(again.headers).toMatchObject({ eco: "C23", opening: "Bishop's Opening", result: "1-0" });
    expect(again.moveTree.find((node) => node.san === "Qh5")?.nags).toStrictEqual(["$6"]);
    expect(again.moveTree.find((node) => node.san === "Qe7")?.fenBefore).toBe(
      mainline[5].fenBefore
    );
    expect(exportGameToPgn(again)).toBe(pgn);
  });

  it("keeps the game's own opening headers and its moves without a review", () => {
    const headers = { ...game.headers, eco: "C20", opening: "King's Pawn Game" };
    const pgn = exportGameToPgn({ headers, moveTree: game.moveTree, analysis });
    expect(pgn).toContain('[ECO "C20"]');
    expect(pgn).not.toContain("C23");
    expect(exportGameToPgn({ ...game, analysis: { moves: [] } })).toBe(exportGameToPgn(game));
  });

  it.each([
    [cp(-125), "-1.25"],
    [cp(7), "0.07"],
    [{ type: "mate", value: 3 } as const, "#3"],
    [{ type: "mate", value: -2 } as const, "#-2"]
  ])("writes %o as [%%eval %s]", (score, text) => {
    const pgn = exportGameToPgn({ ...game, analysis: { moves: [reviewed(0, null, score)] } });
    expect(pgn).toContain(`1. e4 { [%eval ${text}] } e5`);
  });
});
