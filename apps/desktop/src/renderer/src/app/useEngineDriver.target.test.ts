import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  startAnalysis: vi.fn<(request: { fen: string; moves: string[] }) => Promise<void>>(
    async () => {}
  ),
  startGame: vi.fn(async () => {}),
  stop: vi.fn(async () => {})
};
const unsubscribe = () => () => {};
vi.stubGlobal("window", globalThis);
vi.stubGlobal("chaturanga", {
  engines,
  events: { onEngineInfo: unsubscribe, onEngineBestMove: unsubscribe, onEngineError: unsubscribe }
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
