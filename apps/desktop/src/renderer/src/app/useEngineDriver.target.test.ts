import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineBestMove, EngineError, EngineInfo } from "@chaturanga/shared/types/engine";
import { pausedAnalysisAt, type AnalysisTarget } from "../features/analysis/live-analysis";

// The hook runs outside React: each render (see render) walks its hooks in order, keeping each
// ref and re-running an effect only when its dependencies change, as React would. The engine
// calls go to the fakes below.
type EffectSlot = { deps: readonly unknown[] | undefined; cleanup: (() => void) | void };
const hooks = { slots: [] as unknown[], index: 0 };
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => (() => void) | void, deps?: readonly unknown[]) => {
    const index = hooks.index++;
    const previous = hooks.slots[index] as EffectSlot | undefined;
    const same =
      previous?.deps && deps?.every((value, at) => Object.is(value, previous.deps?.[at]));
    if (same) return;
    previous?.cleanup?.();
    hooks.slots[index] = { deps, cleanup: effect() } satisfies EffectSlot;
  },
  useRef: (current: unknown) => (hooks.slots[hooks.index++] ??= { current })
}));
/** Unmounts the hook: every effect's cleanup runs. */
function unmountDriver() {
  for (const slot of hooks.slots.splice(0)) {
    if (slot && typeof slot === "object" && "deps" in slot) (slot as EffectSlot).cleanup?.();
  }
}
const engines = {
  startAnalysis: vi.fn<
    (request: { searchId: string; fen: string; moves: string[]; fresh?: boolean }) => Promise<void>
  >(async () => {}),
  startGame: vi.fn<(request: { searchId: string }) => Promise<void>>(async () => {}),
  stop: vi.fn(async () => {})
};
/** What main sends: the driver's own handlers, called as an engine event arrives. */
const engineEvents = {
  info: (_info: EngineInfo) => {},
  bestMove: (_bestMove: EngineBestMove) => {},
  error: (_error: EngineError) => {}
};
vi.stubGlobal("window", globalThis);
vi.stubGlobal("chaturanga", {
  engines,
  system: { timeAsleepMs: () => 0, onResumed: () => () => {} },
  events: {
    onEngineInfo: (handler: (info: EngineInfo) => void) => {
      engineEvents.info = handler;
      return () => {};
    },
    onEngineBestMove: (handler: (bestMove: EngineBestMove) => void) => {
      engineEvents.bestMove = handler;
      return () => {};
    },
    onEngineError: (handler: (error: EngineError) => void) => {
      engineEvents.error = handler;
      return () => {};
    }
  }
});

const { useEngineDriver } = await import("./useEngineDriver");
const analysisOptions: Parameters<typeof useEngineDriver>[0] = {
  engineId: "sf",
  multipv: 3,
  depth: null,
  moveTimeMs: null,
  resources: ""
};
/** One render of `hook` (again: a re-render), its hooks walked from the first. */
function render(hook: () => void) {
  hooks.index = 0;
  hook();
}
const { useAnalysisStore } = await import("../stores/analysis-store");
const { useGameStore } = await import("../stores/game-store");

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Study's engine panel on 1. e4 of a chapter. */
const studyTarget: AnalysisTarget = {
  owner: "study:c1",
  nodeId: "n1",
  rootFen: START,
  moves: ["e2e4"],
  fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
};

/** Lets the driver's batched sync run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** What the last search started was of: the board's start position, or the study's move. */
function lastSearch(): "board" | "study" | null {
  const request = engines.startAnalysis.mock.calls.at(-1)?.[0];
  if (!request) return null;
  return request.moves.length ? "study" : "board";
}

/**
 * The board, analysed (an Analyze board at the start position), left for Study (its search
 * stopped, as showRepertoireView does), where the engine panel opens and searches its move.
 */
async function studyEngineOverAnalysedBoard() {
  expect(lastSearch()).toBe("board");
  void engines.stop();
  useAnalysisStore.getState().reset();
  useAnalysisStore.getState().setTarget(studyTarget);
  await settle();
  expect(lastSearch()).toBe("study");
  engines.startAnalysis.mockClear();
  engines.stop.mockClear();
}

describe("useEngineDriver", () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    useAnalysisStore.setState({ target: null });
    useAnalysisStore.getState().reset();
    vi.clearAllMocks();
    // The driver, mounted on an Analyze board: it searches the board's position.
    useGameStore.getState().setMode("analysis");
    render(() => useEngineDriver(analysisOptions));
  });

  afterEach(() => {
    unmountDriver();
    useAnalysisStore.setState({ target: null });
  });

  describe("useEngineDriver with a study's analysis target", () => {
    it("stops the study's search when its panel closes, without resuming the board behind Study", async () => {
      await studyEngineOverAnalysedBoard();
      // A restart the panel asked for itself (its Start) is still the study's.
      useAnalysisStore.getState().restartSearch();
      await settle();
      engines.startAnalysis.mockClear();
      useAnalysisStore.getState().setTarget(null);
      await settle();
      expect(engines.stop).toHaveBeenCalledWith();
      expect(engines.startAnalysis).not.toHaveBeenCalled();
      expect(useAnalysisStore.getState().status).toBe("idle");
    });

    it("hands the engine back to the board asked for before the panel unmounts (Back to an analysis board)", async () => {
      await studyEngineOverAnalysedBoard();
      // Back restores the board and asks for its search while Study is still mounted ...
      useAnalysisStore.getState().restartBoardSearch();
      await settle();
      // ... then Study unmounts, clearing its target.
      useAnalysisStore.getState().setTarget(null);
      await settle();
      expect(engines.stop).toHaveBeenCalledWith();
      expect(lastSearch()).toBe("board");
      expect(useAnalysisStore.getState().activeEngineId).toBe("sf");
      expect(useAnalysisStore.getState().status).toBe("thinking");
    });

    it("hands the engine back to the board asked for after the target cleared", async () => {
      await studyEngineOverAnalysedBoard();
      useAnalysisStore.getState().setTarget(null);
      useAnalysisStore.getState().restartBoardSearch();
      await settle();
      expect(lastSearch()).toBe("board");
      expect(useAnalysisStore.getState().status).toBe("thinking");
    });

    it("doesn't count a board request from before the panel opened", async () => {
      useAnalysisStore.getState().restartBoardSearch();
      await settle();
      await studyEngineOverAnalysedBoard();
      useAnalysisStore.getState().setTarget(null);
      await settle();
      expect(engines.startAnalysis).not.toHaveBeenCalled();
    });
  });

  describe("useEngineDriver when the engine quits during a search", () => {
    const line = (searchId: string, depth: number): EngineInfo => ({
      engineId: "sf",
      searchId,
      multipv: 1,
      depth,
      score: { type: "cp", value: 20 },
      pv: ["e2e4"],
      raw: "",
      receivedAt: 0
    });

    it("shows the lines it sent before quitting, and its analysis stays ended with the error", async () => {
      await settle();
      const searchId = engines.startAnalysis.mock.calls.at(-1)![0].searchId;
      // The first line shows at once; the next waits for the buffer's next flush.
      engineEvents.info(line(searchId, 1));
      engineEvents.info(line(searchId, 2));
      engineEvents.error({
        engineId: "sf",
        searchId,
        message: "sf quit during the search (exit 1)."
      });

      const analysis = useAnalysisStore.getState();
      expect(analysis.topLines.map((info) => info.depth)).toStrictEqual([2]);
      expect(analysis.status).toBe("error");
      expect(analysis.error).toBe("sf quit during the search (exit 1).");
    });

    it("stops the engine's clock in an engine game, without searching its position again", async () => {
      useAnalysisStore.getState().setActiveEngine("sf");
      const game = useGameStore.getState();
      game.setEngineMatchClock({ initialMs: 60_000, incrementMs: 0 });
      game.initEngineClockLive();
      game.setEngineSide("white");
      game.setMode("engine");
      await settle();
      expect(engines.startGame).toHaveBeenCalledTimes(1);
      expect(useGameStore.getState().engineClockLive?.stoppedAt).toBeUndefined();

      const searchId = engines.startGame.mock.calls[0][0].searchId;
      engineEvents.error({
        engineId: "sf",
        searchId,
        message: "sf quit during the search (exit 1)."
      });
      await settle();
      const state = useGameStore.getState();
      expect(state.engineClockLive?.stoppedAt).toBeTypeOf("number");
      expect(state.gameOutcome).toBeNull();
      expect(useAnalysisStore.getState().error).toBe("sf quit during the search (exit 1).");
      expect(engines.startGame).toHaveBeenCalledTimes(1);
    });
  });

  describe("useEngineDriver in a timed engine game", () => {
    it("keeps thinking when you step back, its clock running, and plays its move where it thought", async () => {
      useAnalysisStore.getState().setActiveEngine("sf");
      const game = useGameStore.getState();
      game.setMode("engine");
      game.setEngineSide("black");
      game.setEngineMatchClock({ initialMs: 60_000, incrementMs: 0 });
      game.initEngineClockLive();
      expect(useGameStore.getState().makeMove({ from: "e2", to: "e4" })).toBe(true);
      const e4 = useGameStore.getState().currentNodeId;
      await settle();
      expect(engines.startGame).toHaveBeenCalledTimes(1);
      const searchId = engines.startGame.mock.calls[0][0].searchId;

      engines.stop.mockClear();
      useGameStore.getState().goToNode("root");
      await settle();
      expect(engines.stop).not.toHaveBeenCalled();
      expect(useGameStore.getState().engineClockLive).toMatchObject({ sideToMove: "black" });
      expect(useGameStore.getState().engineClockLive?.stoppedAt).toBeUndefined();

      engineEvents.bestMove({ engineId: "sf", searchId, move: "e7e5" });
      await settle();
      const state = useGameStore.getState();
      expect(state.currentNodeId).toBe("root");
      expect(state.moveTree.find((node) => node.parentId === e4)?.san).toBe("e5");
      expect(state.engineClockLive?.sideToMove).toBe("white");
      // Nothing is searched in the position looked at: the game goes on at its latest move.
      expect(engines.startGame).toHaveBeenCalledTimes(1);
    });
  });

  describe("useEngineDriver with live analysis paused (the switch off)", () => {
    const line = (searchId: string, depth: number): EngineInfo => ({
      engineId: "sf",
      searchId,
      multipv: 1,
      depth,
      score: { type: "cp", value: 20 },
      pv: ["e2e4"],
      raw: "",
      receivedAt: 0
    });

    /** The board's analysis has found a depth-12 line; the switch then turns off (stopLiveAnalysis). */
    async function pausedAtDepth12() {
      await settle();
      const searchId = engines.startAnalysis.mock.calls.at(-1)![0].searchId;
      engineEvents.info(line(searchId, 12));
      const game = useGameStore.getState();
      useAnalysisStore
        .getState()
        .pause(pausedAnalysisAt(game.moveTree, game.currentNodeId, game.currentFen));
      game.setMode("freeplay");
      await settle();
      return searchId;
    }
    /** The switch on again (analyzeCurrentPosition). */
    async function switchOn() {
      engines.startAnalysis.mockClear();
      useGameStore.getState().setMode("analysis");
      useAnalysisStore.getState().restartBoardSearch();
      await settle();
    }

    it("stops the search and keeps its lines: the stopped search's late output changes nothing", async () => {
      const searchId = await pausedAtDepth12();
      expect(engines.stop).toHaveBeenCalledWith();
      const frozen = useAnalysisStore.getState();
      expect(frozen.paused).toMatchObject({ nodeId: "root", move: null });
      expect(frozen.topLines.map((info) => info.depth)).toStrictEqual([12]);

      engineEvents.info(line(searchId, 13));
      engineEvents.bestMove({ engineId: "sf", searchId, move: "d2d4" });
      await settle();
      expect(useAnalysisStore.getState()).toMatchObject({
        topLines: frozen.topLines,
        bestMove: null,
        status: "idle",
        paused: frozen.paused
      });

      // Moving on stays paused: nothing is searched.
      engines.startAnalysis.mockClear();
      expect(useGameStore.getState().makeMove({ from: "e2", to: "e4" })).toBe(true);
      await settle();
      expect(engines.startAnalysis).not.toHaveBeenCalled();
      expect(useAnalysisStore.getState()).toMatchObject({
        topLines: frozen.topLines,
        paused: frozen.paused
      });
    });

    it("ends the pause when its board is replaced", async () => {
      await pausedAtDepth12();
      useGameStore.getState().reset();
      expect(useAnalysisStore.getState().paused).toBeNull();
    });

    it("ends the pause when its move is deleted", async () => {
      expect(useGameStore.getState().makeMove({ from: "e2", to: "e4" })).toBe(true);
      await pausedAtDepth12();
      const { paused } = useAnalysisStore.getState();
      expect(paused?.move).toBe("1. e4");
      useGameStore.getState().deleteLineFromNode(paused!.nodeId);
      expect(useAnalysisStore.getState().paused).toBeNull();
    });

    it("drops a Restart no search followed: the next search carries on", async () => {
      await pausedAtDepth12();
      // Restart pressed, then analysis stays off: nothing searches.
      useAnalysisStore.getState().restartFresh();
      await settle();
      expect(useAnalysisStore.getState().freshSearch).toBe(false);
      await switchOn();
      expect(engines.startAnalysis.mock.calls[0][0]).toMatchObject({ fresh: false });
    });

    it("resumes on the paused position with its lines shown at once", async () => {
      await pausedAtDepth12();
      await switchOn();
      expect(engines.startAnalysis).toHaveBeenCalledTimes(1);
      expect(engines.startAnalysis.mock.calls[0][0]).toMatchObject({ moves: [], fresh: false });
      const resumed = useAnalysisStore.getState();
      expect(resumed.paused).toBeNull();
      expect(resumed.status).toBe("thinking");
      expect(resumed.topLines.map((info) => info.depth)).toStrictEqual([12]);
    });

    it("another engine chosen while paused ends the pause: the new one searches once on again", async () => {
      await pausedAtDepth12();
      engines.startAnalysis.mockClear();
      render(() => useEngineDriver({ ...analysisOptions, engineId: "lc0" }));
      await settle();
      // The old engine's lines go (they'd show under the new engine's name); nothing searches.
      expect(useAnalysisStore.getState().paused).toBeNull();
      expect(engines.startAnalysis).not.toHaveBeenCalled();

      await switchOn();
      expect(engines.startAnalysis).toHaveBeenCalledTimes(1);
      expect(engines.startAnalysis.mock.calls[0][0]).toMatchObject({ engineId: "lc0" });
      expect(useAnalysisStore.getState().activeEngineId).toBe("lc0");
    });

    it("Restart while paused searches the position again from scratch, the engine's hash cleared", async () => {
      await pausedAtDepth12();
      useAnalysisStore.getState().restartFresh();
      await switchOn();
      expect(engines.startAnalysis).toHaveBeenCalledTimes(1);
      expect(engines.startAnalysis.mock.calls[0][0]).toMatchObject({ moves: [], fresh: true });
      expect(useAnalysisStore.getState()).toMatchObject({ paused: null, topLines: [] });
    });
  });
});
