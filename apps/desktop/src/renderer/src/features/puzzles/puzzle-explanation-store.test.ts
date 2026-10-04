import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExplainPuzzleResult } from "@chaturanga/shared/ipc/chaturanga-api";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import type { AnalysePositionsResult, EngineConfig } from "@chaturanga/shared/types/engine";
import { usePuzzleStore } from "../../stores/puzzle-store";
import { explanationKey, puzzleIdentity } from "./puzzle-explanation";
import {
  NO_ENGINE_ERROR,
  cancelPuzzleExplanations,
  explainView,
  requestPuzzleExplanation,
  usePuzzleExplanationStore,
  type ExplainDeps,
  type ExplainEntry,
  type ExplainRequest
} from "./puzzle-explanation-store";

const START = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
const puzzle: PuzzleSample = {
  id: "p1",
  databaseId: "db",
  sourceId: "lichess-puzzles",
  sourceName: "Lichess puzzles",
  initialFen: START,
  solutionMoves: ["h5f7"],
  themes: ["mateIn1"],
  openingTags: [],
  sideToMove: "white"
};
const request: ExplainRequest = {
  key: explanationKey(puzzle, "solved", null),
  puzzle,
  kind: "solved",
  wrong: null,
  engine: { id: "sf", name: "Stockfish" } as EngineConfig,
  settings: {
    reviewSearchTimeMs: 500,
    reviewMultiPv: 3,
    reviewPlayerRating: 1500,
    reviewCommentaryDetail: "balanced"
  }
};
const analysis: AnalysePositionsResult = {
  engineName: "Stockfish 17",
  lines: [
    [
      {
        multipv: 1,
        depth: 20,
        score: { type: "mate", value: 1 },
        scoreWhite: { type: "mate", value: 1 },
        pv: ["h5f7"]
      }
    ]
  ]
};
const explanation = {
  headline: "Mate on f7",
  prose: "Qxf7# is mate.",
  providerModel: "m/x",
  generatedAt: 1
};

/** Each call's answer is released by the test (`resolve`), so phases can be observed in between. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeDeps() {
  const searches: ReturnType<typeof deferred<AnalysePositionsResult>>[] = [];
  const answers: ReturnType<typeof deferred<ExplainPuzzleResult>>[] = [];
  let id = 0;
  const deps = {
    analysePositions: vi.fn(() => {
      const next = deferred<AnalysePositionsResult>();
      searches.push(next);
      return next.promise;
    }),
    explainPuzzle: vi.fn(() => {
      const next = deferred<ExplainPuzzleResult>();
      answers.push(next);
      return next.promise;
    }),
    cancelSearch: vi.fn(),
    cancelWriting: vi.fn(),
    newId: () => `r${++id}`
  } satisfies ExplainDeps;
  return { deps, searches, answers };
}

const entry = (key = request.key): ExplainEntry | undefined =>
  usePuzzleExplanationStore.getState().entries[key];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("requestPuzzleExplanation", () => {
  beforeEach(() => {
    usePuzzleExplanationStore.setState({ entries: {} });
    usePuzzleStore.getState().reset();
  });

  it("analyses with the review settings, then writes, then keeps the explanation for the session", async () => {
    const { deps, searches, answers } = fakeDeps();
    const running = requestPuzzleExplanation(request, deps);
    expect(entry()).toMatchObject({ phase: "analysing", requestId: "r1" });
    expect(deps.analysePositions).toHaveBeenCalledWith({
      requestId: "r1",
      engineId: "sf",
      moveTimeMs: 500,
      positions: [{ fen: START, multipv: 3 }]
    });

    searches[0]!.resolve(analysis);
    await flush();
    expect(entry()?.phase).toBe("writing");
    const sent = deps.explainPuzzle.mock.calls[0] as unknown as [
      { requestId: string; payload: { outcome: string; commentaryDetail: string } }
    ];
    expect(sent[0]).toMatchObject({
      requestId: "r1",
      payload: { outcome: "solved", commentaryDetail: "balanced" }
    });

    answers[0]!.resolve({ explanation, error: null });
    await running;
    expect(entry()).toMatchObject({ phase: "ready", requestId: null, explanation, otherSan: [] });
  });

  it("doesn't ask twice while one is running; Regenerate replaces a finished one", async () => {
    const { deps, searches, answers } = fakeDeps();
    const first = requestPuzzleExplanation(request, deps);
    void requestPuzzleExplanation(request, deps);
    expect(deps.analysePositions).toHaveBeenCalledTimes(1);
    searches[0]!.resolve(analysis);
    await flush();
    answers[0]!.resolve({ explanation, error: null });
    await first;

    void requestPuzzleExplanation(request, deps);
    expect(deps.analysePositions).toHaveBeenCalledTimes(2);
    expect(entry()?.phase).toBe("analysing");
  });

  it("moving to another puzzle cancels the running request and drops its late answer", async () => {
    const { deps, searches } = fakeDeps();
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    const running = requestPuzzleExplanation(request, deps);
    usePuzzleStore.getState().setActivePuzzle({ ...puzzle, id: "p2" });
    expect(deps.cancelSearch).toHaveBeenCalledWith("r1");
    expect(deps.cancelWriting).not.toHaveBeenCalled();
    expect(entry()).toBeUndefined();

    searches[0]!.resolve(analysis);
    await running;
    expect(deps.explainPuzzle).not.toHaveBeenCalled();
    expect(entry()).toBeUndefined();
  });

  it("moving to a puzzle with the same id in another database is moving to another puzzle", async () => {
    const { deps, searches, answers } = fakeDeps();
    const other = { ...puzzle, databaseId: "db2" };
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    void requestPuzzleExplanation(request, deps);
    usePuzzleStore.getState().setActivePuzzle(other);
    expect(deps.cancelSearch).toHaveBeenCalledWith("r1");
    expect(entry()).toBeUndefined();

    const otherRequest = { ...request, puzzle: other, key: explanationKey(other, "solved", null) };
    const running = requestPuzzleExplanation(otherRequest, deps);
    expect(entry(otherRequest.key)).toMatchObject({
      phase: "analysing",
      requestId: "r2",
      puzzle: puzzleIdentity(other)
    });
    searches[1]!.resolve(analysis);
    await flush();
    answers[0]!.resolve({ explanation, error: null });
    await running;
    expect(entry(otherRequest.key)?.phase).toBe("ready");
    expect(entry()).toBeUndefined();
  });

  it("once the search is done, moving on cancels only the provider call (main has no search to stop)", async () => {
    const { deps, searches } = fakeDeps();
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    void requestPuzzleExplanation(request, deps);
    searches[0]!.resolve(analysis);
    await flush();
    expect(entry()?.phase).toBe("writing");
    usePuzzleStore.getState().setActivePuzzle({ ...puzzle, id: "p2" });
    expect(deps.cancelWriting).toHaveBeenCalledWith("r1");
    expect(deps.cancelSearch).not.toHaveBeenCalled();
    expect(entry()).toBeUndefined();
  });

  it("keeps finished explanations and the current puzzle's request when cancelling", async () => {
    const { deps } = fakeDeps();
    usePuzzleExplanationStore.setState({
      entries: {
        "old:solved": {
          phase: "ready",
          puzzle: "old",
          requestId: null,
          explanation,
          otherSan: [],
          error: null,
          needsSettings: false,
          cancel: null
        }
      }
    });
    void requestPuzzleExplanation(request, deps);
    cancelPuzzleExplanations(puzzleIdentity(puzzle));
    expect(deps.cancelSearch).not.toHaveBeenCalled();
    expect(entry("old:solved")?.phase).toBe("ready");
    expect(entry()?.phase).toBe("analysing");
  });

  it("reports an engine failure, a provider error and a missing engine, each with a way forward", async () => {
    const { deps, searches, answers } = fakeDeps();
    const failing = requestPuzzleExplanation(request, deps);
    searches[0]!.reject(
      new Error("Error invoking remote method 'engines:analysePositions': Error: Engine not found")
    );
    await failing;
    expect(entry()).toMatchObject({
      phase: "error",
      error: "The engine couldn't analyse this puzzle: Engine not found.",
      needsSettings: false
    });

    const refused = requestPuzzleExplanation(request, deps);
    searches[1]!.resolve(analysis);
    await flush();
    answers[0]!.resolve({ explanation: null, error: "OpenRouter rejected the API key." });
    await refused;
    expect(entry()).toMatchObject({ phase: "error", error: "OpenRouter rejected the API key." });

    await requestPuzzleExplanation({ ...request, engine: null }, deps);
    expect(entry()).toMatchObject({ phase: "error", error: NO_ENGINE_ERROR, needsSettings: true });
  });

  it("says so when the engine's lines can't ground an explanation", async () => {
    const { deps, searches } = fakeDeps();
    const running = requestPuzzleExplanation(request, deps);
    searches[0]!.resolve({ engineName: "SF", lines: [[]] });
    await running;
    expect(entry()?.error).toMatch(/didn't return enough/);
    expect(deps.explainPuzzle).not.toHaveBeenCalled();
  });
});

describe("explainView", () => {
  const ready: ExplainEntry = {
    phase: "ready",
    puzzle: puzzleIdentity(puzzle),
    requestId: null,
    explanation,
    otherSan: [],
    error: null,
    needsSettings: false,
    cancel: null
  };
  const base = { entry: undefined, configReady: true, commentaryEnabled: true, hasApiKey: true };

  it("offers the button once the configuration is known", () => {
    expect(explainView({ ...base, configReady: false })).toEqual({ kind: "idle", disabled: true });
    expect(explainView(base)).toEqual({ kind: "idle", disabled: false });
  });

  it("says when commentary is off or the key is missing, like Game review", () => {
    expect(explainView({ ...base, commentaryEnabled: false })).toEqual({ kind: "off" });
    expect(explainView({ ...base, hasApiKey: false })).toEqual({ kind: "no-key" });
  });

  it("keeps showing progress and a finished explanation whatever the settings", () => {
    expect(
      explainView({
        ...base,
        hasApiKey: false,
        entry: { ...ready, phase: "writing", explanation: null }
      })
    ).toEqual({ kind: "writing" });
    expect(explainView({ ...base, commentaryEnabled: false, entry: ready })).toEqual({
      kind: "ready",
      explanation
    });
  });

  it("shows an error with its way forward", () => {
    const error: ExplainEntry = {
      ...ready,
      phase: "error",
      explanation: null,
      error: NO_ENGINE_ERROR,
      needsSettings: true
    };
    expect(explainView({ ...base, entry: error })).toEqual({
      kind: "error",
      message: NO_ENGINE_ERROR,
      needsSettings: true
    });
  });
});
