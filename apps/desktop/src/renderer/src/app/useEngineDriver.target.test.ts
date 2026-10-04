import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineError, EngineInfo } from "@chaturanga/shared/types/engine";
import type { AnalysisTarget } from "../features/analysis/live-analysis";

// The hook's effects run once, outside React (as in useGameAutosave's tests); the engine calls
// go to the fakes below.
const cleanups: Array<() => void> = [];
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => (() => void) | void) => {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  },
  useRef: <T>(current: T) => ({ current })
}));
const engines = {
  startAnalysis: vi.fn<
    (request: { searchId: string; fen: string; moves: string[] }) => Promise<void>
  >(async () => {}),
  startGame: vi.fn<(request: { searchId: string }) => Promise<void>>(async () => {}),
  stop: vi.fn(async () => {})
};
/** What main sends: the driver's own handlers, called as an engine event arrives. */
const engineEvents = {
  info: (_info: EngineInfo) => {},
  error: (_error: EngineError) => {}
};
const unsubscribe = () => () => {};
vi.stubGlobal("window", globalThis);
vi.stubGlobal("chaturanga", {
  engines,
  events: {
    onEngineInfo: (handler: (info: EngineInfo) => void) => {
      engineEvents.info = handler;
      return () => {};
    },
    onEngineBestMove: unsubscribe,
    onEngineError: (handler: (error: EngineError) => void) => {
      engineEvents.error = handler;
      return () => {};
    }
  }
});

const { useEngineDriver } = await import("./useEngineDriver");
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

beforeEach(() => {
  useGameStore.getState().reset();
  useAnalysisStore.setState({ target: null });
  useAnalysisStore.getState().reset();
  vi.clearAllMocks();
  // The driver, mounted on an Analyze board: it searches the board's position.
  useGameStore.getState().setMode("analysis");
  useEngineDriver({ engineId: "sf", multipv: 3, depth: null, moveTimeMs: null, resources: "" });
});

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
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
    expect(engines.stop).toHaveBeenCalled();
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
    expect(engines.stop).toHaveBeenCalled();
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
    expect(analysis.topLines.map((info) => info.depth)).toEqual([2]);
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

    const searchId = engines.startGame.mock.calls[0]![0].searchId;
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
