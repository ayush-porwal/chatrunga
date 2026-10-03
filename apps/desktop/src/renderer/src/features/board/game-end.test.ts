import { describe, expect, it } from "vitest";
import { celebratesEnding, liveEnding, type BoardEndState } from "./game-end";

const playing: BoardEndState = { ended: false, outcome: false, treeSize: 10, nodeId: "n9", puzzleSolved: false };

describe("liveEnding", () => {
  it("is a game ending when a move just played finishes it", () => {
    expect(
      liveEnding(playing, { ...playing, ended: true, treeSize: 11, nodeId: "n10", parentId: "n9", mode: "engine" })
    ).toBe("game");
  });

  it("is a game ending when a result is just decided (resignation, flag, agreement, Lichess)", () => {
    expect(liveEnding(playing, { ...playing, ended: true, outcome: true, parentId: "n8", mode: "engine" })).toBe("game");
    expect(liveEnding(playing, { ...playing, ended: true, outcome: true, parentId: "n8", mode: "online" })).toBe("game");
  });

  it("is nothing when stepping to the end of a finished game", () => {
    // The end was reached by moving the cursor: the tree didn't grow.
    expect(
      liveEnding({ ...playing, nodeId: "n8" }, { ...playing, ended: true, nodeId: "n9", parentId: "n8", mode: "freeplay" })
    ).toBeNull();
  });

  it("is nothing when a finished game is loaded", () => {
    expect(
      liveEnding(playing, { ...playing, ended: true, treeSize: 60, nodeId: "n59", parentId: "n58", mode: "freeplay" })
    ).toBeNull();
  });

  it("is nothing once the game was already over", () => {
    const over = { ...playing, ended: true, outcome: true };
    expect(liveEnding(over, { ...over, parentId: "n8", mode: "engine" })).toBeNull();
  });

  it("is a puzzle ending only when the puzzle was just solved", () => {
    expect(liveEnding(playing, { ...playing, puzzleSolved: true, parentId: "n8", mode: "puzzle" })).toBe("puzzle");
    const solved = { ...playing, puzzleSolved: true };
    expect(liveEnding(solved, { ...solved, parentId: "n8", mode: "puzzle" })).toBeNull();
    // A puzzle's final position (mate) is the puzzle's ending, not a game's.
    expect(
      liveEnding(playing, { ...playing, ended: true, treeSize: 11, nodeId: "n10", parentId: "n9", mode: "puzzle" })
    ).toBeNull();
  });
});

describe("celebratesEnding", () => {
  it("celebrates a solved puzzle", () => {
    expect(celebratesEnding("puzzle", { result: "*", mode: "puzzle", engineSide: null })).toBe(true);
  });

  it("celebrates the user's win against the engine or on Lichess", () => {
    expect(celebratesEnding("game", { result: "1-0", mode: "engine", engineSide: "black" })).toBe(true);
    expect(celebratesEnding("game", { result: "0-1", mode: "online", engineSide: "white" })).toBe(true);
  });

  it("never celebrates a loss, a draw, an aborted game or a game only watched", () => {
    expect(celebratesEnding("game", { result: "0-1", mode: "engine", engineSide: "black" })).toBe(false);
    expect(celebratesEnding("game", { result: "1/2-1/2", mode: "engine", engineSide: "black" })).toBe(false);
    expect(celebratesEnding("game", { result: "*", mode: "online", engineSide: "black" })).toBe(false);
    expect(celebratesEnding("game", { result: "1-0", mode: "freeplay", engineSide: null })).toBe(false);
  });

  it("never celebrates when nothing ended now", () => {
    expect(celebratesEnding(null, { result: "1-0", mode: "engine", engineSide: "black" })).toBe(false);
  });
});
