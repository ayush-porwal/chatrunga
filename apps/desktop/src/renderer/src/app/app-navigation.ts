import type { Dispatch, SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import type { BroadcastScreen, TournamentTarget } from "../features/broadcasts/navigation";
import type { SettingsSectionId } from "../features/settings/SettingsPage";
import { LIVE_GAME_NOTICE } from "../features/repertoire/handoffs";
import { useAnalysisStore } from "../stores/analysis-store";
import { useGameStore } from "../stores/game-store";
import { useHistoryStore, type HistoryEntry } from "../stores/history-store";
import { useLichessStore } from "../stores/lichess-store";
import { usePlayDraftStore } from "../stores/play-draft-store";
import { useReviewStore } from "../stores/review-store";
import type { AppView } from "./AppPages";
import {
  captureEntry,
  recordHistory,
  type HistoryContext,
  type HistoryMode
} from "./history-navigation";
import type { usePuzzleSession } from "./puzzle-session-controller";
import type { SideTab } from "./side-tabs";
import { cancelActiveReview } from "./useReviewRunner";

export const boardViews: ReadonlySet<AppView> = new Set([
  "game",
  "game-review",
  "repertoire-study",
  "repertoire-practice"
]);
/** Views whose board is the game store's (the game's move keys apply there). */
export const gameBoardViews: ReadonlySet<AppView> = new Set(["game", "game-review"]);
export const repertoireViews: ReadonlySet<AppView> = new Set([
  "repertoire-hub",
  "repertoire-study",
  "repertoire-practice"
]);

/** The game store now (commands read it when they run, not as of the last render). */
export const currentGame = () => useGameStore.getState();

type PuzzleSession = ReturnType<typeof usePuzzleSession>;

/** The shell's view state as of this render: what the navigation commands read and change. */
export type ShellState = {
  view: AppView;
  /** Switches the view in a view transition; `alongside` (the route change) runs inside it. */
  setView: (view: AppView, alongside?: () => void) => void;
  navigate: NavigateFunction;
  /**
   * Bumped by every game open and every view change. A saved game that finishes loading after
   * a newer selection (or after the user went elsewhere) is dropped instead of taking over.
   */
  latestNavigation: { current: number };
  onReviewRoute: boolean;
  onRepertoireRoute: boolean;
  desktopApiAvailable: boolean;
  sideTab: SideTab;
  setSideTab: (tab: SideTab) => void;
  setFocusMode: Dispatch<SetStateAction<boolean>>;
  /** Where Settings opens. */
  settingsSection: SettingsSectionId | null;
  setSettingsSection: (section: SettingsSectionId | null) => void;
  /** The Settings section being read (scroll-spy), which history records. */
  viewedSettingsSection: { current: SettingsSectionId | null };
  puzzleSession: PuzzleSession;
  /** The rest of the shell's state a history entry records. */
  entryState: Pick<
    HistoryContext,
    "reviewTab" | "openingSide" | "repertoireScreen" | "savedPlayOpponent" | "broadcastScreen"
  >;
  setBroadcastScreen: (screen: BroadcastScreen) => void;
};

/**
 * The shell's navigation commands for this render: switching views (recording Back / Forward),
 * and ending the board's activity before another one replaces it. The board, puzzle and
 * repertoire commands are built on these. Like the handlers App used to declare, each reads the
 * shell's state as of this render; none may run during render.
 *
 * Not a React hook (it calls none): it rebuilds its commands every render like the nested functions
 * it replaced, and takes the use- name only because the React Compiler's lint (react/refs) lets a
 * hook, not a plain function, receive the shell's refs during render.
 */
export function useAppNavigation(shell: ShellState) {
  const { latestNavigation, navigate, puzzleSession, setFocusMode, setView } = shell;
  const record = recordHistory;
  const clearPuzzleSession = puzzleSession.clear;

  /**
   * Switches the view, leaving the review route when going anywhere else. `history`: "push" adds
   * the new screen to Back / Forward (after the caller committed the one being left), "replace"
   * swaps the current entry, "none" (Back / Forward themselves) records nothing.
   */
  function showView(view: AppView, history: HistoryMode = "push", tab: SideTab = shell.sideTab) {
    latestNavigation.current += 1;
    // The route change belongs to the same view transition, so the old snapshot is the real old view.
    setView(view, leavesRoute(view) ? () => void navigate("/", { replace: true }) : undefined);
    record(history, historyEntry(view, tab));
  }

  /** Going to `view` leaves the review or repertoire route for "/". */
  function leavesRoute(view: AppView): boolean {
    return shell.onReviewRoute
      ? view !== "game-review"
      : shell.onRepertoireRoute && !repertoireViews.has(view);
  }

  // ---- Back / Forward -------------------------------------------------------------------------

  function historyEntry(view: AppView, tab: SideTab = shell.sideTab): HistoryEntry {
    return captureEntry(view, {
      ...shell.entryState,
      tab,
      settingsSection: shell.viewedSettingsSection.current ?? shell.settingsSection,
      puzzleSet: puzzleSession.snapshot,
      puzzleSetContinues: puzzleSession.continues(currentGame().board)
    });
  }

  /** Saves the screen being left as it is now (so Back returns to it as it was left). */
  function commitCurrent() {
    useHistoryStore.getState().commitCurrent(historyEntry(shell.view));
  }

  /**
   * Before a different board replaces this one: the engine's search and review end, the review
   * and any puzzle set are cleared.
   */
  function endBoardActivity() {
    stopEngineWork();
    useReviewStore.getState().reset();
    clearPuzzleSession();
  }

  /**
   * Ends what the engine is doing (search, review) before switching to another activity.
   * `keepReview` leaves a running review of the loaded game alone (it runs in its own process).
   */
  function stopEngineWork({
    stopSearch = true,
    keepReview = false
  }: { stopSearch?: boolean; keepReview?: boolean } = {}) {
    if (stopSearch) void window.chaturanga?.engines.stop();
    if (!keepReview) void cancelActiveReview();
    useAnalysisStore.getState().reset();
  }

  function showGame(tab: SideTab = "notation", history: HistoryMode = "push") {
    shell.setSideTab(tab);
    showView("game", history, tab);
  }

  /**
   * While a Lichess game is on, actions that would replace the board bring you back to it instead
   * (the game keeps running on Lichess either way).
   */
  function unlessOnlineGame(action: () => void) {
    if (!useLichessStore.getState().live || useLichessStore.getState().live?.over) return action();
    // Already on the board: nothing changes screen, so nothing is recorded.
    if (shell.view === "game") showGame(shell.sideTab, "none");
    else {
      commitCurrent();
      showGame();
    }
    currentGame().setMatchFeedback(LIVE_GAME_NOTICE);
  }

  /** Play: the page with every way to start a game (Lichess, an engine, a free board). */
  function openPlayPage(history: HistoryMode = "push") {
    if (history === "push") commitCurrent();
    // The engine keeps searching for a game still being played vs the engine; the page can end it.
    if (useGameStore.getState().mode !== "engine") stopEngineWork();
    clearPuzzleSession();
    setFocusMode(false);
    showView("play", history);
  }

  /**
   * Play opened by anything but Play from here (the sidebar, after a game): a repertoire
   * handoff left from earlier is dropped, so its position doesn't start a game unasked. Back and
   * an Engine settings detour return through `openPlayPage` and keep it.
   */
  function openFreshPlayPage() {
    usePlayDraftStore.getState().clearInitialSession();
    openPlayPage();
  }

  function openPuzzlesPage(history: HistoryMode = "push") {
    if (!shell.desktopApiAvailable) return;
    if (history === "push") commitCurrent();
    // An engine game still being played goes on behind the page (its engine keeps thinking, its
    // clock running); a puzzle replacing the board ends it.
    if (useGameStore.getState().mode !== "engine") stopEngineWork();
    // The loaded game stays as it is until a puzzle replaces it (marking it a puzzle would save it
    // as one, which hides it from the library).
    setFocusMode(false);
    showView("puzzles", history);
  }

  function openDatabasesPage(history: HistoryMode = "push") {
    if (!shell.desktopApiAvailable) return;
    if (history === "push") commitCurrent();
    // An engine game still being played goes on behind the page, as behind Play.
    if (useGameStore.getState().mode !== "engine") stopEngineWork();
    setFocusMode(false);
    showView("databases", history);
  }

  /** Broadcasts: the events Lichess relays live. Pages over the board, like Databases. */
  function openBroadcastsPage(history: HistoryMode = "push") {
    if (!shell.desktopApiAvailable) return;
    if (history === "push") commitCurrent();
    if (useGameStore.getState().mode !== "engine") stopEngineWork();
    setFocusMode(false);
    showView("broadcasts", history);
  }

  /** A tournament's page (its round, a board to outline), or the one a history entry kept. */
  function openBroadcastTournament(
    target: TournamentTarget | BroadcastScreen,
    history: HistoryMode = "push"
  ) {
    if (!shell.desktopApiAvailable) return;
    if (history === "push") commitCurrent();
    if (useGameStore.getState().mode !== "engine") stopEngineWork();
    setFocusMode(false);
    const screen: BroadcastScreen = { tab: "boards", ...target };
    shell.setBroadcastScreen(screen);
    latestNavigation.current += 1;
    setView(
      "broadcast-tournament",
      leavesRoute("broadcast-tournament") ? () => void navigate("/", { replace: true }) : undefined
    );
    record(history, { view: "broadcast-tournament", screen });
  }

  /** The tournament page's round or tab: the entry follows it (no step of its own). */
  function changeBroadcastScreen(screen: BroadcastScreen) {
    shell.setBroadcastScreen(screen);
    record("replace", { view: "broadcast-tournament", screen });
  }

  function openSettings(section: SettingsSectionId | null) {
    commitCurrent();
    shell.viewedSettingsSection.current = section;
    shell.setSettingsSection(section);
    record("push", { view: "settings", section });
    latestNavigation.current += 1;
    setView(
      "settings",
      leavesRoute("settings") ? () => void navigate("/", { replace: true }) : undefined
    );
  }

  /** The Settings section scrolled to (history records it, not where Settings opened). */
  function settingsSectionViewed(section: SettingsSectionId) {
    shell.viewedSettingsSection.current = section;
  }

  return {
    ...shell,
    record,
    clearPuzzleSession,
    showView,
    historyEntry,
    commitCurrent,
    endBoardActivity,
    stopEngineWork,
    showGame,
    unlessOnlineGame,
    openPlayPage,
    openFreshPlayPage,
    openPuzzlesPage,
    openDatabasesPage,
    openBroadcastsPage,
    openBroadcastTournament,
    changeBroadcastScreen,
    openSettings,
    settingsSectionViewed
  };
}

export type AppNavigation = ReturnType<typeof useAppNavigation>;
