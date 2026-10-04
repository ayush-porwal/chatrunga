import { beforeEach, describe, expect, it, vi } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { SavedGame } from "@chaturanga/shared/types/chess";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import { LIVE_GAME_NOTICE } from "../features/repertoire/handoffs";
import { useAnalysisStore } from "../stores/analysis-store";
import { useAppNoticeStore } from "../stores/app-notice-store";
import { useGameStore } from "../stores/game-store";
import { useHistoryStore, type BoardSnapshot, type HistoryEntry } from "../stores/history-store";
import { useLichessStore } from "../stores/lichess-store";
import { useRepertoireWorkspaceStore } from "../stores/repertoire-workspace-store";
import { useReviewStore } from "../stores/review-store";
import { captureBoard } from "./history-navigation";
import {
  goHistory,
  restoreEntry,
  restoreLoading,
  restoreReviewRoute,
  saveStudyDraftFirst,
  type NavigationShell,
  type PendingRestore,
  type ReviewRouteShell
} from "./navigation-coordinator";
import { isHeldUnchanged } from "./useGameAutosave";

/** A promise resolved (or rejected) by the test, for a game or a draft save that loads slowly. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Lets awaited work settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function savedGame(id: string, overrides: Partial<SavedGame> = {}): SavedGame {
  const { game } = importPgnText("1. e4 e5 2. Nf3 *");
  return {
    id,
    source: "pgn-import",
    event: "Library game",
    site: null,
    date: null,
    round: null,
    white: "White",
    black: "Black",
    result: "*",
    currentFen: game.currentFen,
    currentNodeId: game.currentNodeId,
    initialFen: null,
    pgn: game.pgn,
    moveTree: game.moveTree,
    review: null,
    reviews: [],
    ...overrides
  } as SavedGame;
}

function loadSaved(id: string | null) {
  const { game } = importPgnText("1. e4 e5 2. Nf3 *");
  useGameStore.getState().loadGame({ ...game, id });
}

/** The shell's commands as spies; showing a screen bumps the navigation counter like App's do. */
function fakeShell(overrides: Partial<NavigationShell> = {}): NavigationShell {
  const navigation = { current: 0 };
  const shows = () => vi.fn(() => void (navigation.current += 1));
  return {
    navigation,
    commitCurrent: vi.fn(),
    showLiveGame: shows(),
    showHome: shows(),
    showSettings: shows(),
    openPlay: shows(),
    openPuzzles: shows(),
    openDatabases: shows(),
    openRepertoireHub: shows(),
    openRepertoireStudy: vi.fn(async () => {
      navigation.current += 1;
      return true;
    }),
    openRepertoirePractice: vi.fn(async () => {
      navigation.current += 1;
      return true;
    }),
    showGame: shows(),
    showGameReview: shows(),
    startPuzzle: shows(),
    getSavedGame: vi.fn(async (id: string) => savedGame(id)),
    stopEngineWork: vi.fn(),
    clearPuzzleSession: vi.fn(),
    releasePuzzleSession: vi.fn(),
    resumePuzzleSet: vi.fn(),
    endBoardActivity: vi.fn(),
    defaultEngineId: "stockfish",
    exitFocus: vi.fn(),
    ...overrides
  };
}

const notFound = () => new Error("Error invoking remote method 'games:get': Error: Game not found");

function gameEntry(
  gameId: string | null,
  board: Partial<BoardSnapshot> = {}
): Extract<HistoryEntry, { view: "game" }> {
  loadSaved(gameId);
  return { view: "game", board: { ...captureBoard("notation", null), ...board } };
}

/** History at `index` of `entries`. */
function history(entries: HistoryEntry[], index = entries.length - 1) {
  useHistoryStore.setState({ entries, index });
}

const live = (id: string, over = false) =>
  useLichessStore
    .getState()
    .setLive({ id, over } as unknown as Parameters<
      ReturnType<typeof useLichessStore.getState>["setLive"]
    >[0]);

beforeEach(() => {
  useGameStore.getState().reset();
  useReviewStore.getState().reset();
  useAnalysisStore.getState().reset();
  useAppNoticeStore.getState().dismiss();
  useLichessStore.getState().setLive(null);
  useLichessStore.setState({ playOpponent: null });
  useRepertoireWorkspaceStore.getState().reset();
  useRepertoireWorkspaceStore.setState({ decisionDrafts: {} });
  history([{ view: "home" }], 0);
});

describe("Back / Forward", () => {
  it("commits the screen being left, shows the entry, then moves the index", async () => {
    history([{ view: "home" }, { view: "databases" }]);
    const shell = fakeShell();
    await goHistory(-1, shell, { current: null });
    expect(shell.commitCurrent).toHaveBeenCalledTimes(1);
    expect(shell.showHome).toHaveBeenCalledTimes(1);
    expect(useHistoryStore.getState().index).toBe(0);

    await goHistory(1, shell, { current: null });
    expect(shell.openDatabases).toHaveBeenCalledTimes(1);
    expect(useHistoryStore.getState().index).toBe(1);
  });

  it("does nothing past either end", async () => {
    const shell = fakeShell();
    await goHistory(-1, shell, { current: null });
    await goHistory(1, shell, { current: null });
    expect(shell.commitCurrent).not.toHaveBeenCalled();
  });

  it("shows each kind of screen through the shell", async () => {
    const shell = fakeShell();
    expect(await restoreEntry({ view: "settings", section: "engines" }, shell)).toBe("shown");
    expect(shell.showSettings).toHaveBeenCalledWith("engines");
    expect(await restoreEntry({ view: "play", opponent: "lichess" }, shell)).toBe("shown");
    expect(useLichessStore.getState().playOpponent).toBe("lichess");
    expect(await restoreEntry({ view: "puzzles" }, shell)).toBe("shown");
    expect(await restoreEntry({ view: "repertoire-hub" }, shell)).toBe("shown");
    expect(shell.openPuzzles).toHaveBeenCalled();
    expect(shell.openRepertoireHub).toHaveBeenCalled();
    expect(
      await restoreEntry(
        { view: "repertoire-practice", repertoireId: "r1", sessionId: "s1" },
        shell
      )
    ).toBe("shown");
    expect(shell.openRepertoirePractice).toHaveBeenCalledWith("r1", "s1");
  });

  it("brings a saved game back on its tab, ending the board's other activity", async () => {
    const entry = gameEntry("g1", { tab: "engine" });
    loadSaved("g2");
    history([entry, { view: "home" }]);
    const shell = fakeShell();
    await goHistory(-1, shell, { current: null });
    expect(shell.getSavedGame).toHaveBeenCalledWith("g1");
    expect(useGameStore.getState().gameId).toBe("g1");
    expect(shell.stopEngineWork).toHaveBeenCalled();
    expect(shell.clearPuzzleSession).toHaveBeenCalled();
    expect(shell.showGame).toHaveBeenCalledWith("engine");
    expect(shell.exitFocus).toHaveBeenCalled();
    expect(useHistoryStore.getState().index).toBe(0);
  });

  it("brings an unsaved game back whole, still unsaved when it was an untouched copy", async () => {
    const entry = gameEntry(null, { held: true });
    loadSaved("g2");
    const shell = fakeShell();
    expect(await restoreEntry(entry, shell)).toBe("shown");
    expect(shell.endBoardActivity).toHaveBeenCalled();
    expect(useGameStore.getState().gameId).toBeNull();
    expect(useGameStore.getState().moveTree).toEqual(entry.board.session?.moveTree);
    expect(isHeldUnchanged()).toBe(true);
  });

  it("restarts live analysis of the same game, keeping its search running", async () => {
    const entry = gameEntry("g1", { mode: "analysis" });
    const shell = fakeShell();
    expect(await restoreEntry(entry, shell)).toBe("shown");
    expect(shell.getSavedGame).not.toHaveBeenCalled();
    expect(shell.stopEngineWork).toHaveBeenCalledWith({ stopSearch: false, keepReview: false });
    expect(useGameStore.getState().mode).toBe("analysis");
    expect(useAnalysisStore.getState().activeEngineId).toBe("stockfish");
    // The board's own search: a study engine panel left on the way hands the engine back to it.
    const { searchEpoch, boardSearchEpoch } = useAnalysisStore.getState();
    expect(boardSearchEpoch).toBe(searchEpoch);
    expect(searchEpoch).toBeGreaterThan(0);
  });

  const puzzleConfig: PuzzleSessionConfig = {
    databaseId: "db",
    mode: "lichess-puzzle",
    lichess: {
      ratingMin: 1000,
      ratingMax: 2000,
      popularityMin: 0,
      lengths: [],
      themes: [],
      openings: [],
      side: "any"
    },
    position: { difficultyMin: 0, difficultyMax: 100, tags: [] }
  };

  it("starts a puzzle again rather than restoring it mid-solution", async () => {
    const sample = { id: "p1", initialFen: "8/8/8/8/8/8/8/K6k w - - 0 1" } as PuzzleSample;
    const set = { id: "set1", config: puzzleConfig, shownIds: ["p0", "p1"] };
    const entry = gameEntry("g1", { puzzle: { sample }, puzzleSet: set });
    const shell = fakeShell();
    expect(await restoreEntry(entry, shell)).toBe("shown");
    expect(shell.startPuzzle).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "puzzle", sample, set })
    );
    expect(shell.showGame).not.toHaveBeenCalled();
    expect(shell.resumePuzzleSet).not.toHaveBeenCalled();
  });

  it("brings a game played on from a puzzle back with its set, so Next puzzle goes on", async () => {
    const set = { id: "set1", config: puzzleConfig, shownIds: ["p1"] };
    const entry = gameEntry("g1", { puzzleSet: set });
    const shell = fakeShell();
    expect(await restoreEntry(entry, shell)).toBe("shown");
    expect(shell.releasePuzzleSession).not.toHaveBeenCalled();
    expect(shell.resumePuzzleSet).toHaveBeenCalledWith(set);
    expect(shell.showGame).toHaveBeenCalledWith("notation");
  });

  it("ends the puzzle set (unless the board goes on with it) when the same game comes back without one", async () => {
    const entry = gameEntry("g1");
    const shell = fakeShell();
    expect(await restoreEntry(entry, shell)).toBe("shown");
    expect(shell.releasePuzzleSession).toHaveBeenCalled();
    expect(shell.resumePuzzleSet).not.toHaveBeenCalled();
  });

  it("brings a review back with its saved analysis when the board lost it", async () => {
    const review = { reviewId: "rv1", moves: [] } as unknown as SavedGame["review"];
    const entry: HistoryEntry = {
      view: "game-review",
      board: gameEntry("g1").board,
      tab: "moves",
      compareColor: "white"
    };
    const shell = fakeShell({
      getSavedGame: vi.fn(async (id: string) => savedGame(id, { review }))
    });
    expect(await restoreEntry(entry, shell)).toBe("shown");
    expect(shell.stopEngineWork).toHaveBeenCalledWith({ stopSearch: true, keepReview: true });
    expect(useReviewStore.getState().review).not.toBeNull();
    expect(useGameStore.getState().mode).toBe("freeplay");
    expect(shell.showGameReview).toHaveBeenCalledWith(entry);
  });
});

describe("a restore still loading", () => {
  it("holds further presses until it's shown", async () => {
    const slow = deferred<SavedGame>();
    const entry = gameEntry("g1");
    loadSaved("g2");
    history([{ view: "home" }, entry, { view: "databases" }]);
    const shell = fakeShell({ getSavedGame: vi.fn(() => slow.promise) });
    const pending: PendingRestore = { current: null };

    const first = goHistory(-1, shell, pending);
    expect(restoreLoading(pending, shell.navigation)).toBe(true);
    await goHistory(-1, shell, pending);
    expect(shell.commitCurrent).toHaveBeenCalledTimes(1);

    slow.resolve(savedGame("g1"));
    await first;
    expect(useHistoryStore.getState().index).toBe(1);
    expect(restoreLoading(pending, shell.navigation)).toBe(false);
  });

  it("is dropped when a newer navigation happens before its game loads", async () => {
    const slow = deferred<SavedGame>();
    const entry = gameEntry("g1");
    loadSaved("g2");
    history([entry, { view: "databases" }]);
    const shell = fakeShell({ getSavedGame: vi.fn(() => slow.promise) });
    const pending: PendingRestore = { current: null };

    const back = goHistory(-1, shell, pending);
    // The user goes elsewhere meanwhile (a sidebar click, a Lichess game starting).
    shell.navigation.current += 1;
    // …which frees Back / Forward at once instead of waiting for the old load.
    expect(restoreLoading(pending, shell.navigation)).toBe(false);

    slow.resolve(savedGame("g1"));
    await back;
    expect(useGameStore.getState().gameId).toBe("g2");
    expect(shell.showGame).not.toHaveBeenCalled();
    expect(useHistoryStore.getState().index).toBe(1);
    expect(useHistoryStore.getState().entries).toHaveLength(2);
    expect(useAppNoticeStore.getState().message).toBeNull();
  });

  it("never wins over a newer restore that finished first", async () => {
    const slow = deferred<SavedGame>();
    const older = gameEntry("g1");
    const newer = gameEntry("g3");
    loadSaved("g2");
    const shell = fakeShell({
      getSavedGame: vi.fn((id: string) =>
        id === "g1" ? slow.promise : Promise.resolve(savedGame(id))
      )
    });
    const first = restoreEntry(older, shell);
    expect(await restoreEntry(newer, shell)).toBe("shown");
    slow.resolve(savedGame("g1"));
    expect(await first).toBe("dropped");
    expect(useGameStore.getState().gameId).toBe("g3");
    expect(shell.showGame).toHaveBeenCalledTimes(1);
  });

  it("lets a newer press go ahead once it was superseded, and its late end doesn't free the newer one", async () => {
    const loads = [deferred<SavedGame>(), deferred<SavedGame>()];
    const g3 = gameEntry("g3");
    loadSaved("g2");
    history([{ view: "home" }, g3, { view: "databases" }]);
    let call = 0;
    const shell = fakeShell({ getSavedGame: vi.fn(() => loads[call++]!.promise) });
    const pending: PendingRestore = { current: null };

    const first = goHistory(-1, shell, pending);
    shell.navigation.current += 1; // a newer navigation drops it
    const second = goHistory(-1, shell, pending); // the same target, now the latest restore
    expect(shell.commitCurrent).toHaveBeenCalledTimes(2);

    loads[0]!.resolve(savedGame("g3"));
    await first;
    // The dropped restore ended; the newer one is still loading and still holds Back / Forward.
    expect(useGameStore.getState().gameId).toBe("g2");
    expect(restoreLoading(pending, shell.navigation)).toBe(true);

    loads[1]!.resolve(savedGame("g3"));
    await second;
    expect(useGameStore.getState().gameId).toBe("g3");
    expect(shell.showGame).toHaveBeenCalledTimes(1);
    expect(useHistoryStore.getState().index).toBe(1);
    expect(restoreLoading(pending, shell.navigation)).toBe(false);
  });

  it("drops a review whose saved analysis arrives after a newer navigation", async () => {
    const slowReview = deferred<SavedGame>();
    const entry: HistoryEntry = { view: "game-review", board: gameEntry("g1").board, tab: "moves" };
    const shell = fakeShell({ getSavedGame: vi.fn(() => slowReview.promise) });
    const restoring = restoreEntry(entry, shell);
    await settle();
    shell.navigation.current += 1;
    slowReview.resolve(savedGame("g1"));
    expect(await restoring).toBe("dropped");
    expect(shell.showGameReview).not.toHaveBeenCalled();
  });
});

describe("a target that can't come back", () => {
  it("drops a deleted game's entry, says so on any page, and stays put", async () => {
    const deleted = gameEntry("g1");
    loadSaved("g2");
    history([{ view: "home" }, deleted, { view: "databases" }]);
    const shell = fakeShell({ getSavedGame: vi.fn(() => Promise.reject(notFound())) });

    await expect(goHistory(-1, shell, { current: null })).resolves.toBeUndefined();
    expect(useAppNoticeStore.getState().message).toBe("That game was deleted.");
    // Still on Databases; the next Back goes past the deleted game, to Home.
    expect(useHistoryStore.getState().entries).toEqual([{ view: "home" }, { view: "databases" }]);
    expect(useHistoryStore.getState().index).toBe(1);
    expect(useGameStore.getState().gameId).toBe("g2");
    expect(shell.showGame).not.toHaveBeenCalled();
    // Nothing was attached to the unrelated game on the board.
    expect(useGameStore.getState().matchFeedback).toBeNull();

    await goHistory(-1, shell, { current: null });
    expect(shell.showHome).toHaveBeenCalled();
    expect(useHistoryStore.getState().index).toBe(0);
  });

  it("drops a deleted game ahead too (Forward)", async () => {
    const deleted = gameEntry("g1");
    loadSaved("g2");
    history([{ view: "home" }, deleted], 0);
    const shell = fakeShell({ getSavedGame: vi.fn(() => Promise.reject(notFound())) });
    await goHistory(1, shell, { current: null });
    expect(useHistoryStore.getState()).toMatchObject({ entries: [{ view: "home" }], index: 0 });
  });

  it("keeps the entry of a game that couldn't be read now, with the reason", async () => {
    const entry = gameEntry("g1");
    loadSaved("g2");
    history([entry, { view: "databases" }]);
    const shell = fakeShell({
      getSavedGame: vi.fn(() => Promise.reject(new Error("database is locked")))
    });
    await goHistory(-1, shell, { current: null });
    expect(useAppNoticeStore.getState().message).toBe(
      "That game couldn't be opened: database is locked"
    );
    expect(useHistoryStore.getState().entries).toHaveLength(2);
    expect(useHistoryStore.getState().index).toBe(1);
  });

  it("leaves a deleted review's entry out the same way", async () => {
    const entry: HistoryEntry = { view: "game-review", board: gameEntry("g1").board, tab: "moves" };
    loadSaved("g2");
    const shell = fakeShell({ getSavedGame: vi.fn(() => Promise.reject(notFound())) });
    expect(await restoreEntry(entry, shell)).toBe("gone");
    expect(shell.showGameReview).not.toHaveBeenCalled();
  });

  it("stays when a study chapter didn't open (the chapter being left couldn't be saved)", async () => {
    const study: HistoryEntry = {
      view: "repertoire-study",
      repertoireId: "r1",
      chapterId: "c1",
      nodeId: null,
      tab: "moves",
      orientation: null
    };
    history([
      study,
      {
        view: "repertoire-study",
        repertoireId: "r1",
        chapterId: "c2",
        nodeId: null,
        tab: "moves",
        orientation: null
      }
    ]);
    const shell = fakeShell({ openRepertoireStudy: vi.fn(async () => false) });
    await goHistory(-1, shell, { current: null });
    expect(shell.openRepertoireStudy).toHaveBeenCalledWith(study);
    expect(useHistoryStore.getState().index).toBe(1);
    expect(useHistoryStore.getState().entries).toHaveLength(2);
  });
});

describe("a Game Review URL the window opened at (a reload)", () => {
  const reviewRouteShell = (overrides: Partial<ReviewRouteShell> = {}) => ({
    ...fakeShell(),
    reviewShown: vi.fn(),
    ...overrides
  });

  it("loads its saved game with the newest review, then shows the review page", async () => {
    const review = { reviewId: "rv2", moves: [] } as unknown as SavedGame["review"];
    const shell = reviewRouteShell({
      getSavedGame: vi.fn(async (id: string) => savedGame(id, { review }))
    });
    expect(await restoreReviewRoute("g1", shell)).toBe("shown");
    expect(shell.getSavedGame).toHaveBeenCalledWith("g1");
    expect(useGameStore.getState()).toMatchObject({ gameId: "g1", mode: "freeplay" });
    expect(useReviewStore.getState().review?.reviewId).toBe("rv2");
    expect(shell.reviewShown).toHaveBeenCalledTimes(1);
    expect(shell.showHome).not.toHaveBeenCalled();
  });

  it("lands on Home, saying so, when the game was deleted or couldn't be read", async () => {
    const deleted = reviewRouteShell({ getSavedGame: vi.fn(() => Promise.reject(notFound())) });
    expect(await restoreReviewRoute("g1", deleted)).toBe("gone");
    expect(useAppNoticeStore.getState().message).toBe("That game was deleted.");
    expect(deleted.showHome).toHaveBeenCalledTimes(1);
    expect(deleted.reviewShown).not.toHaveBeenCalled();
    expect(useGameStore.getState().gameId).toBeNull();

    const unreadable = reviewRouteShell({
      getSavedGame: vi.fn(() => Promise.reject(new Error("database is locked")))
    });
    expect(await restoreReviewRoute("g1", unreadable)).toBe("failed");
    expect(useAppNoticeStore.getState().message).toBe(
      "That game couldn't be opened: database is locked"
    );
    expect(unreadable.showHome).toHaveBeenCalledTimes(1);
  });

  it("lands on Home for an unsaved game, which didn't outlive the window", async () => {
    const shell = reviewRouteShell();
    expect(await restoreReviewRoute("current", shell)).toBe("gone");
    expect(shell.getSavedGame).not.toHaveBeenCalled();
    expect(shell.showHome).toHaveBeenCalledTimes(1);
  });

  it("gives way to a navigation made while the game loads", async () => {
    const slow = deferred<SavedGame>();
    const shell = reviewRouteShell({ getSavedGame: vi.fn(() => slow.promise) });
    const restoring = restoreReviewRoute("g1", shell);
    shell.navigation.current += 1;
    slow.resolve(savedGame("g1"));
    expect(await restoring).toBe("dropped");
    expect(useGameStore.getState().gameId).toBeNull();
    expect(shell.reviewShown).not.toHaveBeenCalled();
    expect(shell.showHome).not.toHaveBeenCalled();
  });
});

describe("a Lichess game being played", () => {
  it("keeps the board: Back to another game shows the live game with why, and nothing moves", async () => {
    const other = gameEntry("g1");
    loadSaved("g2");
    useGameStore.getState().setMode("online");
    live("lx");
    history([other, { view: "home" }]);
    const shell = fakeShell();
    await goHistory(-1, shell, { current: null });
    expect(shell.showLiveGame).toHaveBeenCalled();
    expect(useGameStore.getState().matchFeedback).toBe(LIVE_GAME_NOTICE);
    expect(shell.commitCurrent).not.toHaveBeenCalled();
    expect(shell.getSavedGame).not.toHaveBeenCalled();
    expect(useHistoryStore.getState().index).toBe(1);
  });

  it("blocks a repertoire screen but not a page without a board", async () => {
    live("lx");
    const shell = fakeShell();
    history([
      { view: "repertoire-practice", repertoireId: "r1", sessionId: null },
      { view: "home" }
    ]);
    await goHistory(-1, shell, { current: null });
    expect(shell.openRepertoirePractice).not.toHaveBeenCalled();
    expect(shell.showLiveGame).toHaveBeenCalled();

    history([{ view: "databases" }, { view: "home" }]);
    await goHistory(-1, shell, { current: null });
    expect(shell.openDatabases).toHaveBeenCalled();
    expect(useHistoryStore.getState().index).toBe(0);
  });

  it("returns to the live game's own entry without reloading it", async () => {
    loadSaved("g2");
    useGameStore.getState().setMode("online");
    live("lx");
    const entry = gameEntry("g2", { lichessGameId: "lx", tab: "engine" });
    useGameStore.getState().setMode("online");
    history([entry, { view: "home" }]);
    const shell = fakeShell();
    await goHistory(-1, shell, { current: null });
    expect(shell.getSavedGame).not.toHaveBeenCalled();
    expect(shell.showGame).toHaveBeenCalledWith("engine");
    expect(useHistoryStore.getState().index).toBe(0);
  });

  it("an ended game no longer holds the board", async () => {
    const other = gameEntry("g1");
    loadSaved("g2");
    live("lx", true);
    history([other, { view: "home" }]);
    const shell = fakeShell();
    await goHistory(-1, shell, { current: null });
    expect(shell.showLiveGame).not.toHaveBeenCalled();
    expect(useGameStore.getState().gameId).toBe("g1");
  });
});

describe("leaving a study chapter's draft", () => {
  const navigation = { current: 1 };
  const failure = "This chapter couldn't be saved.";
  const open = (draft: Partial<ReturnType<typeof useRepertoireWorkspaceStore.getState>>) =>
    useRepertoireWorkspaceStore.setState({ repertoireId: "r1", chapterId: "c1", ...draft });

  it("goes on at once with nothing to save, or when reopening the same chapter", async () => {
    const flush = vi.fn(async () => true);
    expect(await saveStudyDraftFirst({ request: 1, navigation, flush, failure })).toBe(true);
    open({ dirty: false, saveState: { status: "idle" } });
    expect(await saveStudyDraftFirst({ request: 1, navigation, flush, failure })).toBe(true);
    open({ dirty: true });
    expect(
      await saveStudyDraftFirst({ request: 1, navigation, flush, failure, keepChapterId: "c1" })
    ).toBe(true);
    expect(flush).not.toHaveBeenCalled();
  });

  it("saves unsaved edits first, then goes on", async () => {
    open({ dirty: true });
    const flush = vi.fn(async () => true);
    expect(
      await saveStudyDraftFirst({ request: 1, navigation, flush, failure, keepChapterId: "c2" })
    ).toBe(true);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("stays, saying why, when the draft can't be saved (also after an earlier failed save)", async () => {
    open({ dirty: false, saveState: { status: "error", message: "disk full", stale: false } });
    const flush = vi.fn(async () => false);
    expect(await saveStudyDraftFirst({ request: 1, navigation, flush, failure })).toBe(false);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(useAppNoticeStore.getState().message).toBe(failure);
  });

  it("saves a prompt or other decision change first though the chapter is saved, or none is open", async () => {
    const decisionDrafts = {
      "r1|k1|prompt": {
        repertoireId: "r1",
        positionKey: "k1",
        field: "prompt" as const,
        text: "Develop with tempo",
        generation: 1,
        status: "error" as const,
        error: { message: "disk full", stale: false }
      }
    };
    open({ dirty: false, saveState: { status: "idle" }, decisionDrafts });
    const flush = vi.fn(async () => false);
    expect(
      await saveStudyDraftFirst({ request: 1, navigation, flush, failure, keepChapterId: "c2" })
    ).toBe(false);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(useAppNoticeStore.getState().message).toBe(failure);

    open({ chapterId: null, dirty: false, saveState: { status: "idle" }, decisionDrafts });
    const saved = vi.fn(async () => true);
    expect(await saveStudyDraftFirst({ request: 1, navigation, flush: saved, failure })).toBe(true);
    expect(saved).toHaveBeenCalledTimes(1);

    // Reopening the open chapter leaves nothing: its changes stay on it.
    open({ dirty: false, saveState: { status: "idle" }, decisionDrafts });
    expect(
      await saveStudyDraftFirst({ request: 1, navigation, flush, failure, keepChapterId: "c1" })
    ).toBe(true);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("reads a notice given as a function once the flush settled", async () => {
    open({ dirty: true });
    let cause = "before";
    const flush = vi.fn(async () => {
      cause = "the prompt";
      return false;
    });
    expect(
      await saveStudyDraftFirst({
        request: 1,
        navigation,
        flush,
        failure: () => `Unsaved: ${cause}`
      })
    ).toBe(false);
    expect(useAppNoticeStore.getState().message).toBe("Unsaved: the prompt");
  });

  it("gives way silently to a newer navigation that came while it saved", async () => {
    open({ dirty: true });
    const save = deferred<boolean>();
    const moving = { current: 1 };
    const leaving = saveStudyDraftFirst({
      request: 1,
      navigation: moving,
      flush: () => save.promise,
      failure
    });
    moving.current += 1;
    save.resolve(false);
    expect(await leaving).toBe(false);
    expect(useAppNoticeStore.getState().message).toBeNull();
  });
});
