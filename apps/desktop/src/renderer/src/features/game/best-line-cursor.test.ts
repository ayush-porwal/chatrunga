import { describe, expect, it } from "vitest";
import {
  activeBestLine,
  bestLineSans,
  bestLineStep,
  openBestLine,
  stepBestLine,
  type BestLineCursor
} from "./best-line-cursor";

const moves = [
  { san: "Nxd4", uci: "f3d4", fenAfter: "fen-1" },
  { san: "exd4", uci: "e5d4", fenAfter: "fen-2" },
  { san: "O-O", uci: "e1g1", fenAfter: "fen-3" }
];
const line = (index: number): BestLineCursor => openBestLine("error", "before", moves, index)!;

describe("BEST line cursor", () => {
  it("opens on the move clicked, kept inside the line", () => {
    expect(line(1).index).toBe(1);
    expect(line(9).index).toBe(2);
    expect(line(-1).index).toBe(0);
    expect(openBestLine("error", "before", [], 0)).toBeNull();
  });

  it("steps forward along the line and stays on its last move past the end", () => {
    expect(stepBestLine(line(0), 1)).toEqual({ kind: "line", cursor: line(1) });
    expect(stepBestLine(line(2), 1)).toEqual({ kind: "line", cursor: line(2) });
    expect(stepBestLine(line(1), 5)).toEqual({ kind: "line", cursor: line(2) });
  });

  it("steps back along the line, then to the game move it branches from", () => {
    expect(stepBestLine(line(2), -1)).toEqual({ kind: "line", cursor: line(1) });
    expect(stepBestLine(line(0), -1)).toEqual({ kind: "game", nodeId: "before", stepsLeft: 0 });
    // Scrubbing further back carries on along the game from there.
    expect(stepBestLine(line(1), -4)).toEqual({ kind: "game", nodeId: "before", stepsLeft: -2 });
  });

  it("names the move on the board and the moves leading to it", () => {
    expect(bestLineStep(line(1)).fenAfter).toBe("fen-2");
    expect(bestLineSans(line(1))).toEqual(["Nxd4", "exd4"]);
    expect(bestLineSans(line(0))).toEqual(["Nxd4"]);
  });

  it("is active only while the game is on its error and the board on its move", () => {
    const bestLine = line(1);
    expect(activeBestLine({ bestLine, currentNodeId: "error", currentFen: "fen-2" })).toBe(
      bestLine
    );
    // Clicking a game move (even the error itself) or stepping away leaves it behind.
    expect(
      activeBestLine({ bestLine, currentNodeId: "error", currentFen: "error-fen" })
    ).toBeNull();
    expect(activeBestLine({ bestLine, currentNodeId: "other", currentFen: "fen-2" })).toBeNull();
    expect(
      activeBestLine({ bestLine: null, currentNodeId: "error", currentFen: "fen-2" })
    ).toBeNull();
  });
});
