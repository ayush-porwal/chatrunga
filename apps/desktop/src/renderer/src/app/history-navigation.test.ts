import { beforeEach, describe, expect, it } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import { useGameStore } from "../stores/game-store";
import { useHistoryStore, type HistoryEntry } from "../stores/history-store";
import { useLichessStore } from "../stores/lichess-store";
import { usePuzzleStore } from "../stores/puzzle-store";
import {
  captureBoard,
  captureEntry,
  continuedPuzzleSet,
  planBoardRestore,
  recordHistory,
  replacesLiveBoard,
  type HistoryContext
} from "./history-navigation";
import { nextPuzzleInput, puzzleBoard } from "./puzzle-session-controller";

const context: HistoryContext = { tab: "engine", reviewTab: "moves", openingSide: null, settingsSection: "engines", puzzleSet: null, puzzleSetContinues: false, repertoireScreen: null };
const puzzle = {
  id: "p1",
  databaseId: "db",
  sourceId: "00sHx",
  sourceName: "Lichess puzzles",
  initialFen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
  solutionMoves: ["f1b5"],
  themes: [],
  openingTags: [],
  sideToMove: "white"
} as PuzzleSample;
const config = { databaseId: "db", lichess: { ratingMin: 1000 }, position: {} } as unknown as PuzzleSessionConfig;
const set = { config, shownIds: ["p1"] };

function loadSaved(id: string | null) {
  const { game } = importPgnText("1. e4 e5 2. Nf3 *");
  useGameStore.getState().loadGame({ ...game, id });
}

const live = (id: string, over = false) =>
  useLichessStore.getState().setLive({ id, over } as unknown as Parameters<ReturnType<typeof useLichessStore.getState>["setLive"]>[0]);

describe("history capture", () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    usePuzzleStore.getState().reset();
    useLichessStore.getState().setLive(null);
    useLichessStore.setState({ playOpponent: null });
  });

  it("keeps a saved game by id and an unsaved one whole", () => {
    loadSaved("g1");
    expect(captureBoard("notation", null)).toMatchObject({ gameId: "g1", session: null, tab: "notation", puzzle: null });
    loadSaved(null);
    const board = captureBoard("library", null);
    expect(board.gameId).toBeNull();
    expect(board.session?.moveTree).toEqual(useGameStore.getState().moveTree);
    expect(board.currentNodeId).toBe(useGameStore.getState().currentNodeId);
  });

  it("records the puzzle on the board with its set, and only in puzzle mode", () => {
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    useGameStore.getState().loadGame(puzzleBoard(puzzle));
    expect(captureBoard("notation", set).puzzle).toBeNull();
    expect(captureBoard("notation", set).puzzleSet).toBeNull();
    useGameStore.getState().setMode("puzzle");
    expect(captureBoard("notation", set)).toMatchObject({ puzzle: { sample: puzzle }, puzzleSet: set });
  });

  it("records the set with a game played on from its puzzle, and with no other game", () => {
    loadSaved(null);
    useGameStore.getState().setMode("engine");
    expect(captureBoard("notation", set, true)).toMatchObject({ puzzle: null, puzzleSet: set });
    expect(captureBoard("notation", set, false).puzzleSet).toBeNull();
    expect(captureEntry("game", { ...context, puzzleSet: set, puzzleSetContinues: true })).toMatchObject({
      board: { puzzleSet: set }
    });
    expect(captureEntry("game-review", { ...context, puzzleSet: set, puzzleSetContinues: true })).toMatchObject({
      board: { puzzleSet: set }
    });
  });

  it("records the Lichess game only for an online board", () => {
    live("lx");
    loadSaved("g1");
    expect(captureBoard("notation", null).lichessGameId).toBeNull();
    useGameStore.getState().setMode("online");
    expect(captureBoard("notation", null).lichessGameId).toBe("lx");
  });

  it("captures each view with the shell state it needs", () => {
    loadSaved("g1");
    expect(captureEntry("home", context)).toEqual({ view: "home" });
    expect(captureEntry("settings", context)).toEqual({ view: "settings", section: "engines" });
    // An unchosen Play tab follows the account.
    expect(captureEntry("play", context)).toEqual({ view: "play", opponent: "engine" });
    useLichessStore.getState().setPlayOpponent("lichess");
    expect(captureEntry("play", context)).toEqual({ view: "play", opponent: "lichess" });
    expect(captureEntry("game", context)).toMatchObject({ view: "game", board: { gameId: "g1", tab: "engine" } });
    // The review's board is always on the notation tab; the review's own tab is kept beside it.
    expect(captureEntry("game-review", context)).toMatchObject({ view: "game-review", tab: "moves", board: { tab: "notation" } });
    // A repertoire screen that isn't the one shown falls back to the hub.
    expect(captureEntry("repertoire-study", context)).toEqual({ view: "repertoire-hub" });
    const practice = { view: "repertoire-practice", repertoireId: "r1", sessionId: "s1", preset: null } as const;
    expect(captureEntry("repertoire-practice", { ...context, repertoireScreen: practice })).toEqual({
      view: "repertoire-practice",
      repertoireId: "r1",
      sessionId: "s1"
    });
  });

  it("pushes, replaces or records nothing", () => {
    useHistoryStore.setState({ entries: [{ view: "home" }], index: 0 });
    recordHistory("push", { view: "puzzles" });
    recordHistory("replace", { view: "databases" });
    recordHistory("none", { view: "home" });
    expect(useHistoryStore.getState()).toMatchObject({ entries: [{ view: "home" }, { view: "databases" }], index: 1 });
  });
});

describe("history restore", () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    useLichessStore.getState().setLive(null);
  });

  it("decides how each board comes back", () => {
    loadSaved("g1");
    const same = captureBoard("notation", null);
    expect(planBoardRestore(same)).toEqual({ kind: "same" });

    loadSaved("g2");
    expect(planBoardRestore(same)).toEqual({ kind: "saved", gameId: "g1" });

    loadSaved(null);
    const unsaved = captureBoard("notation", null);
    loadSaved("g2");
    expect(planBoardRestore(unsaved)).toMatchObject({ kind: "session", session: unsaved.session });

    // A puzzle starts again rather than its position coming back mid-solution.
    expect(planBoardRestore({ ...same, puzzle: { sample: puzzle }, puzzleSet: set })).toEqual({ kind: "puzzle", sample: puzzle, set });
    expect(planBoardRestore({ ...same, puzzle: { sample: puzzle } })).toEqual({ kind: "puzzle", sample: puzzle, set: null });
  });

  it("brings a game played on from a puzzle back with its set, saved or not", () => {
    loadSaved("g1");
    const saved = captureBoard("notation", set, true);
    loadSaved(null);
    const unsaved = captureBoard("notation", set, true);
    loadSaved("g2");
    expect(planBoardRestore(saved)).toEqual({ kind: "saved", gameId: "g1" });
    expect(continuedPuzzleSet(saved)).toEqual(set);
    expect(planBoardRestore(unsaved)).toMatchObject({ kind: "session" });
    expect(continuedPuzzleSet(unsaved)).toEqual(set);
    // An unrelated game has no set to keep; a puzzle starts its set itself.
    expect(continuedPuzzleSet(captureBoard("notation", set))).toBeNull();
    expect(continuedPuzzleSet({ ...saved, puzzle: { sample: puzzle } })).toBeNull();
  });

  it("leaves the Lichess game being played on the board, and reloads one that ended", () => {
    loadSaved("g1");
    const online = { ...captureBoard("notation", null), lichessGameId: "lx" };
    live("lx");
    expect(planBoardRestore(online)).toEqual({ kind: "live" });
    live("lx", true);
    expect(planBoardRestore(online)).toEqual({ kind: "same" });
  });

  it("says which entries would take the board from a live Lichess game", () => {
    loadSaved("g1");
    const board = captureBoard("notation", null);
    const entries: HistoryEntry[] = [
      { view: "home" },
      { view: "puzzles" },
      { view: "game", board },
      { view: "game", board: { ...board, lichessGameId: "lx" } },
      { view: "game-review", board, tab: "moves" }
    ];
    expect(entries.map((entry) => replacesLiveBoard(entry, "lx"))).toEqual([false, true, true, false, true]);
  });
});

describe("puzzle session", () => {
  it("sets up the puzzle's board from its position, the solver's side at the bottom", () => {
    const board = puzzleBoard(puzzle);
    expect(board).toMatchObject({ rootFen: puzzle.initialFen, source: "puzzle" });
    expect(board.headers).toMatchObject({ event: "Lichess puzzles", site: "?", orientationHint: "white", result: "*" });
  });

  it("asks for the set's next puzzle without those already shown, and nothing without a dataset", () => {
    expect(nextPuzzleInput(config, ["p1", "p2"])).toEqual({
      databaseId: "db",
      excludeIds: ["p1", "p2"],
      lichess: config.lichess,
      position: config.position
    });
    expect(nextPuzzleInput({ ...config, databaseId: null }, [])).toBeNull();
    expect(nextPuzzleInput(null, [])).toBeNull();
  });
});
