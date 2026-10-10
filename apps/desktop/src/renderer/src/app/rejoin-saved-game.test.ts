import { describe, expect, it } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { MoveNode, SavedGame } from "@chaturanga/shared/types/chess";
import {
  rejoinNotice,
  savedEngineClock,
  savedEngineMatch,
  timeForfeitSave,
  yourSide
} from "./rejoin-saved-game";

const stockfish = { id: "sf", name: "Stockfish (managed)", isAvailable: true };
const customStockfish = { id: "sf-custom", name: "Stockfish", isAvailable: true };
const maia = { id: "m15", name: "Maia 1500 (managed)", isAvailable: false };

describe("rejoining a saved engine game", () => {
  it("plays on against the installed engine named in the game, as the side you had", () => {
    expect(savedEngineMatch({ white: "You", black: "Stockfish" }, [maia, stockfish])).toEqual({
      engine: stockfish,
      engineSide: "black",
      humanSide: "white"
    });
    // Saved by an older build with the managed marker in the name.
    expect(
      savedEngineMatch({ white: "Stockfish (managed)", black: "You" }, [stockfish])
    ).toMatchObject({ engine: stockfish, engineSide: "white", humanSide: "black" });
  });

  it("finds the engine by the id the game saved, even when another shares its name", () => {
    const headers = { white: "You", black: "Stockfish", engineId: "sf-custom" };
    expect(savedEngineMatch(headers, [stockfish, customStockfish])?.engine).toBe(customStockfish);
    // That engine since removed: the name decides, as for a game saved before ids were kept.
    expect(savedEngineMatch(headers, [stockfish])?.engine).toBe(stockfish);
    // Installed but unavailable: not played on (nor against another of the same name).
    const off = { ...customStockfish, isAvailable: false };
    expect(savedEngineMatch(headers, [stockfish, off])).toBeNull();
  });

  it("only opens the game when its engine is missing or unavailable, or the sides are unclear", () => {
    expect(savedEngineMatch({ white: "You", black: "Komodo" }, [stockfish])).toBeNull();
    expect(savedEngineMatch({ white: "Maia 1500", black: "You" }, [maia])).toBeNull();
    expect(savedEngineMatch({ white: "Alpha", black: "Stockfish" }, [stockfish])).toBeNull();
    expect(savedEngineMatch({ white: "You", black: "You" }, [stockfish])).toBeNull();
    expect(savedEngineMatch({ white: "You", black: "" }, [stockfish])).toBeNull();
  });

  it("says why a game only opened", () => {
    expect(rejoinNotice({ white: "You", black: "Komodo" }, [stockfish])).toBe(
      "Komodo isn't installed, so the game opened on the board."
    );
    expect(rejoinNotice({ white: "Maia 1500 (managed)", black: "You" }, [maia])).toBe(
      "Maia 1500 isn't available, so the game opened on the board."
    );
    expect(rejoinNotice({ white: "You", black: "Stockfish" }, [stockfish])).toBeNull();
    expect(rejoinNotice({ white: "Alpha", black: "Beta" }, [stockfish])).toBeNull();
  });

  it("knows your side only when exactly one side is You", () => {
    expect(yourSide("You", "Stockfish")).toBe("white");
    expect(yourSide("Stockfish", " you ")).toBe("black");
    expect(yourSide("You", "you")).toBeNull();
    expect(yourSide("Alice", null)).toBeNull();
  });
});

/** 1. e4 e5 2. Nf3 in a 2+1 game, with the clocks and play times Play keeps. */
function timedTree(times: { clock: string; playedAt?: number }[]): MoveNode[] {
  const { moveTree } = importPgnText("1. e4 e5 2. Nf3 *").game;
  let move = 0;
  return moveTree.map((node) => {
    if (!node.san) return node;
    const time = times[move++];
    return time ? { ...node, clockAfter: time.clock, playedAt: time.playedAt } : node;
  });
}

describe("savedEngineClock", () => {
  const T = 1_700_000_000_000;

  it("runs the side to move's clock from its turn's start, also while the game was away", () => {
    const tree = timedTree([
      { clock: "0:02:00", playedAt: T },
      { clock: "0:01:58.5", playedAt: T + 3_000 },
      { clock: "0:01:55", playedAt: T + 10_000 }
    ]);
    // Black to move after Nf3: 40 s gone since.
    expect(savedEngineClock(tree, "120+1", T + 50_000)).toMatchObject({
      config: { initialMs: 120_000, incrementMs: 1_000 },
      whiteMs: 115_000,
      blackMs: 78_500,
      sideToMove: "black",
      nodeId: tree.at(-1)?.id,
      flagged: null
    });
  });

  it("starts a side that hasn't moved at the time control's start", () => {
    const tree = timedTree([{ clock: "0:02:00", playedAt: T }]);
    expect(savedEngineClock(tree.slice(0, 2), "120+1", T + 5_000)).toMatchObject({
      whiteMs: 120_000,
      blackMs: 115_000,
      sideToMove: "black"
    });
  });

  it("ends a game whose side to move ran out meanwhile on time, drawn without mating material", () => {
    const tree = timedTree([
      { clock: "0:02:00", playedAt: T },
      { clock: "0:01:58", playedAt: T + 2_000 },
      { clock: "0:01:00", playedAt: T + 60_000 }
    ]);
    expect(savedEngineClock(tree, "120+1", T + 60_000 + 118_000)?.flagged).toEqual({
      result: "1-0",
      termination: "Time forfeit"
    });
    expect(savedEngineClock(tree, "120+1", T + 60_000 + 117_000)?.flagged).toBeNull();
  });

  it("is null for an untimed game and one saved before engine games kept their clocks", () => {
    const tree = timedTree([{ clock: "0:02:00", playedAt: T }]);
    expect(savedEngineClock(tree, "-", T)).toBeNull();
    expect(savedEngineClock(timedTree([]), "120+1", T)).toBeNull();
  });

  it("goes on from the clocks without the time away when the play times are lost", () => {
    const tree = timedTree([{ clock: "0:01:59" }, { clock: "0:01:50" }]);
    expect(savedEngineClock(tree.slice(0, 3), "120+1", T)).toMatchObject({
      whiteMs: 119_000,
      blackMs: 110_000,
      sideToMove: "white"
    });
  });
});

describe("timeForfeitSave", () => {
  it("saves the game as it was, with the result and how it ended", () => {
    const { game } = importPgnText('[TimeControl "120+1"]\n\n1. e4 *');
    const saved = {
      ...game,
      id: "g1",
      source: "engine-game",
      white: "You",
      black: "Stockfish",
      event: null,
      result: "*",
      date: null,
      site: null,
      round: null,
      initialFen: game.rootFen,
      updatedAt: 1,
      reviewCount: 0,
      lastReviewedAt: null,
      review: null,
      reviews: []
    } satisfies SavedGame;
    const input = timeForfeitSave(saved, { result: "0-1", termination: "Time forfeit" });
    expect(input).toMatchObject({
      id: "g1",
      source: "engine-game",
      headers: { result: "0-1", termination: "Time forfeit", timeControl: "120+1" },
      moveTree: game.moveTree
    });
    expect(input).not.toHaveProperty("review");
    expect(input.pgn).toContain('[Result "0-1"]');
  });
});
