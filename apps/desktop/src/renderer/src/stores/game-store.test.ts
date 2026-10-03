import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import { buildEngineGoClock, clockNow, noteSystemResumed, remainingClockMs, setTimeAsleepSource, useGameStore } from "./game-store";

/** Moves both time sources together (the clock treats a wall-only jump as time asleep). */
function mockTime() {
  const monotonic = vi.spyOn(performance, "now");
  const wall = vi.spyOn(Date, "now");
  const at = (ms: number) => {
    monotonic.mockReturnValue(ms);
    wall.mockReturnValue(1_700_000_000_000 + ms);
  };
  return at;
}

describe("game store", () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  // Clock tests mock the time sources; a failed assertion must not leave them mocked.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes a selected move and its descendants", () => {
    expect(useGameStore.getState().makeMove({ from: "e2", to: "e4" })).toBe(true);
    const e4NodeId = useGameStore.getState().currentNodeId;

    expect(useGameStore.getState().makeMove({ from: "e7", to: "e5" })).toBe(true);
    const e5NodeId = useGameStore.getState().currentNodeId;

    expect(useGameStore.getState().deleteLineFromNode(e4NodeId)).toBe(true);

    const state = useGameStore.getState();
    expect(state.currentNodeId).toBe("root");
    expect(state.moveTree.some((node) => node.id === e4NodeId || node.id === e5NodeId)).toBe(false);
    expect(state.moveTree.find((node) => node.id === "root")?.children).toEqual([]);
  });

  it("keeps the committed node and FEN invariant while creating variations", () => {
    useGameStore.getState().makeMove({ from: "e2", to: "e4" });
    const e4NodeId = useGameStore.getState().currentNodeId;
    useGameStore.getState().makeMove({ from: "e7", to: "e5" });
    useGameStore.getState().undo();

    expect(useGameStore.getState().currentNodeId).toBe(e4NodeId);
    expect(useGameStore.getState().makeMove({ from: "c7", to: "c5" })).toBe(true);
    const state = useGameStore.getState();
    const currentNode = state.moveTree.find((node) => node.id === state.currentNodeId);
    expect(currentNode?.san).toBe("c5");
    expect(state.currentFen).toBe(currentNode?.fenAfter);
    expect(state.moveTree.find((node) => node.id === e4NodeId)?.children).toHaveLength(2);
  });

  it("does not move the cursor when deleting a different branch", () => {
    useGameStore.getState().makeMove({ from: "e2", to: "e4" });
    useGameStore.getState().makeMove({ from: "e7", to: "e5" });
    useGameStore.getState().undo();
    useGameStore.getState().undo();
    useGameStore.getState().makeMove({ from: "d2", to: "d4" });
    const currentNodeId = useGameStore.getState().currentNodeId;
    const currentFen = useGameStore.getState().currentFen;
    const e4NodeId = useGameStore.getState().moveTree.find((node) => node.san === "e4")?.id;
    expect(e4NodeId).toBeDefined();
    expect(useGameStore.getState().deleteLineFromNode(e4NodeId!)).toBe(true);
    expect(useGameStore.getState().currentNodeId).toBe(currentNodeId);
    expect(useGameStore.getState().currentFen).toBe(currentFen);
  });

  it("normalizes a mismatched loaded cursor to the requested node FEN", () => {
    useGameStore.getState().makeMove({ from: "e2", to: "e4" });
    const e4NodeId = useGameStore.getState().currentNodeId;
    useGameStore.getState().makeMove({ from: "e7", to: "e5" });
    const e5Fen = useGameStore.getState().currentFen;
    const session = useGameStore.getState().toSession();
    useGameStore.getState().loadGame({ ...session, currentNodeId: e4NodeId, currentFen: e5Fen });
    const state = useGameStore.getState();
    expect(state.currentNodeId).toBe(e4NodeId);
    expect(state.currentFen).not.toBe(e5Fen);
    expect(state.currentFen).toBe(state.moveTree.find((node) => node.id === e4NodeId)?.fenAfter);
  });

  it("clears the engine side and counts a new board on every load or reset", () => {
    const store = useGameStore.getState();
    store.setMode("engine");
    store.setEngineSide("white");
    const before = useGameStore.getState().board;
    store.loadGame(store.toSession());
    expect(useGameStore.getState().engineSide).toBeNull();
    expect(useGameStore.getState().board).toBe(before + 1);
    useGameStore.getState().reset();
    expect(useGameStore.getState().board).toBe(before + 2);
  });

  it("does not delete the root position", () => {
    expect(useGameStore.getState().deleteLineFromNode("root")).toBe(false);
    expect(useGameStore.getState().currentNodeId).toBe("root");
  });

  it("rejects illegal engine moves and accepts legal UCI moves", () => {
    expect(useGameStore.getState().makeUciMove("e2e5")).toBe(false);
    expect(useGameStore.getState().lastError).toContain("illegal move");

    expect(useGameStore.getState().makeUciMove("e2e4")).toBe(true);
    expect(useGameStore.getState().lastError).toBeNull();
    expect(useGameStore.getState().currentFen).toContain(" b ");
  });

  it("supports navigation, annotations, orientation, and session export", () => {
    useGameStore.getState().makeMove({ from: "e2", to: "e4" });
    const e4NodeId = useGameStore.getState().currentNodeId;
    useGameStore.getState().makeMove({ from: "e7", to: "e5" });
    const e5NodeId = useGameStore.getState().currentNodeId;

    useGameStore.getState().undo();
    expect(useGameStore.getState().currentNodeId).toBe(e4NodeId);
    useGameStore.getState().redo();
    expect(useGameStore.getState().currentNodeId).toBe(e5NodeId);

    useGameStore.getState().flip();
    useGameStore.getState().setNodeAnnotations(e5NodeId, {
      arrows: [{ orig: "e2", dest: "e4", color: "green" }],
      highlights: [{ square: "e4", color: "yellow" }]
    });

    expect(useGameStore.getState().orientation).toBe("black");
    expect(useGameStore.getState().toSession().pgn).toContain("1. e4 e5");
    expect(useGameStore.getState().moveTree.find((node) => node.id === e5NodeId)?.arrows).toHaveLength(1);
  });

  it("finishes engine matches through draw, resign, and timeout paths", () => {
    useGameStore.getState().setMode("engine");
    useGameStore.getState().setEngineSide("black");

    useGameStore.getState().agreeDraw();
    expect(useGameStore.getState().gameOutcome).toEqual({
      result: "1/2-1/2",
      termination: "Draw by agreement"
    });

    useGameStore.getState().reset();
    useGameStore.getState().setMode("engine");
    useGameStore.getState().setEngineSide("black");
    useGameStore.getState().resign();
    expect(useGameStore.getState().gameOutcome).toMatchObject({ result: "0-1" });

    useGameStore.getState().reset();
    useGameStore.getState().resolveTimeout("black");
    expect(useGameStore.getState().gameOutcome).toMatchObject({
      result: "1-0",
      termination: "Time forfeit"
    });
  });

  it("builds UCI clock snapshots and advances live clocks after moves", () => {
    const at = mockTime();
    at(1_000);
    useGameStore.getState().setEngineMatchClock({ initialMs: 10_000, incrementMs: 500 });
    useGameStore.getState().initEngineClockLive();
    at(2_500);
    expect(useGameStore.getState().engineClockLive).toMatchObject({
      whiteMs: 10_000,
      blackMs: 10_000,
      sideToMove: "white"
    });

    expect(useGameStore.getState().makeMove({ from: "e2", to: "e4" })).toBe(true);
    expect(useGameStore.getState().engineClockLive).toMatchObject({
      whiteMs: 9_000,
      blackMs: 10_000,
      sideToMove: "black"
    });
    vi.restoreAllMocks();
  });

  it("a move after the flag fell loses on time, and the increment can't revive the clock", () => {
    const at = mockTime();
    at(0);
    useGameStore.getState().setMode("engine");
    useGameStore.getState().setEngineSide("black");
    useGameStore.getState().setEngineMatchClock({ initialMs: 1_000, incrementMs: 1_000 });
    useGameStore.getState().initEngineClockLive();

    at(1_100);
    const rejectedBefore = useGameStore.getState().rejectedMoves;
    expect(useGameStore.getState().makeMove({ from: "e2", to: "e4" })).toBe(false);
    const state = useGameStore.getState();
    expect(state.gameOutcome).toEqual({ result: "0-1", termination: "Time forfeit" });
    expect(state.moveTree).toHaveLength(1);
    const live = state.engineClockLive;
    expect(live && live.stoppedAt !== undefined ? live.stoppedAt - live.turnStartedAt : null).toBe(1_100);
    expect(state.rejectedMoves).toBe(rejectedBefore + 1);
  });

  it("a move just in time keeps the clock and adds the increment", () => {
    const at = mockTime();
    at(0);
    useGameStore.getState().setMode("engine");
    useGameStore.getState().setEngineSide("black");
    useGameStore.getState().setEngineMatchClock({ initialMs: 1_000, incrementMs: 1_000 });
    useGameStore.getState().initEngineClockLive();

    at(900);
    expect(useGameStore.getState().makeMove({ from: "e2", to: "e4" })).toBe(true);
    expect(useGameStore.getState().engineClockLive).toMatchObject({ whiteMs: 1_100, sideToMove: "black" });
  });

  it("the match clock ignores wall-clock changes but counts time asleep", () => {
    const at = mockTime();
    const wall = vi.spyOn(Date, "now");
    at(10_000);
    const start = clockNow();

    // The system clock jumps (either way): no time is added or removed.
    at(11_000);
    wall.mockReturnValue(1_700_000_000_000 + 11_000 + 3_600_000);
    expect(clockNow() - start).toBe(1_000);

    // Ten minutes asleep: the wall clock jumps past the monotonic one, so main's total is read.
    const reads = vi.fn(() => 600_000);
    setTimeAsleepSource(reads);
    at(12_000);
    clockNow();
    expect(reads).not.toHaveBeenCalled(); // the clocks agree: nothing to ask main
    vi.spyOn(performance, "now").mockReturnValue(12_050);
    wall.mockReturnValue(1_700_000_000_000 + 12_000 + 600_000);
    expect(clockNow() - start).toBe(2_050 + 600_000);
    expect(reads).toHaveBeenCalledTimes(1);
    // A sub-second sleep is read at once, before the wake notice arrives.
    reads.mockReturnValue(600_400);
    vi.spyOn(performance, "now").mockReturnValue(12_100);
    wall.mockReturnValue(1_700_000_000_000 + 12_000 + 600_000 + 50 + 400);
    expect(clockNow() - start).toBe(2_100 + 600_400);
    expect(reads).toHaveBeenCalledTimes(2);
    // Millisecond jitter between the clocks doesn't ask main.
    vi.spyOn(performance, "now").mockReturnValue(12_200);
    wall.mockReturnValue(1_700_000_000_000 + 12_000 + 600_000 + 150 + 400 + 3);
    clockNow();
    expect(reads).toHaveBeenCalledTimes(2);
    // A sleep the drift check can't see at all: the wake notice makes the next check read it.
    reads.mockReturnValue(600_410);
    noteSystemResumed();
    expect(clockNow() - start).toBe(2_200 + 600_410);
    setTimeAsleepSource(() => 0);
  });

  describe("goToLine", () => {
    const pgn = "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 *";
    const mainlineNode = (ply: number) => {
      const state = useGameStore.getState();
      let node = state.moveTree.find((item) => item.id === "root");
      for (let index = 0; index < ply; index += 1) node = state.moveTree.find((item) => item.id === node?.children[0]);
      if (!node) throw new Error(`no mainline node at ply ${ply}`);
      return node;
    };

    it("walks existing main-line moves without adding nodes", () => {
      useGameStore.getState().loadGame(importPgnText(pgn).game);
      const size = useGameStore.getState().moveTree.length;
      expect(useGameStore.getState().goToLine("root", ["e4", "e5", "Nf3"])).toBe(true);
      const state = useGameStore.getState();
      expect(state.moveTree).toHaveLength(size);
      expect(state.currentNodeId).toBe(mainlineNode(3).id);
      expect(state.currentFen).toBe(mainlineNode(3).fenAfter);
    });

    it("appends a new variation, selects its last node and reuses it next time", () => {
      useGameStore.getState().loadGame(importPgnText(pgn).game);
      useGameStore.getState().setMode("analysis");
      const parent = mainlineNode(6);
      expect(useGameStore.getState().goToLine(parent.id, ["Nxd4", "exd4", "O-O"])).toBe(true);
      const state = useGameStore.getState();
      const current = state.moveTree.find((node) => node.id === state.currentNodeId);
      expect(current?.san).toBe("O-O");
      expect(state.currentFen).toBe(current?.fenAfter);
      expect(state.moveTree.find((node) => node.id === parent.id)?.children).toHaveLength(2);
      expect(state.mode).toBe("analysis");
      const size = state.moveTree.length;
      expect(useGameStore.getState().goToLine(parent.id, ["Nxd4", "exd4"])).toBe(true);
      expect(useGameStore.getState().moveTree).toHaveLength(size);
      expect(useGameStore.getState().currentNodeId).toBe(current?.parentId);
    });

    it("accepts UCI moves and rejects illegal lines without changing anything", () => {
      useGameStore.getState().loadGame(importPgnText(pgn).game);
      const before = useGameStore.getState();
      expect(useGameStore.getState().goToLine("root", ["e2e4", "e5", "Qh5"])).toBe(true);
      expect(useGameStore.getState().currentFen).toContain("4p2Q/4P3");
      const afterValid = useGameStore.getState().moveTree.length;
      expect(useGameStore.getState().goToLine("root", ["e4", "Ke3"])).toBe(false);
      expect(useGameStore.getState().goToLine("missing", ["e4"])).toBe(false);
      expect(useGameStore.getState().moveTree).toHaveLength(afterValid);
      expect(afterValid).toBe(before.moveTree.length + 1);
    });

    it("does not branch a live engine match", () => {
      useGameStore.getState().makeMove({ from: "e2", to: "e4" });
      useGameStore.getState().setMode("engine");
      useGameStore.getState().setEngineSide("black");
      expect(useGameStore.getState().goToLine("root", ["d4"])).toBe(false);
      expect(useGameStore.getState().goToLine("root", ["e4"])).toBe(true);
    });
  });

  it("buildEngineGoClock clamps elapsed time and increments", () => {
    expect(
      buildEngineGoClock(
        { whiteMs: 10, blackMs: 20, turnStartedAt: 0, sideToMove: "white" },
        { initialMs: 30, incrementMs: -5 },
        100
      )
    ).toEqual({ wtime: 1, btime: 20, winc: 0, binc: 0 });
  });

  describe("online games", () => {
    const mainline = () => {
      const { moveTree } = useGameStore.getState();
      const sans: string[] = [];
      let node = moveTree.find((item) => item.parentId === null);
      while (node?.children[0]) {
        node = moveTree.find((item) => item.id === node?.children[0]);
        if (node?.san) sans.push(node.san);
      }
      return sans;
    };

    beforeEach(() => {
      useGameStore.getState().setMode("online");
      useGameStore.getState().setEngineSide("black");
    });

    it("appends the server's new moves and follows them when on the last move", () => {
      expect(useGameStore.getState().syncMainline(["e2e4", "e7e5"])).toBe(true);
      expect(mainline()).toEqual(["e4", "e5"]);
      expect(useGameStore.getState().syncMainline(["e2e4", "e7e5", "g1f3"])).toBe(true);
      expect(mainline()).toEqual(["e4", "e5", "Nf3"]);
      const state = useGameStore.getState();
      expect(state.moveTree.find((node) => node.id === state.currentNodeId)?.san).toBe("Nf3");
    });

    it("keeps the cursor where the user is browsing", () => {
      useGameStore.getState().syncMainline(["e2e4", "e7e5"]);
      useGameStore.getState().undo();
      const browsing = useGameStore.getState().currentNodeId;
      useGameStore.getState().syncMainline(["e2e4", "e7e5", "g1f3"]);
      expect(useGameStore.getState().currentNodeId).toBe(browsing);
    });

    it("replaces a move the server doesn't have", () => {
      useGameStore.getState().syncMainline(["e2e4", "e7e5"]);
      expect(useGameStore.getState().makeMove({ from: "g1", to: "f3" })).toBe(true);
      expect(useGameStore.getState().syncMainline(["e2e4", "e7e5"])).toBe(true);
      expect(mainline()).toEqual(["e4", "e5"]);
      expect(useGameStore.getState().moveTree).toHaveLength(3);
    });

    it("only plays at the end of the game", () => {
      useGameStore.getState().syncMainline(["e2e4", "e7e5"]);
      useGameStore.getState().undo();
      expect(useGameStore.getState().makeMove({ from: "d7", to: "d5" })).toBe(false);
      expect(mainline()).toEqual(["e4", "e5"]);
    });

    it("rejects an illegal server move", () => {
      expect(useGameStore.getState().syncMainline(["e2e5"])).toBe(false);
    });

    it("ends the match once, with the server's result, and freezes the clocks", () => {
      useGameStore.getState().setMatchClock({ whiteMs: 60_000, blackMs: 55_000, sideToMove: "white", running: true });
      useGameStore.getState().endMatch("0-1", "Resignation");
      useGameStore.getState().endMatch("1-0", "Time forfeit");
      const state = useGameStore.getState();
      expect(state.gameOutcome).toEqual({ result: "0-1", termination: "Resignation" });
      expect(state.engineClockLive?.stoppedAt).toBeTypeOf("number");
    });
  });

  describe("restoreView", () => {
    it("brings back a finished engine game with its result", () => {
      useGameStore.getState().makeMove({ from: "e2", to: "e4" });
      const node = useGameStore.getState().currentNodeId;
      useGameStore.getState().undo();
      useGameStore.getState().restoreView({
        currentNodeId: node,
        mode: "engine",
        source: "engine-game",
        engineSide: "black",
        orientation: "white",
        gameOutcome: { result: "1-0", termination: "Player resign" }
      });
      const state = useGameStore.getState();
      expect(state).toMatchObject({ mode: "engine", engineSide: "black", currentNodeId: node });
      expect(state.gameOutcome?.result).toBe("1-0");
    });

    it("keeps an engine game that ended on the board (mate) as an engine game", () => {
      for (const [from, to] of [["f2", "f3"], ["e7", "e5"], ["g2", "g4"], ["d8", "h4"]] as const) {
        useGameStore.getState().makeMove({ from, to });
      }
      const mate = useGameStore.getState().currentNodeId;
      useGameStore.getState().restoreView({ currentNodeId: mate, mode: "engine", source: "engine-game", engineSide: "black", orientation: "white", gameOutcome: null });
      expect(useGameStore.getState()).toMatchObject({ mode: "engine", engineSide: "black" });
      // Recorded as over: stepping back to an earlier move must not let the engine play on.
      expect(useGameStore.getState().gameOutcome).toEqual({ result: "0-1", termination: "checkmate" });
      // Deleting the mating move: the game isn't finished any more.
      useGameStore.getState().deleteLineFromNode(mate);
      expect(useGameStore.getState().gameOutcome).toBeNull();
    });

    it("turns a match still being played (or a live online game) into a free board", () => {
      for (const mode of ["engine", "online"] as const) {
        useGameStore.getState().restoreView({ currentNodeId: "root", mode, source: "new", engineSide: "black", orientation: "white", gameOutcome: null });
        expect(useGameStore.getState()).toMatchObject({ mode: "freeplay", engineSide: null, engineClockLive: null });
      }
    });

    it("keeps the cursor where it is when the saved node no longer exists", () => {
      useGameStore.getState().makeMove({ from: "e2", to: "e4" });
      const node = useGameStore.getState().currentNodeId;
      useGameStore.getState().restoreView({ currentNodeId: "gone", mode: "analysis", source: "analysis", engineSide: null, orientation: "black", gameOutcome: null });
      expect(useGameStore.getState()).toMatchObject({ currentNodeId: node, mode: "analysis", orientation: "black" });
    });
  });
});

describe("engine clock pause", () => {
  it("freezes the running clock and resumes it without charging the pause", () => {
    const at = mockTime();
    at(0);
    const game = useGameStore.getState();
    game.reset();
    game.setMode("engine");
    game.setEngineSide("white");
    game.setEngineMatchClock({ initialMs: 10_000, incrementMs: 0 });
    game.initEngineClockLive();

    at(2_000);
    useGameStore.getState().pauseEngineClock();
    expect(useGameStore.getState().engineClockLive).toMatchObject({ stoppedAt: 2_000, paused: true });

    at(60_000);
    useGameStore.getState().resumeEngineClock();
    const live = useGameStore.getState().engineClockLive!;
    expect(live.stoppedAt).toBeUndefined();
    expect(remainingClockMs(live, "white", 61_000)).toBe(7_000);
    vi.restoreAllMocks();
  });

  it("a move made while paused charges the side that moved, from the pause", () => {
    const at = mockTime();
    at(0);
    const game = useGameStore.getState();
    game.reset();
    game.setMode("engine");
    game.setEngineSide("black");
    game.setEngineMatchClock({ initialMs: 10_000, incrementMs: 0 });
    game.initEngineClockLive();
    at(1_000);
    expect(useGameStore.getState().makeMove({ from: "e2", to: "e4" })).toBe(true); // White: 9 s left
    at(1_500);
    useGameStore.getState().pauseEngineClock(); // stepped back while Black (the engine) thought
    useGameStore.getState().goToNode("root");
    // An illegal attempt leaves the clock paused.
    expect(useGameStore.getState().makeMove({ from: "d2", to: "d5" })).toBe(false);
    expect(useGameStore.getState().engineClockLive?.paused).toBe(true);
    at(4_500);
    expect(useGameStore.getState().makeMove({ from: "d2", to: "d4" })).toBe(true);
    const live = useGameStore.getState().engineClockLive!;
    // White is charged the 3 s since the pause, Black keeps its time, and it's Black's turn.
    expect(live).toMatchObject({ whiteMs: 6_000, blackMs: 10_000, sideToMove: "black" });
    expect(live.paused).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("a move made after the pause used up the mover's time loses on time", () => {
    const monotonic = vi.spyOn(performance, "now");
    const wall = vi.spyOn(Date, "now");
    const at = (ms: number) => {
      monotonic.mockReturnValue(ms);
      wall.mockReturnValue(1_700_000_000_000 + ms);
    };
    at(0);
    const game = useGameStore.getState();
    game.reset();
    game.setMode("engine");
    game.setEngineSide("black");
    game.setEngineMatchClock({ initialMs: 10_000, incrementMs: 2_000 });
    game.initEngineClockLive();
    at(1_000);
    useGameStore.getState().makeMove({ from: "e2", to: "e4" }); // White: 10 - 1 + 2 = 11 s
    at(1_500);
    useGameStore.getState().pauseEngineClock();
    useGameStore.getState().goToNode("root");
    const before = useGameStore.getState().moveTree.length;
    const rejected = useGameStore.getState().rejectedMoves;
    // 10 s later: more than the 9 s White had before e4's increment, so the replacement is too late.
    at(11_500);
    expect(useGameStore.getState().makeMove({ from: "d2", to: "d4" })).toBe(false);
    const state = useGameStore.getState();
    // Counted as refused, so the board takes back the piece it moved.
    expect(state.rejectedMoves).toBe(rejected + 1);
    expect(state.gameOutcome).toEqual({ result: "0-1", termination: "Time forfeit" });
    expect(state.moveTree).toHaveLength(before);
    expect(remainingClockMs(state.engineClockLive!, "white", 1_700_000_020_000)).toBe(0);
    expect(remainingClockMs(state.engineClockLive!, "black", 1_700_000_020_000)).toBe(10_000);
    vi.restoreAllMocks();
  });

  it("a replacement move earns its increment once, not on top of the replaced move's", () => {
    const at = mockTime();
    at(0);
    const game = useGameStore.getState();
    game.reset();
    game.setMode("engine");
    game.setEngineSide("black");
    game.setEngineMatchClock({ initialMs: 10_000, incrementMs: 2_000 });
    game.initEngineClockLive();
    at(1_000);
    useGameStore.getState().makeMove({ from: "e2", to: "e4" }); // White: 10 - 1 + 2 = 11 s
    expect(useGameStore.getState().engineClockLive?.whiteMs).toBe(11_000);
    for (const [from, to] of [["d2", "d4"], ["c2", "c4"], ["g1", "f3"]] as const) {
      useGameStore.getState().pauseEngineClock();
      useGameStore.getState().goToNode("root");
      useGameStore.getState().makeMove({ from, to }); // replaced at once: no time spent
    }
    // Still 11 s: replacing the move again and again doesn't add time.
    expect(useGameStore.getState().engineClockLive).toMatchObject({ whiteMs: 11_000, sideToMove: "black" });
    vi.restoreAllMocks();
  });
});

describe("clockNow after a renderer reload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("starts from main's current total, so earlier sleeps never jump a new clock", async () => {
    let total = 3_600_000; // an hour asleep before this renderer (re)loaded
    vi.stubGlobal("window", { chaturanga: { system: { timeAsleepMs: () => total } } });
    vi.resetModules();
    const store = await import("./game-store");
    const monotonic = vi.spyOn(performance, "now").mockReturnValue(1_000);
    const wall = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const start = store.clockNow();
    // Asleep another 500 ms: only that is added.
    total += 500;
    monotonic.mockReturnValue(2_000);
    wall.mockReturnValue(1_700_000_000_000 + 1_000 + 500);
    expect(store.clockNow() - start).toBe(1_500);
  });
});
