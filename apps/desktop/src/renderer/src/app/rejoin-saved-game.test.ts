import { describe, expect, it } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { MoveNode, SavedGame } from "@chaturanga/shared/types/chess";
import {
  planRejoin,
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
    const time = times.at(move++);
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

describe("planRejoin", () => {
  const T = 1_700_000_000_000;
  const vsStockfish = { white: "You", black: "Stockfish", timeControl: "120+1" };
  /** 1. e4 e5 2. Nf3, played at T, T+3 s and T+10 s: Black to move since. */
  const played = timedTree([
    { clock: "0:02:00", playedAt: T },
    { clock: "0:01:58.5", playedAt: T + 3_000 },
    { clock: "0:01:55", playedAt: T + 10_000 }
  ]);
  const latest = played.at(-1)!.id;

  it("plays a timed game on from its latest move, with the time away taken off the side to move", () => {
    expect(
      planRejoin({ headers: vsStockfish, moveTree: played }, [stockfish], T + 50_000)
    ).toMatchObject({
      kind: "resume",
      engine: stockfish,
      engineSide: "black",
      humanSide: "white",
      nodeId: latest,
      clock: { whiteMs: 115_000, blackMs: 78_500, sideToMove: "black" }
    });
  });

  it("ends a timed game on time when the side to move ran out while away", () => {
    expect(
      planRejoin({ headers: vsStockfish, moveTree: played }, [stockfish], T + 10_000 + 118_500)
    ).toMatchObject({
      kind: "timed-out",
      engine: stockfish,
      nodeId: latest,
      clock: { blackMs: 0, sideToMove: "black" },
      outcome: { result: "1-0", termination: "Time forfeit" }
    });
  });

  it("draws a game lost on time when the side left can't mate", () => {
    // Black's lone king against a rook; White, to move, ran out of time.
    const { moveTree } = importPgnText(
      '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/R3K3 b - - 0 1"]\n\n1... Kd7 *'
    ).game;
    const tree = moveTree.map((node) =>
      node.san ? { ...node, clockAfter: "0:00:30", playedAt: T } : node
    );
    expect(
      planRejoin({ headers: vsStockfish, moveTree: tree }, [stockfish], T + 120_000)
    ).toMatchObject({
      kind: "timed-out",
      outcome: { result: "1/2-1/2", termination: "Time forfeit" }
    });
  });

  it("plays an untimed game, or one saved without its clocks, on untimed from the main line's end", () => {
    const { moveTree } = importPgnText("1. e4 e5 2. Nf3 *").game;
    for (const timeControl of ["-", "120+1"]) {
      expect(
        planRejoin({ headers: { ...vsStockfish, timeControl }, moveTree }, [stockfish], T)
      ).toEqual({
        kind: "resume",
        engine: stockfish,
        engineSide: "black",
        humanSide: "white",
        nodeId: moveTree.at(-1)!.id,
        clock: null
      });
    }
  });

  it("shows a game that is already over at its end instead of playing on", () => {
    const { moveTree } = importPgnText("1. f3 e5 2. g4 Qh4# *").game;
    expect(
      planRejoin({ headers: { ...vsStockfish, timeControl: "-" }, moveTree }, [stockfish], T)
    ).toEqual({ kind: "finished", nodeId: moveTree.at(-1)!.id });
  });

  it("only opens a game whose engine is missing or unavailable, saying why", () => {
    const game = { headers: vsStockfish, moveTree: played };
    expect(planRejoin(game, [maia], T)).toEqual({
      kind: "open",
      notice: "Stockfish isn't installed, so the game opened on the board."
    });
    expect(planRejoin(game, [{ ...stockfish, isAvailable: false }], T)).toEqual({
      kind: "open",
      notice: "Stockfish isn't available, so the game opened on the board."
    });
  });

  it("plays against the engine the game saved by id, not another of the same name", () => {
    const headers = { ...vsStockfish, engineId: "sf-custom" };
    expect(
      planRejoin({ headers, moveTree: played }, [stockfish, customStockfish], T + 50_000)
    ).toMatchObject({ kind: "resume", engine: customStockfish });
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
