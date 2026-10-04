import { describe, expect, it } from "vitest";
import type { GameOpening } from "../types/engine";
import {
  gamePhases,
  isEndgamePosition,
  majorAndMinorPieces,
  OPENING_PLIES_WITHOUT_BOOK,
  phaseOfPly
} from "./game-phases";
import { START_FEN } from "./position";

/** Two rooks, two bishops and two knights: six pieces, the most an endgame has. */
const SIX_PIECES = "r1b1k3/8/2n5/8/8/2N5/8/R1B1K3 w - - 0 30";
/** The same with one more knight: still a middlegame. */
const SEVEN_PIECES = "r1b1k3/8/2n5/8/8/2N2N2/8/R1B1K3 w - - 0 28";

function opening(bookEndPly: number): GameOpening {
  return { eco: "C50", name: "Italian Game", ply: bookEndPly, bookEndPly, firstNonBookMove: null };
}

/** A game of `length` plies: the start position until `endgameFrom`, six pieces from there. */
function game(length: number, endgameFrom: number | null) {
  return Array.from({ length }, (_, index) => {
    const ply = index + 1;
    const fenBefore =
      endgameFrom !== null && ply >= endgameFrom ? SIX_PIECES : ply > 30 ? SEVEN_PIECES : START_FEN;
    return { ply, fenBefore };
  });
}

describe("game phases", () => {
  it("counts queens, rooks, bishops and knights, not kings or pawns", () => {
    expect(majorAndMinorPieces(START_FEN)).toBe(14);
    expect(majorAndMinorPieces(SIX_PIECES)).toBe(6);
    expect(isEndgamePosition(SIX_PIECES)).toBe(true);
    expect(isEndgamePosition(SEVEN_PIECES)).toBe(false);
    expect(isEndgamePosition("8/8/4k3/8/8/4K3/4P3/8 w - - 0 60")).toBe(true);
  });

  it("ends the opening with the book and starts the endgame at the first move from six pieces", () => {
    const phases = gamePhases(game(80, 61), opening(7));
    expect(phases).toEqual({ openingEnd: 7, endgameStart: 61 });
    expect(phaseOfPly(1, phases)).toBe("opening");
    expect(phaseOfPly(7, phases)).toBe("opening");
    expect(phaseOfPly(8, phases)).toBe("middlegame");
    expect(phaseOfPly(60, phases)).toBe("middlegame");
    expect(phaseOfPly(61, phases)).toBe("endgame");
    expect(phaseOfPly(80, phases)).toBe("endgame");
  });

  it("takes the first 20 plies as the opening without book data, and none without a named position", () => {
    expect(gamePhases(game(40, null), undefined)).toEqual({
      openingEnd: OPENING_PLIES_WITHOUT_BOOK,
      endgameStart: null
    });
    const setUp = gamePhases(game(10, 1), null);
    expect(setUp).toEqual({ openingEnd: 0, endgameStart: 1 });
    expect(phaseOfPly(1, setUp)).toBe("endgame");
  });

  it("starts an endgame reached inside the book only after the book", () => {
    const phases = gamePhases(game(20, 3), opening(6));
    expect(phases).toEqual({ openingEnd: 6, endgameStart: 7 });
    expect(phaseOfPly(6, phases)).toBe("opening");
    expect(phaseOfPly(7, phases)).toBe("endgame");
  });
});
