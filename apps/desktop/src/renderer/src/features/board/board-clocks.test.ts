import { describe, expect, it } from "vitest";
import { addMoveNode, importPgnText } from "@chaturanga/shared/chess/pgn";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { boardClocksAt, sideToMove, startingClock } from "./board-clocks";

// The opening of a 3+0 Lichess blitz game, with the clocks Lichess recorded after every move.
const BLITZ = `[White "tdguerreiro"]
[Black "kakashi__ofleaf"]
[TimeControl "180+0"]
[Result "*"]

1. d3 { [%clk 0:03:00] } c5 { [%clk 0:03:00] } 2. Nf3 { [%clk 0:03:00] } d6 { [%clk 0:03:00] }
3. Nbd2 { [%clk 0:03:00] } Nc6 { [%clk 0:02:59] } 4. c3 { [%clk 0:03:00] } g6 { [%clk 0:02:57] }
5. g3 { [%clk 0:03:00] } Bg7 { [%clk 0:02:56] } 6. Bg2 { [%clk 0:02:59] } Nf6 { [%clk 0:02:56] }
7. O-O { [%clk 0:02:59] } O-O { [%clk 0:02:56] } 8. Re1 { [%clk 0:02:58] } a5 { [%clk 0:02:53] }
9. Qc2 { [%clk 0:02:58] } b5 { [%clk 0:02:50] } 10. e4 { [%clk 0:02:58] } Bb7 { [%clk 0:02:49] }
11. d4 { [%clk 0:02:55] } b4 { [%clk 0:02:47] } 12. d5 { [%clk 0:02:53] } Ne5 { [%clk 0:02:45] }
13. Nxe5 { [%clk 0:02:51] } dxe5 { [%clk 0:02:44] } 14. Nf3 { [%clk 0:02:51] } Qc7 { [%clk 0:02:39] }
15. cxb4 { [%clk 0:02:39] } axb4 { [%clk 0:02:36] } 16. Be3 { [%clk 0:02:37] } Ng4 { [%clk 0:02:29] }
17. Qxc5 { [%clk 0:02:29] } Qxc5 { [%clk 0:02:26] } 18. Bxc5 { [%clk 0:02:29] } Rfb8 { [%clk 0:02:20] }
19. Bxe7 { [%clk 0:02:23] } Bc8 { [%clk 0:02:08] } 20. h3 { [%clk 0:02:16] } Nh6 { [%clk 0:02:06] }
21. Bd6 { [%clk 0:02:15] } f5 { [%clk 0:02:02] } 22. Bxb8 { [%clk 0:02:12] } Rxb8 { [%clk 0:02:01] }
23. exf5 { [%clk 0:02:03] } Nxf5 { [%clk 0:02:01] } 24. Nxe5 { [%clk 0:01:59] } Nd4 { [%clk 0:01:45] }
25. d6 { [%clk 0:01:45] } Nc2 { [%clk 0:01:43] } 26. d7 { [%clk 0:01:41] } *`;

function mainLine(moveTree: MoveNode[]): MoveNode[] {
  const line: MoveNode[] = [];
  let node = moveTree.find((item) => item.parentId === null);
  while (node?.children[0]) {
    const next = moveTree.find((item) => item.id === node?.children[0]);
    if (!next) break;
    line.push(next);
    node = next;
  }
  return line;
}

describe("boardClocksAt", () => {
  const { game } = importPgnText(BLITZ);
  const line = mainLine(game.moveTree);
  const at = (ply: number) => boardClocksAt(game.moveTree, line[ply - 1]!.id, "180+0");

  it("shows each side the time it had left after its own last move", () => {
    // 24... Nd4 left Black 1:45; 25. d6 left White 1:45 too: both clocks read 01:45 at ply 49.
    expect(at(48)).toEqual({ white: "01:59", black: "01:45" });
    expect(at(49)).toEqual({ white: "01:45", black: "01:45" });
    expect(at(50)).toEqual({ white: "01:45", black: "01:43" });
    expect(at(51)).toEqual({ white: "01:41", black: "01:43" });
  });

  it("starts both clocks at the time control's starting time", () => {
    expect(boardClocksAt(game.moveTree, "root", "180+0")).toEqual({
      white: "03:00",
      black: "03:00"
    });
    expect(boardClocksAt(game.moveTree, line[0]!.id, null)).toEqual({
      white: "03:00",
      black: "--:--"
    });
  });

  it("keeps the clocks of the move a variation leaves", () => {
    // A move of the user's own after 25. d6 records no clock (the FEN after it doesn't matter here).
    const after = line[48]!;
    const { moveTree, node } = addMoveNode(
      game.moveTree,
      after.id,
      "Ne6",
      "d4e6",
      after.fenAfter,
      after.fenAfter
    );
    expect(boardClocksAt(moveTree, node.id, "180+0")).toEqual({
      white: "01:45",
      black: "01:45"
    });
  });

  it("shows no clocks for a game whose moves record none", () => {
    const { game: plain } = importPgnText('[TimeControl "180+0"]\n\n1. e4 e5 2. Nf3 *');
    expect(boardClocksAt(plain.moveTree, plain.currentNodeId, "180+0")).toBeNull();
  });
});

describe("startingClock", () => {
  it("reads the base time of a base+increment or base-only control", () => {
    expect(startingClock("180+2")).toBe("0:03:00");
    expect(startingClock("600")).toBe("0:10:00");
    expect(startingClock(" 5400+30 ")).toBe("1:30:00");
  });

  it("has no single start for an unknown or multi-stage control", () => {
    for (const control of [null, undefined, "", "-", "?", "40/7200:3600"])
      expect(startingClock(control)).toBeNull();
  });
});

describe("sideToMove", () => {
  it("reads the FEN's active colour", () => {
    expect(sideToMove("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")).toBe("black");
    expect(sideToMove("8/8/8/8/8/8/8/K6k w - - 0 1")).toBe("white");
  });
});
