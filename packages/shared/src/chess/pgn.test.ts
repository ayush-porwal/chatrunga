import { describe, expect, it } from "vitest";
import {
  addMoveNode,
  clocksOnPathToNode,
  createEmptyGame,
  createGameFromFen,
  exportGameToPgn,
  importPgnText,
  nodeIdForBoardFen,
  withRealPlies
} from "./pgn";
import { applyUserMove, START_FEN } from "./position";

describe("PGN import/export", () => {
  it("imports a simple PGN and builds a move tree", () => {
    const imported = importPgnText(
      '[Event "Demo"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 *'
    );
    expect(imported.game.headers.event).toBe("Demo");
    expect(imported.game.moveTree.filter((node) => node.uci).map((node) => node.uci)).toEqual([
      "e2e4",
      "e7e5",
      "g1f3"
    ]);
  });

  it("round trips PGN arrows", () => {
    const imported = importPgnText("1. e4 { [%cal Gg1f3] [%csl Ye4] } *");
    const node = imported.game.moveTree.find((item) => item.uci === "e2e4");
    expect(node?.arrows).toEqual([{ color: "green", orig: "g1", dest: "f3" }]);
    expect(node?.highlights).toEqual([{ color: "yellow", square: "e4" }]);
    expect(exportGameToPgn(imported.game)).toContain("[%cal Gg1f3]");
  });

  it("parses clk with chessops when tags are packed (Lichess-style)", () => {
    const imported = importPgnText(
      '[White "W"][Black "B"][Result "*"]\n1. e4 {[%eval 0.10][%clk 0:01:00]} e5 {[%clk 0:00:59][%eval 0.12]} *'
    );
    expect(imported.game.moveTree.find((n) => n.uci === "e2e4")?.clockAfter).toBe("0:01:00");
    expect(imported.game.moveTree.find((n) => n.uci === "e7e5")?.clockAfter).toBe("0:00:59");
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

  it("parses clk in comment with no space after opening brace", () => {
    const imported = importPgnText("1. e4 {[%clk 0:10:00]} e5 { [%clk 0:09:00] } *");
    expect(imported.game.moveTree.find((n) => n.uci === "e2e4")?.clockAfter).toBe("0:10:00");
    expect(imported.game.moveTree.find((n) => n.uci === "e7e5")?.clockAfter).toBe("0:09:00");
  });

  it("captures Lichess-style combined comment with eval and clk", () => {
    const imported = importPgnText(
      '[White "W"][Black "B"][Result "*"]\n1. e4 { [%eval 0.17] [%clk 0:01:00] } e5 { [%clk 0:00:59] } 2. Nf3 *'
    );
    const e4 = imported.game.moveTree.find((n) => n.uci === "e2e4");
    const e5 = imported.game.moveTree.find((n) => n.uci === "e7e5");
    expect(e4?.clockAfter).toBe("0:01:00");
    expect(e5?.clockAfter).toBe("0:00:59");
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
    const first = addMoveNode(game.moveTree, "root", e4!.san, e4!.uci, START_FEN, e4!.fen);
    const duplicate = addMoveNode(first.moveTree, "root", e4!.san, e4!.uci, START_FEN, e4!.fen);

    expect(duplicate.node.id).toBe(first.node.id);
    expect(nodeIdForBoardFen(first.moveTree, e4!.fen, "root")).toBe(first.node.id);
    expect(nodeIdForBoardFen(first.moveTree, "missing", "root")).toBe("root");
  });

  it("reads clocks on the current path", () => {
    const imported = importPgnText("1. e4 {[%clk 0:10:00]} e5 {[%clk 0:09:30]} *");
    expect(clocksOnPathToNode(imported.game.moveTree, imported.game.currentNodeId)).toEqual({
      white: "0:10:00",
      black: "0:09:30"
    });
    expect(clocksOnPathToNode(imported.game.moveTree, "missing")).toEqual({
      white: null,
      black: null
    });
  });

  it("warns when importing multiple PGNs and rejects empty input", () => {
    expect(importPgnText("1. e4 *\n\n1. d4 *").warning).toBe("Imported the first PGN game only.");
    expect(() => importPgnText("")).toThrow("No PGN game found");
  });
});

describe("PGN from a set-up position", () => {
  const fen = "4k3/8/8/8/8/8/8/4K3 b - - 0 42";

  it("numbers moves from the FEN and exports SetUp/FEN so the game reimports", () => {
    const imported = importPgnText(`[SetUp "1"]\n[FEN "${fen}"]\n\n42... Kf7 43. Ke2 *`).game;
    expect(imported.moveTree.map((node) => node.ply)).toEqual([83, 84, 85]);

    const pgn = exportGameToPgn(imported);
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain(`[FEN "${fen}"]`);
    expect(pgn.split("\n").pop()).toBe("42... Kf7 43. Ke2 *");

    const again = importPgnText(pgn).game;
    expect(again.rootFen).toBe(fen);
    expect(again.moveTree.filter((node) => node.san).map((node) => node.san)).toEqual(["Kf7", "Ke2"]);
  });

  it("attributes clocks to the side that moved", () => {
    const imported = importPgnText(
      `[SetUp "1"]\n[FEN "${fen}"]\n\n42... Kf7 { [%clk 0:01:00] } 43. Ke2 { [%clk 0:02:00] } *`
    ).game;
    expect(clocksOnPathToNode(imported.moveTree, imported.currentNodeId)).toEqual({
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
    const legacy = importPgnText(`[SetUp "1"]\n[FEN "${fen}"]\n\n42... Kf7 *`).game.moveTree.map((node) => ({
      ...node,
      ply: node.ply - 83
    }));
    expect(withRealPlies(legacy).map((node) => node.ply)).toEqual([83, 84]);
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
