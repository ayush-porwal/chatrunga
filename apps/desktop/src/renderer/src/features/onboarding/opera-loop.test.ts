import { describe, expect, it } from "vitest";
import { Board } from "chessops/board";
import { makeBoardFen } from "chessops/fen";
import { parseSquare } from "chessops/util";
import {
  OPERA_LOOP_MATED_SQUARE,
  operaLoopFinalView,
  operaLoopFrames,
  operaLoopView,
  type OperaLoopPiece
} from "./opera-loop";
import { operaGameMainline } from "./opera-game";

/** The frame's board as a FEN board field (captured pieces left out). */
function boardFen(pieces: OperaLoopPiece[]): string {
  const board = Board.empty();
  for (const piece of pieces.filter((item) => !item.captured)) {
    board.set(parseSquare(piece.square), { color: piece.color, role: piece.role });
  }
  return makeBoardFen(board);
}

const nodes = operaGameMainline();
const frames = operaLoopFrames();

describe("operaLoopFrames", () => {
  it("starts after 9…b5 and plays 10.Nxb5 through 17.Rd8#", () => {
    expect([nodes[18].san, frames.length, nodes.at(-1)?.san]).toStrictEqual(["b5", 16, "Rd8#"]);
  });

  it.each(frames.map((frame, index) => [index, frame] as const))(
    "frame %i matches the game's position",
    (index, frame) => {
      expect(boardFen(frame.pieces)).toBe(nodes[18 + index].fenAfter.split(" ")[0]);
    }
  );

  it("slides the moving piece: its id survives the move", () => {
    // 10.Nxb5: the knight that started the loop on c3.
    expect(frames[1].pieces.find((piece) => piece.square === "b5")?.id).toBe("c3");
  });

  it("keeps a captured piece in its frame, flagged, and drops it after", () => {
    expect([
      frames[1].pieces.find((piece) => piece.id === "b5")?.captured,
      frames[2].pieces.some((piece) => piece.id === "b5")
    ]).toStrictEqual([true, false]);
  });

  it("castles long: the king to c1 and the rook from a1 to d1", () => {
    // 12.O-O-O is the loop's fifth move.
    expect([
      frames[5].lastMove,
      frames[5].pieces.find((piece) => piece.id === "e1")?.square,
      frames[5].pieces.find((piece) => piece.id === "a1")?.square
    ]).toStrictEqual([["e1", "c1"], "c1", "d1"]);
  });

  it("highlights the mating move", () => {
    expect(frames.at(-1)?.lastMove).toStrictEqual(["d1", "d8"]);
  });

  it("ends with the black king mated on e8", () => {
    expect(
      frames.at(-1)?.pieces.find((piece) => piece.square === OPERA_LOOP_MATED_SQUARE)
    ).toMatchObject({ color: "black", role: "king" });
  });
});

describe("operaLoopView", () => {
  const last = frames.length - 1;
  // A run: the start, 15 moves, the mate held for three ticks, the fade (32 seconds).
  const length = 20;

  it("plays one move per tick from the start position", () => {
    expect([operaLoopView(0), operaLoopView(1), operaLoopView(last)]).toStrictEqual([
      { cycle: 0, frame: 0, mate: false, fading: false },
      { cycle: 0, frame: 1, mate: false, fading: false },
      { cycle: 0, frame: last, mate: false, fading: false }
    ]);
  });

  it("then holds the mate, glowing, for three ticks", () => {
    expect([1, 2, 3].map((offset) => operaLoopView(last + offset))).toStrictEqual(
      Array.from({ length: 3 }, () => ({ cycle: 0, frame: last, mate: true, fading: false }))
    );
  });

  it("fades the pieces out on the run's last tick", () => {
    expect(operaLoopView(length - 1)).toStrictEqual({
      cycle: 0,
      frame: last,
      mate: true,
      fading: true
    });
  });

  it("replays from the start position as a new run", () => {
    expect(operaLoopView(length)).toStrictEqual({
      cycle: 1,
      frame: 0,
      mate: false,
      fading: false
    });
  });

  it("shows the final mate, still, under reduced motion", () => {
    expect(operaLoopFinalView()).toStrictEqual({
      cycle: 0,
      frame: last,
      mate: true,
      fading: false
    });
  });
});
