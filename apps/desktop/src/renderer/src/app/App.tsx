import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { statusForFen } from "@chaturanga/shared/chess/position";
import { createGameFromFen } from "@chaturanga/shared/chess/pgn";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import type { ImportedGame } from "@chaturanga/shared/types/chess";
import { defaultSettings } from "@chaturanga/shared/types/settings";
import { Notice } from "@/components/ui/notice";
import { hasDesktopApi, isElectronMac } from "@/lib/environment";
import { positionStatus } from "@/lib/position-status";
import { appFrame, contentPanel } from "@/lib/ui";
import { useViewTransitionState, type ViewTransitionKind } from "@/lib/use-view-transition";
import { useEventCallback } from "@/lib/use-event-callback";
import { signalWindowReady } from "@/lib/window-glass";
import { cn } from "@/lib/utils";
import { loadSidebarExpanded, saveSidebarExpanded } from "@/lib/layout-prefs";
import { BoardFocusContext } from "../features/board/board-focus";
import { PromotionDialog } from "../features/board/PromotionDialog";
import type { ReviewTab } from "../features/game-review/review-utils";
import { PgnImportDialog } from "../features/game/PgnImportDialog";
import { openSavedGame } from "../features/game/saved-game";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import { usePuzzleAutoReply } from "../features/puzzles/puzzle-session";
import { usePuzzleAttemptRecording } from "../queries/puzzles";
import type { SettingsSectionId } from "../features/settings/SettingsPage";
import { useOnboarding } from "../features/onboarding/useOnboarding";
import {
  useEnginesQuery,
  useSamplePuzzleMutation,
  useSettingsQuery,
  useUpdateSettingMutation
} from "../queries/api";
import { repertoireKeys } from "../queries/repertoire";
import { useAnalysisStore } from "../stores/analysis-store";
import { analysisEngineFor, defaultEngineFor } from "../features/analysis/analysis-engine";
import { useGameStore } from "../stores/game-store";
import { useReviewStore } from "../stores/review-store";
import { selectLiveGameInProgress, useLichessStore } from "../stores/lichess-store";
import { useHistoryStore, type HistoryEntry } from "../stores/history-store";
import { captureEntry, recordHistory, type HistoryMode } from "./history-navigation";
import { saveStudyDraftFirst, useHistoryRestore } from "./navigation-coordinator";
import {
  nextPuzzleInput,
  puzzleBoard,
  usePuzzleSession,
  type PuzzleSetStart
} from "./puzzle-session-controller";
import { AppSidebar } from "./AppSidebar";
import {
  AppTitlebar,
  GameTitlebar,
  LiveGameButton,
  PageTitle,
  ReviewTitlebar
} from "./AppTitlebar";
import type { SideTab } from "./side-tabs";
import {
  AddToRepertoireDialog,
  AppPages,
  GameReviewPicker,
  OnboardingFlow,
  type AppView
} from "./AppPages";
import { PuzzleInfoPanel } from "./PuzzleInfoPanel";
import { useBoardShortcuts } from "./useBoardShortcuts";
import { useEngineDriver, type AnalysisOptions } from "./useEngineDriver";
import {
  flushGameAutosave,
  IMPORT_NEEDS_SAVE,
  mainlineEnd,
  useGameAutosave
} from "./useGameAutosave";
import { boardResultPatch } from "../features/analysis/post-game";
import { useUsageActivity } from "./useUsageTelemetry";
import { useLichess } from "./useLichess";
import { useHistoryShortcuts } from "./useHistoryShortcuts";
import { useMoveKeyboardShortcuts } from "./useMoveKeyboardShortcuts";
import { useMoveSounds } from "./useMoveSounds";
import { cancelActiveReview, useReviewRunner } from "./useReviewRunner";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { ErrorBoundary } from "@/components/error-boundary";
import { useAppNoticeStore } from "../stores/app-notice-store";
import { Button } from "@/components/ui/button";
import { useDatabaseDownloads } from "./useDatabaseDownloads";
import { draftFromSessionConfig, usePuzzleDraftStore } from "../stores/puzzle-draft-store";
import { usePuzzleStore } from "../stores/puzzle-store";
import { useQueryClient } from "@tanstack/react-query";
import type { Color } from "@chaturanga/shared/types/chess";
import type { StudyOpenTarget, StudyStage } from "../features/repertoire/repertoire-chapters";
import type { OpeningSide } from "../features/game-review/opening-comparison";
import { presetForSetup, type PracticePreset } from "../features/repertoire/practice-setup";
import type { StudyTab } from "../features/repertoire/RepertoireStudyPage";
import {
  RepertoirePracticeTitlebar,
  RepertoireStudyTitlebar
} from "../features/repertoire/RepertoireTitlebar";
import {
  flushChapterDraft,
  unsavedDecisionMessage,
  unsavedStudyCause
} from "../features/repertoire/useChapterAutosave";
import { useRepertoirePracticeStore } from "../stores/repertoire-practice-store";
import { useRepertoireWorkspaceStore } from "../stores/repertoire-workspace-store";
import { useAddToRepertoireStore } from "../stores/add-to-repertoire-store";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type AddFromGameResult,
  type RepertoireDetail
} from "@chaturanga/shared/types/repertoire";
import {
  buildInitialSession,
  handoffAtEnd,
  LIVE_GAME_NOTICE,
  NO_MOVES_TO_PLAY,
  repertoireCommandBlocked,
  reviewOpeningAfterFlush,
  type HandoffOrigin,
  type RepertoireCommand
} from "../features/repertoire/handoffs";
import { usePlayedGameLink } from "../features/repertoire/usePlayedGameLink";
import { usePlayDraftStore } from "../stores/play-draft-store";
import { useRepertoireHandoffStore } from "../stores/repertoire-handoff-store";
import type { RepertoireScreen } from "./AppPages";

/** What App keeps for the repertoire screens besides the ids in the URL. */
type RepertoireExtras = {
  nodeId: string | null;
  orientation: Color | null;
  tab: StudyTab;
  preset: Extract<RepertoireScreen, { view: "repertoire-practice" }>["preset"];
  /** A move to stage once the study chapter loads (from a game's opening comparison). */
  stage: StudyStage | null;
};

const initialRepertoireExtras: RepertoireExtras = {
  nodeId: null,
  orientation: null,
  tab: "moves",
  preset: null,
  stage: null
};

const boardViews: ReadonlySet<AppView> = new Set([
  "game",
  "game-review",
  "repertoire-study",
  "repertoire-practice"
]);
/** Views whose board is the game store's (the game's move keys apply there). */
const gameBoardViews: ReadonlySet<AppView> = new Set(["game", "game-review"]);
const repertoireViews: ReadonlySet<AppView> = new Set([
  "repertoire-hub",
  "repertoire-study",
  "repertoire-practice"
]);
/** Board ↔ board cross-fades in place (the board must not slide); anything with a page rises in. */
const viewTransitionKind = (previous: AppView, next: AppView): ViewTransitionKind =>
  boardViews.has(previous) && boardViews.has(next) ? "fade" : "lift";

/**
 * The app shell: sidebar, titlebar and the current view. Owns navigation between views and
 * the session resets that go with it; engine, autosave, sound and keyboard behaviour live in
 * the hooks mounted here.
 */
export function App() {
  // View changes animate the content panel and titlebar title (View Transitions; see app.css).
  const [appView, setAppView] = useViewTransitionState<AppView>("home", viewTransitionKind);
  const [importOpen, setImportOpen] = useState(false);
  const [gameReviewPickerOpen, setGameReviewPickerOpen] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>("notation");
  const [reviewTab, setReviewTab] = useState<ReviewTab>("commentary");
  /** The Opening tab's picked side (per game); game-review history entries carry it. */
  const [openingSide, setOpeningSide] = useState<OpeningSide | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId | null>(null);
  /** The Settings section being read (scroll-spy), which history records; the state above is only where Settings opens. */
  const viewedSettingsSection = useRef<SettingsSectionId | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  /**
   * Bumped by every game open and every view change. A saved game that finishes loading after
   * a newer selection (or after the user went elsewhere) is dropped instead of taking over.
   */
  const latestNavigation = useRef(0);
  // Expanded or the icon rail, as the user last left it (the sidebar toggle).
  const [actionRailOpen, setActionRailOpen] = useState(loadSidebarExpanded);
  useEffect(() => saveSidebarExpanded(actionRailOpen), [actionRailOpen]);
  const puzzleSession = usePuzzleSession();
  const activePuzzleConfig = puzzleSession.config;
  const onboarding = useOnboarding();

  // The Game Review workspace lives at /games/:id/review; every other view is at "/".
  const gameReviewMatch = useMatch("/games/:id/review");
  // The repertoire screens live at /repertoires… (ids in the URL; the rest is App state).
  const repertoireHubMatch = useMatch("/repertoires");
  const repertoireStudyMatch = useMatch("/repertoires/:id/chapters/:chapterId");
  const repertoirePracticeMatch = useMatch("/repertoires/:id/practice/:sessionId?");
  const routeRepertoireView: AppView | null = repertoireStudyMatch
    ? "repertoire-study"
    : repertoirePracticeMatch
      ? "repertoire-practice"
      : repertoireHubMatch
        ? "repertoire-hub"
        : null;
  const onRepertoireRoute = Boolean(routeRepertoireView);
  const [repertoireExtras, setRepertoireExtras] =
    useState<RepertoireExtras>(initialRepertoireExtras);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const onReviewRoute = Boolean(gameReviewMatch);
  // The window stays hidden until the shell's first frame is painted.
  useEffect(signalWindowReady, []);
  useEffect(() => {
    setAppView((view) => (onReviewRoute ? "game-review" : view === "game-review" ? "game" : view));
  }, [onReviewRoute, setAppView]);
  // A repertoire URL opened directly (start-up, reload) shows its screen.
  useEffect(() => {
    if (routeRepertoireView) setAppView(routeRepertoireView);
  }, [routeRepertoireView, setAppView]);

  const studyRepertoireId = repertoireStudyMatch?.params.id ?? null;
  const studyChapterId = repertoireStudyMatch?.params.chapterId ?? null;
  const practiceRepertoireId = repertoirePracticeMatch?.params.id ?? null;
  const practiceSessionId = repertoirePracticeMatch?.params.sessionId ?? null;
  const repertoireScreen = useMemo<RepertoireScreen | null>(() => {
    if (studyRepertoireId && studyChapterId) {
      return {
        view: "repertoire-study",
        repertoireId: studyRepertoireId,
        chapterId: studyChapterId,
        nodeId: repertoireExtras.nodeId,
        orientation: repertoireExtras.orientation,
        tab: repertoireExtras.tab,
        stage: repertoireExtras.stage
      };
    }
    if (practiceRepertoireId) {
      return {
        view: "repertoire-practice",
        repertoireId: practiceRepertoireId,
        sessionId: practiceSessionId,
        preset: repertoireExtras.preset
      };
    }
    return null;
  }, [
    studyRepertoireId,
    studyChapterId,
    practiceRepertoireId,
    practiceSessionId,
    repertoireExtras
  ]);

  // Focus mode only exists on a board view; leaving one ends it (the stored flag resets below).
  const onBoardView = boardViews.has(appView);
  const appNotice = useAppNoticeStore((state) => state.message);
  const appNoticeTone = useAppNoticeStore((state) => state.tone);
  const appNoticeAction = useAppNoticeStore((state) => state.action);
  const dismissAppNotice = useAppNoticeStore((state) => state.dismiss);
  const addToRepertoire = useAddToRepertoireStore((state) => state.request);
  const closeAddToRepertoire = useAddToRepertoireStore((state) => state.close);
  const focused = focusMode && onBoardView;
  // Focus mode collapses the sidebar to its rail without forgetting the user's own choice.
  const sidebarExpanded = actionRailOpen && !focused;
  useEffect(() => {
    if (!onBoardView) setFocusMode(false);
  }, [onBoardView]);

  const desktopApiAvailable = hasDesktopApi();
  const windowControlsVisible = isElectronMac();
  // Narrow subscriptions: the shell must not re-render on every move (it would cascade into the
  // sidebar, titlebar and every tooltip). Handlers read the store directly via currentGame().
  const { gameId, gameSource, gameMode, gameDecided, gameBoard } = useGameStore(
    useShallow((state) => ({
      gameId: state.gameId,
      gameSource: state.source,
      gameMode: state.mode,
      gameDecided: Boolean(state.gameOutcome),
      gameBoard: state.board
    }))
  );
  // A game played on from a puzzle: Next puzzle (after it) resumes the set.
  const puzzleSetContinues = puzzleSession.continues(gameBoard);
  const positionIsEnd = useGameStore((state) => positionStatus(state.currentFen).isEnd);
  // A puzzle opens to analysis once it's solved or failed (before that the engine would give it away).
  const puzzleDecided = usePuzzleStore(
    (state) => Boolean(state.activePuzzle) && state.outcome !== "pending"
  );
  // A Lichess game on the board: nothing may replace it and the engine stays off until it ends.
  const onlineGameLive = useLichessStore(selectLiveGameInProgress);
  const engines = useEnginesQuery();
  const nextPuzzle = useSamplePuzzleMutation();
  const settingsQuery = useSettingsQuery();
  const settings = useMemo(
    () => ({ ...defaultSettings, ...settingsQuery.data }),
    [settingsQuery.data]
  );
  const defaultEngineId = useMemo(() => defaultEngineFor(engines.data), [engines.data]);
  // Live analysis as Settings / the Engine tab's settings say: engine, lines and how far to search.
  const analysisOptions = useMemo<AnalysisOptions>(
    () => ({
      engineId: analysisEngineFor(engines.data, settings.analysisEngineId),
      multipv: settings.analysisLines,
      depth: settings.analysisLimit === "depth" ? settings.analysisDepth : null,
      moveTimeMs: settings.analysisLimit === "time" ? settings.analysisTimeSec * 1000 : null,
      resources: `${settings.engineThreads ?? "auto"}|${settings.engineHashMb}`
    }),
    [
      engines.data,
      settings.analysisEngineId,
      settings.analysisLines,
      settings.analysisLimit,
      settings.analysisDepth,
      settings.analysisTimeSec,
      settings.engineThreads,
      settings.engineHashMb
    ]
  );
  const reviewRouteId = gameReviewMatch?.params.id ?? null;
  const reviewRouteLoading = Boolean(
    reviewRouteId && reviewRouteId !== "current" && reviewRouteId !== gameId
  );
  const canAnalyzeGame =
    desktopApiAvailable &&
    !positionIsEnd &&
    gameSource !== "new" &&
    gameSource !== "puzzle" &&
    (gameMode === "freeplay" || ((gameMode === "engine" || gameMode === "online") && gameDecided));

  useLichess({ onGameStart: (load) => startOnlineGame(load) });
  // The repertoire board has its own move keys (they must not step the game behind it).
  useMoveKeyboardShortcuts({ enabled: gameBoardViews.has(appView) });
  useDatabaseDownloads();
  useEngineDriver(analysisOptions);
  useGameAutosave();
  usePlayedGameLink();
  const { mutate: updateSetting } = useUpdateSettingMutation();
  useUsageActivity();
  useMoveSounds({ enabled: settings.soundEnabled, volume: settings.soundVolume });
  usePuzzleAutoReply();
  usePuzzleAttemptRecording();
  const openReviewSettings = useCallback(() => setReviewTab("settings"), []);
  const { startReview, hasMoves: gameHasMoves } = useReviewRunner({
    engines: engines.data,
    settings,
    gameLoading: reviewRouteLoading,
    onEngineMissing: openReviewSettings
  });

  /**
   * Switches the view, leaving the review route when going anywhere else. `history`: "push" adds
   * the new screen to Back / Forward (after the caller committed the one being left), "replace"
   * swaps the current entry, "none" (Back / Forward themselves) records nothing.
   */
  function showView(view: AppView, history: HistoryMode = "push", tab: SideTab = sideTab) {
    latestNavigation.current += 1;
    // The route change belongs to the same view transition, so the old snapshot is the real old view.
    setAppView(view, leavesRoute(view) ? () => void navigate("/", { replace: true }) : undefined);
    record(history, historyEntry(view, tab));
  }

  /** Going to `view` leaves the review or repertoire route for "/". */
  function leavesRoute(view: AppView): boolean {
    return onReviewRoute ? view !== "game-review" : onRepertoireRoute && !repertoireViews.has(view);
  }

  // ---- Back / Forward -------------------------------------------------------------------------

  function historyEntry(view: AppView, tab: SideTab = sideTab): HistoryEntry {
    return captureEntry(view, {
      tab,
      reviewTab,
      openingSide,
      settingsSection: viewedSettingsSection.current ?? settingsSection,
      puzzleSet: puzzleSession.snapshot,
      puzzleSetContinues: puzzleSession.continues(currentGame().board),
      repertoireScreen
    });
  }

  const record = recordHistory;

  /** Saves the screen being left as it is now (so Back returns to it as it was left). */
  function commitCurrent() {
    useHistoryStore.getState().commitCurrent(historyEntry(appView));
  }

  /**
   * Back / Forward (navigation-coordinator.ts) through these commands; none records history (the
   * index moves once the screen is shown). `historyBusy` while a restore is still loading.
   */
  const { go: goHistory, busy: historyBusy } = useHistoryRestore({
    navigation: latestNavigation,
    commitCurrent: () => commitCurrent(),
    showLiveGame: () => showGame(sideTab, "none"),
    showHome: () => showView("home", "none"),
    showSettings: (section) => {
      viewedSettingsSection.current = section;
      setSettingsSection(section);
      showView("settings", "none");
    },
    openPlay: () => openPlayPage("none"),
    openPuzzles: () => openPuzzlesPage("none"),
    openDatabases: () => openDatabasesPage("none"),
    openRepertoireHub: () => openRepertoireHub("none"),
    openRepertoireStudy: (entry) => openRepertoireStudy(entry, "none"),
    openRepertoirePractice: (repertoireId, sessionId) =>
      openRepertoirePractice(repertoireId, { sessionId }, "none"),
    showGame: (tab) => showGame(tab, "none"),
    showGameReview: (entry) => {
      setReviewTab(entry.tab);
      setOpeningSide(
        entry.compareColor ? { board: currentGame().board, color: entry.compareColor } : null
      );
      const id = entry.board.gameId ?? "current";
      latestNavigation.current += 1;
      setAppView("game-review", () => void navigate(`/games/${id}/review`, { replace: true }));
    },
    startPuzzle: ({ sample, set }) => startPuzzle(sample, set ?? undefined, "none"),
    getSavedGame: (id) =>
      window.chaturanga?.games.get(id) ??
      Promise.reject(new Error("Saved games need the desktop app.")),
    stopEngineWork: (options) => stopEngineWork(options),
    clearPuzzleSession: () => clearPuzzleSession(),
    releasePuzzleSession: () => puzzleSession.release(currentGame().board),
    resumePuzzleSet: (set) => puzzleSession.resumeOnBoard(set, currentGame().board),
    endBoardActivity: () => endBoardActivity(),
    defaultEngineId,
    exitFocus: () => setFocusMode(false)
  });

  const clearPuzzleSession = puzzleSession.clear;

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

  /**
   * Play → Start: a new engine game replaces the board. The previous game's search and review end
   * here — a late best move or a finished review must not land in (or be saved with) the new game.
   */
  function beforeEngineGame() {
    commitCurrent();
    ++latestNavigation.current;
    stopEngineWork();
    useReviewStore.getState().reset();
    clearPuzzleSession();
  }

  function showGame(tab: SideTab = "notation", history: HistoryMode = "push") {
    setSideTab(tab);
    showView("game", history, tab);
  }

  async function exportPgn() {
    if (!window.chaturanga) return;
    try {
      await window.chaturanga.files.savePgnFile(
        "chaturanga-game.pgn",
        currentGame().toSession().pgn
      );
    } catch (error) {
      useAppNoticeStore
        .getState()
        .show(`Couldn't export the PGN: ${ipcErrorMessage(error) || "unknown error"}`);
    }
  }

  async function importPgnFile() {
    if (!window.chaturanga) return;
    const request = ++latestNavigation.current;
    try {
      const file = await window.chaturanga.files.openPgnFile();
      if (!file || request !== latestNavigation.current) return;
      // Pending edits first: the library's check for a copy must see the board as it is. If they
      // couldn't be saved, importing could add a copy of this very game: stop and say so.
      if (!(await flushGameAutosave())) {
        if (request === latestNavigation.current)
          useAppNoticeStore.getState().show(IMPORT_NEEDS_SAVE);
        return;
      }
      const imported = await window.chaturanga.games.importPgn({ pgn: file.contents });
      // A Lichess game (or another navigation) started meanwhile: it keeps the board.
      if (request !== latestNavigation.current) return;
      loadImportedGame(imported);
    } catch (error) {
      // Shown where you are (no navigation: the board didn't change).
      if (request === latestNavigation.current) {
        useAppNoticeStore
          .getState()
          .show(`Couldn't import that file: ${ipcErrorMessage(error) || "unknown error"}`);
      }
    }
  }

  /** An imported PGN (file or the paste dialog) onto the board; a warning (only the first of several games) shows on it. */
  function loadImportedGame(imported: ImportedGame) {
    // Already in the library: open that copy (with its analyses) rather than a duplicate.
    if (imported.existingGameId) {
      const existing = imported.existingGameId;
      void openSavedGameById(existing).then(() => {
        if (currentGame().gameId === existing)
          currentGame().setMatchFeedback("Already in your library: opened your copy.");
      });
      return;
    }
    commitCurrent();
    endBoardActivity();
    currentGame().loadGame(imported.game);
    currentGame().setMode("freeplay");
    if (imported.warning) currentGame().setMatchFeedback(imported.warning);
    showGame();
  }

  /** A Lichess game of yours began: clear the board's other activity, load it (`load`) and show it. */
  function startOnlineGame(load: () => void) {
    commitCurrent();
    // Close anything that could still load another game onto the board (showGame below also
    // invalidates board loads in flight: an import or a saved game resolving after this point).
    setImportOpen(false);
    setGameReviewPickerOpen(false);
    endBoardActivity();
    setFocusMode(false);
    load();
    showGame();
  }

  /**
   * While a Lichess game is on, actions that would replace the board bring you back to it instead
   * (the game keeps running on Lichess either way).
   */
  function unlessOnlineGame(action: () => void) {
    if (!useLichessStore.getState().live || useLichessStore.getState().live?.over) return action();
    // Already on the board: nothing changes screen, so nothing is recorded.
    if (appView === "game") showGame(sideTab, "none");
    else {
      commitCurrent();
      showGame();
    }
    currentGame().setMatchFeedback(LIVE_GAME_NOTICE);
  }

  /** Play → Free board: an empty board to play both sides. */
  function startFreeBoard() {
    commitCurrent();
    endBoardActivity();
    currentGame().reset();
    currentGame().setOrientation("white");
    setFocusMode(false);
    showGame();
  }

  function startLiveAnalysis() {
    if (!desktopApiAvailable) return;
    commitCurrent();
    stopEngineWork();
    // The board's review stays: it belongs to this game, and clearing it here made autosave write
    // "no review" over the saved one (the titlebar's Analyze keeps it too). A review still running
    // is left (cancelled above): its late result must not replace the saved review.
    useReviewStore.getState().detachRun();
    clearPuzzleSession();
    // An analysis board, engine off: the Engine tab offers the engine to use and Start analysis.
    currentGame().setMode("freeplay");
    currentGame().setGameSource("analysis");
    currentGame().setEngineSide(null);
    currentGame().clearEngineMatchExtras();
    setFocusMode(false);
    showGame("engine");
  }

  /** Titlebar "Stop analysis": leave live analysis but keep the position and moves (not a step of its own). */
  function stopLiveAnalysis() {
    latestNavigation.current += 1;
    currentGame().setMode("freeplay");
    useAnalysisStore.getState().setStatus("idle");
    record("replace", historyEntry("game"));
  }

  /**
   * "Analyze" in the titlebar / Engine tab: analyse the loaded game in place (keeps moves and
   * review). A finished match's result and clocks are cleared (the headers keep the result): with
   * them the board refuses moves and the engine won't search. Back returns to the game as it was.
   * From a finished position (after mate or stalemate), analysis starts at the move that ended it.
   */
  function analyzeCurrentPosition() {
    if (!desktopApiAvailable) return;
    commitCurrent();
    // A board still loading (Back / Forward, a saved game) must not replace this one afterwards.
    latestNavigation.current += 1;
    const { currentFen, currentNodeId, moveTree } = currentGame();
    const parentId = moveTree.find((node) => node.id === currentNodeId)?.parentId;
    if (positionStatus(currentFen).isEnd && parentId) currentGame().goToNode(parentId);
    currentGame().setEngineSide(null);
    currentGame().clearEngineMatchExtras();
    currentGame().setMode("analysis");
    if (defaultEngineId && !useAnalysisStore.getState().activeEngineId) {
      useAnalysisStore.getState().setActiveEngine(defaultEngineId);
    }
    useAnalysisStore.getState().restartBoardSearch();
    record("push", historyEntry("game"));
  }

  async function openSelectedGameReview(gameId: string, tab: ReviewTab = "commentary") {
    commitCurrent();
    const request = ++latestNavigation.current;
    if (gameId !== "current" && gameId !== currentGame().gameId) {
      // Load the other game first and swap board + review together. Clearing the current
      // review before the new game arrives would let autosave write the current game without
      // its review, and the review route would show the wrong board meanwhile.
      const saved = await window.chaturanga?.games.get(gameId).catch(() => null);
      if (request !== latestNavigation.current) return;
      if (!saved) {
        useGameStore.setState({ lastError: "Couldn't open that game." });
        return;
      }
      stopEngineWork();
      clearPuzzleSession();
      openSavedGame(saved);
    } else {
      stopEngineWork();
      // Back from the review returns to a game played on from a puzzle with its Next puzzle.
      puzzleSession.release(currentGame().board);
    }
    currentGame().setMode("freeplay");
    currentGame().setEngineSide(null);
    currentGame().clearEngineMatchExtras();
    setFocusMode(false);
    setReviewTab(tab);
    setGameReviewPickerOpen(false);
    setAppView("game-review", () => void navigate(`/games/${gameId}/review`, { replace: true }));
    record("push", historyEntry("game-review"));
  }

  /**
   * Home → Resume / a recent game: the board with that saved game (the loaded game is kept as is).
   * With `nodeId` (a repertoire source link), the board then shows that move when the game has it.
   */
  async function openSavedGameById(gameId: string, nodeId: string | null = null) {
    commitCurrent();
    const request = ++latestNavigation.current;
    if (gameId !== currentGame().gameId) {
      if (!window.chaturanga) return;
      const saved = await window.chaturanga.games.get(gameId).catch(() => null);
      if (request !== latestNavigation.current) return;
      if (!saved) {
        useGameStore.setState({ lastError: "Couldn't open that game." });
        return;
      }
      stopEngineWork();
      clearPuzzleSession();
      openSavedGame(saved);
      currentGame().setMode("freeplay");
      currentGame().setEngineSide(null);
      currentGame().clearEngineMatchExtras();
    }
    if (nodeId) currentGame().goToNode(nodeId);
    setFocusMode(false);
    showGame();
  }

  /** Play: the page with every way to start a game (Lichess, an engine, a free board). */
  function openPlayPage(history: HistoryMode = "push") {
    if (!desktopApiAvailable) {
      startFreeBoard();
      return;
    }
    if (history === "push") commitCurrent();
    // The engine keeps searching for a game still being played vs the engine; the page can end it.
    if (useGameStore.getState().mode !== "engine") stopEngineWork();
    clearPuzzleSession();
    setFocusMode(false);
    showView("play", history);
  }

  /**
   * Play opened by anything but Play from here (the sidebar, Home, after a game): a repertoire
   * handoff left from earlier is dropped, so its position doesn't start a game unasked. Back and
   * an Engine settings detour return through `openPlayPage` and keep it.
   */
  function openFreshPlayPage() {
    usePlayDraftStore.getState().clearInitialSession();
    openPlayPage();
  }

  function openPuzzlesPage(history: HistoryMode = "push") {
    if (!desktopApiAvailable) return;
    if (history === "push") commitCurrent();
    stopEngineWork();
    // The loaded game stays as it is until a puzzle replaces it (marking it a puzzle would save it
    // as one, which hides it from the library).
    setFocusMode(false);
    showView("puzzles", history);
  }

  function openSettings(section: SettingsSectionId | null) {
    commitCurrent();
    viewedSettingsSection.current = section;
    setSettingsSection(section);
    record("push", { view: "settings", section });
    latestNavigation.current += 1;
    setAppView(
      "settings",
      leavesRoute("settings") ? () => void navigate("/", { replace: true }) : undefined
    );
  }

  // ---- Repertoire ------------------------------------------------------------------------------
  // The repertoire screens never load anything into the game store: the game (and an engine game
  // still being played) stays as it is behind them.

  /** Shows a repertoire screen at `path`; the route change is part of the same view transition. */
  function showRepertoireView(view: AppView, path: string) {
    // Live analysis stops; a review of the game behind keeps running (Back to it shows its progress).
    // Study's engine panel stops its own search (closed, Study left, another chapter): while it is
    // open the engine already searches the study, not the board, and another visit to the same
    // chapter (Back, a transposition) keeps it running.
    const studyEngineOpen = useAnalysisStore.getState().target !== null;
    if (useGameStore.getState().mode !== "engine" && !studyEngineOpen)
      stopEngineWork({ keepReview: true });
    if (!boardViews.has(view) || !repertoireViews.has(appView)) setFocusMode(false);
    setAppView(view, () => void navigate(path, { replace: true }));
  }

  function openRepertoireHub(history: HistoryMode = "push") {
    if (history === "push") commitCurrent();
    latestNavigation.current += 1;
    showRepertoireView("repertoire-hub", "/repertoires");
    record(history, { view: "repertoire-hub" });
  }

  /**
   * Study at a chapter (and node). Leaving another chapter's draft saves it first; when that save
   * fails the draft stays open with its error (false). A newer navigation meanwhile wins (false).
   */
  async function openRepertoireStudy(
    target: Omit<StudyOpenTarget, "tab"> & { tab?: StudyTab; orientation?: Color | null },
    history: HistoryMode = "push"
  ): Promise<boolean> {
    if (history === "push") commitCurrent();
    const request = ++latestNavigation.current;
    const draft = useRepertoireWorkspaceStore.getState();
    // Only the study page being left can hold this back with its repertoire's unsaved decision
    // changes (the one opened lists its own on its chapter). A study left earlier (for the hub,
    // say) keeps its changes, with Retry and Discard, on its own page.
    const studying = studyOnScreen();
    const leaving = studying && studying !== target.repertoireId ? studying : null;
    const leftSaved = await saveStudyDraftFirst({
      request,
      navigation: latestNavigation,
      flush: () => flushChapterDraft(queryClient, leaving ? [leaving] : []),
      failure: () =>
        studyFailure(
          leaving,
          "the chapter",
          "This chapter couldn't be saved; retry the save before opening another one."
        ),
      keepChapterId: target.chapterId
    });
    if (!leftSaved) return false;
    // Restoring the chapter already open: put its node (no node is the root) and orientation
    // back directly.
    if (draft.repertoireId === target.repertoireId && draft.chapterId === target.chapterId) {
      draft.selectNode(target.nodeId ?? REPERTOIRE_ROOT_NODE_ID);
      if (target.orientation) draft.setOrientation(target.orientation);
    }
    const tab = target.tab ?? repertoireExtras.tab;
    // A staged move is applied once by the study page; history entries never carry it.
    setRepertoireExtras({
      nodeId: target.nodeId,
      orientation: target.orientation ?? null,
      tab,
      preset: null,
      stage: target.stage ?? null
    });
    showRepertoireView(
      "repertoire-study",
      `/repertoires/${encodeURIComponent(target.repertoireId)}/chapters/${encodeURIComponent(target.chapterId)}`
    );
    record(history, {
      view: "repertoire-study",
      repertoireId: target.repertoireId,
      chapterId: target.chapterId,
      nodeId: target.nodeId,
      tab,
      orientation: target.orientation ?? null
    });
    return true;
  }

  /**
   * Practice: the setup (no session, optionally with a preset), or a session to resume. A study
   * draft still saving (left through the hub, say) is saved first, so practice grades the edited
   * chapter; when that save fails, the notice says so and the current screen stays (false, as when
   * a newer navigation wins).
   */
  async function openRepertoirePractice(
    repertoireId: string,
    {
      sessionId = null,
      preset = null
    }: { sessionId?: string | null; preset?: RepertoireExtras["preset"] } = {},
    history: HistoryMode = "push"
  ): Promise<boolean> {
    if (history === "push") commitCurrent();
    const request = ++latestNavigation.current;
    // Held back by the study page being left and by this repertoire's unsaved changes (practice
    // shows its prompts and hints, and pauses), not by another repertoire's.
    const studying = studyOnScreen();
    const blockOn =
      studying && studying !== repertoireId ? [studying, repertoireId] : [repertoireId];
    const leftSaved = await saveStudyDraftFirst({
      request,
      navigation: latestNavigation,
      flush: () => flushChapterDraft(queryClient, blockOn),
      failure: () =>
        studyFailure(
          blockOn.find((id) => unsavedStudyCause(id) !== null) ?? null,
          "practice",
          "This chapter couldn't be saved; reopen it and retry the save before practising."
        )
    });
    if (!leftSaved) return false;
    setRepertoireExtras((extras) => ({ ...extras, preset }));
    showRepertoireView("repertoire-practice", practicePath(repertoireId, sessionId));
    record(history, { view: "repertoire-practice", repertoireId, sessionId });
    return true;
  }

  /** The session started on the setup page: same screen, now naming the session. */
  function practiceSessionStarted(sessionId: string) {
    if (repertoireScreen?.view !== "repertoire-practice") return;
    const { repertoireId } = repertoireScreen;
    void navigate(practicePath(repertoireId, sessionId), { replace: true });
    record("replace", { view: "repertoire-practice", repertoireId, sessionId });
  }

  /** "Practice again" / "Start a new session": back to the setup as a new step. */
  function practiceSetup() {
    if (repertoireScreen?.view !== "repertoire-practice") return;
    useRepertoirePracticeStore.getState().reset();
    void openRepertoirePractice(repertoireScreen.repertoireId, {
      preset: presetForSetup(repertoireScreen.preset)
    });
  }

  // ---- Repertoire handoffs (Study → Play from here) and the Lichess guard ----------------------

  /**
   * Runs a repertoire command unless a Lichess game being played would lose the screen to it; then
   * the board comes back with the notice instead (see unlessOnlineGame). Decided by the live game
   * state now, not by an earlier finish event.
   */
  function unlessRepertoireBlocked(command: RepertoireCommand, action: () => void) {
    if (!repertoireCommandBlocked(useLichessStore.getState(), command)) return action();
    unlessOnlineGame(action);
  }

  /** The open study chapter and selected node as a handoff's origin (null when none is loaded). */
  function studyHandoffOrigin(): HandoffOrigin | null {
    if (repertoireScreen?.view !== "repertoire-study") return null;
    const draft = useRepertoireWorkspaceStore.getState();
    if (
      !draft.chapter ||
      draft.repertoireId !== repertoireScreen.repertoireId ||
      draft.chapterId !== repertoireScreen.chapterId
    ) {
      return null;
    }
    const detail = queryClient.getQueryData<RepertoireDetail>(
      repertoireKeys.detail(repertoireScreen.repertoireId)
    );
    return {
      repertoireId: repertoireScreen.repertoireId,
      repertoireName: detail?.name ?? "Repertoire",
      color: draft.color,
      chapter: draft.chapter,
      nodeId: draft.selectedNodeId
    };
  }

  /**
   * Saves the study draft before a handoff leaves it. When it can't be saved the draft stays open
   * with its edits and the notice offers Retry (dismissing it stays on the chapter). False also
   * when a newer navigation (a Lichess game starting, say) took over meanwhile.
   */
  async function flushStudyForHandoff(
    request: number,
    action: string,
    retry: () => void
  ): Promise<boolean> {
    // Only the chapter's own repertoire holds the handoff back: another repertoire's unsaved
    // prompt or hint is written too, and waits on its own chapter when that fails.
    const repertoireId = useRepertoireWorkspaceStore.getState().repertoireId;
    const saved = await flushChapterDraft(queryClient, repertoireId ? [repertoireId] : []);
    if (request !== latestNavigation.current) return false;
    if (saved) return true;
    const cause = unsavedStudyCause(repertoireId);
    // Refused as stale: Retry would be refused again; the chapter's notice asks Keep mine or Discard.
    if (cause === "stale-decision") {
      useAppNoticeStore.getState().show(unsavedDecisionMessage(true, action));
      return false;
    }
    useAppNoticeStore
      .getState()
      .show(
        cause === "decision"
          ? unsavedDecisionMessage(false, action)
          : `This chapter couldn't be saved, so ${action} didn't open. Your edits are kept: retry, ` +
              "or dismiss to stay and keep editing.",
        {
          action: {
            label: "Retry",
            onSelect: () => {
              useRepertoireWorkspaceStore.getState().clearSaveError();
              retry();
            }
          }
        }
      );
    return false;
  }

  /**
   * A navigation's notice when the study draft it leaves stayed unsaved: the chapter's own
   * (`chapterMessage`), or the repertoire's prompt, hint or other decision change.
   */
  /** The repertoire whose study page is on screen (null on any other screen). */
  function studyOnScreen(): string | null {
    return repertoireScreen?.view === "repertoire-study" ? repertoireScreen.repertoireId : null;
  }

  function studyFailure(repertoireId: string | null, action: string, chapterMessage: string) {
    const cause = unsavedStudyCause(repertoireId);
    if (cause === "decision" || cause === "stale-decision") {
      return unsavedDecisionMessage(cause === "stale-decision", action);
    }
    return chapterMessage;
  }

  /**
   * The study's handoff origin once its draft is saved, or null with the reason shown: a Lichess
   * game that started meanwhile keeps the board (read again now, with its notice), the chapter is
   * no longer loaded, or its position is over.
   */
  function handoffOriginAfterFlush(
    command: RepertoireCommand,
    action: string
  ): HandoffOrigin | null {
    if (repertoireCommandBlocked(useLichessStore.getState(), command)) {
      unlessOnlineGame(() => {});
      return null;
    }
    const origin = studyHandoffOrigin();
    if (!origin) {
      useAppNoticeStore.getState().show(`The chapter isn't loaded, so ${action} didn't open.`);
      return null;
    }
    if (handoffAtEnd(origin)) {
      useAppNoticeStore.getState().show(`${NO_MOVES_TO_PLAY}.`, { tone: "info" });
      return null;
    }
    return origin;
  }

  /**
   * Study → Play from here: Play's engine setup with the selected position, its route and the
   * repertoire's colour (untimed unless a clock is picked). Back returns to the chapter.
   */
  async function playFromStudy() {
    if (!desktopApiAvailable) return;
    const request = ++latestNavigation.current;
    if (!(await flushStudyForHandoff(request, "Play from here", () => on.playFromStudy()))) return;
    const origin = handoffOriginAfterFlush("play-from-here", "Play from here");
    if (!origin) return;
    usePlayDraftStore.getState().setInitialSession(buildInitialSession(origin));
    useLichessStore.getState().setPlayOpponent("engine");
    openPlayPage();
  }

  /** After a game played from a repertoire: the chapter and position it started from. */
  function returnToRepertoire() {
    const played = useRepertoireHandoffStore.getState().played;
    if (!played) return;
    void openRepertoireStudy({
      repertoireId: played.repertoireId,
      chapterId: played.chapterId,
      nodeId: played.nodeId
    });
  }

  /**
   * After a game played from a repertoire: Game review on the Opening tab, comparing as the
   * repertoire's colour against that repertoire (remembered for the colour, like a pick there).
   */
  async function reviewHandoffOpening() {
    if (!useRepertoireHandoffStore.getState().played) return;
    const request = ++latestNavigation.current;
    // The game's library id (its first save may still be waiting) names the review route.
    await flushGameAutosave();
    const played = useRepertoireHandoffStore.getState().played;
    const decision = reviewOpeningAfterFlush({
      request,
      latestRequest: latestNavigation.current,
      liveState: useLichessStore.getState(),
      played,
      gameId: currentGame().gameId
    });
    if (decision === "blocked") unlessOnlineGame(() => {});
    if (decision === "gone") {
      useAppNoticeStore
        .getState()
        .show("That game is no longer on the board, so its opening wasn't reviewed.");
    }
    if (decision !== "go" || !played) return;
    updateSetting({
      key: played.color === "white" ? "repertoireCompareWhite" : "repertoireCompareBlack",
      value: played.repertoireId
    });
    setOpeningSide({ board: currentGame().board, color: played.color });
    await openSelectedGameReview("current", "opening");
  }

  /**
   * After an engine game (one played on from a puzzle too): Game review of it, its review started
   * at once unless it already has one.
   */
  async function reviewFinishedEngineGame() {
    const request = ++latestNavigation.current;
    // The game's library id (its first save may still be waiting) names what the review saves to.
    await flushGameAutosave();
    if (request !== latestNavigation.current) return;
    // Ended on the board (mate, stalemate): the review shows its result like a resignation's.
    const game = currentGame();
    const result = boardResultPatch({
      gameOutcome: game.gameOutcome,
      headers: game.headers,
      endFen: mainlineEnd(game.moveTree)?.fenAfter ?? game.currentFen
    });
    if (result) game.patchHeaders(result);
    const reviewed = Boolean(useReviewStore.getState().review);
    await openSelectedGameReview("current");
    if (!reviewed) void startReview();
  }

  function openDatabasesPage(history: HistoryMode = "push") {
    if (!desktopApiAvailable) return;
    if (history === "push") commitCurrent();
    stopEngineWork();
    setFocusMode(false);
    showView("databases", history);
  }

  function playEngineFromCurrentPuzzlePosition() {
    if (!desktopApiAvailable) return;
    const engine = engines.data?.find((item) => item.id === defaultEngineId) ?? engines.data?.[0];
    if (!engine) {
      void cancelActiveReview();
      commitCurrent();
      showView("settings");
      return;
    }
    const fen = useGameStore.getState().currentFen;
    const position = statusForFen(fen);
    if (position.isEnd) {
      currentGame().setMatchFeedback("This puzzle position is already finished.");
      return;
    }
    const engineSide = position.turn;
    const humanSide = engineSide === "white" ? "black" : "white";
    commitCurrent();
    // Not endBoardActivity: the puzzle set stays, so Next puzzle resumes it once this game ends.
    stopEngineWork();
    useReviewStore.getState().reset();
    currentGame().loadGame(
      createGameFromFen({
        fen,
        source: "engine-game",
        headers: {
          event: "Puzzle continuation",
          site: "?",
          result: "*",
          white: engineSide === "white" ? engine.name : "You",
          black: engineSide === "black" ? engine.name : "You",
          orientationHint: humanSide
        }
      })
    );
    puzzleSession.continueOnBoard(currentGame().board);
    currentGame().setOrientation(humanSide);
    currentGame().setMode("engine");
    currentGame().setEngineSide(engineSide);
    currentGame().setEngineMatchClock(null);
    currentGame().clearEngineMatchExtras();
    currentGame().setMatchFeedback("Playing engine from puzzle position.");
    const analysis = useAnalysisStore.getState();
    analysis.setActiveEngine(engine.id);
    analysis.setStatus("ready");
    analysis.setError(null);
    setFocusMode(false);
    showGame();
  }

  /**
   * Loads a puzzle onto the board. `set` starts a puzzle set (a new one: a history step; or one
   * history brings back); without it the set continues (the next puzzle takes the current entry's place).
   */
  function startPuzzle(
    puzzle: PuzzleSample,
    set?: PuzzleSetStart,
    history: HistoryMode = set ? "push" : "replace"
  ) {
    if (history === "push") commitCurrent();
    stopEngineWork();
    useReviewStore.getState().reset();
    puzzleSession.begin(puzzle, set);
    currentGame().loadGame(puzzleBoard(puzzle));
    currentGame().setMode("puzzle");
    currentGame().setGameSource("puzzle");
    currentGame().setOrientation(puzzle.sideToMove);
    showGame("notation", history);
  }

  function loadNextPuzzle() {
    void cancelActiveReview();
    const input = nextPuzzleInput(activePuzzleConfig, puzzleSession.shownIds);
    if (!input) {
      commitCurrent();
      showView("puzzles");
      return;
    }
    // The next puzzle takes over only if nothing else was opened while it loaded.
    const request = latestNavigation.current;
    // After a game played on from a puzzle, that game stays a step of its own (Back returns to it).
    const fromGame = puzzleSetContinues;
    nextPuzzle.mutate(input, {
      onSuccess: (puzzle) => {
        if (request === latestNavigation.current)
          startPuzzle(puzzle, undefined, fromGame ? "push" : "replace");
      },
      onError: (error) => {
        // The puzzle card shows the error on a puzzle; the game's titlebar does after a game.
        if (fromGame && request === latestNavigation.current) {
          currentGame().setMatchFeedback(
            `Couldn't load the next puzzle: ${ipcErrorMessage(error) || "unknown error"}`
          );
        }
      }
    });
  }

  // Stable handler identities, so the memoised sidebar / titlebar / pages skip unrelated renders.
  const on = {
    // "Show sidebar" while focused brings the whole frame back (sidebar and panel).
    toggleSidebar: useEventCallback(() => {
      if (focused) {
        setFocusMode(false);
        setActionRailOpen(true);
      } else setActionRailOpen((open) => !open);
    }),
    home: useEventCallback(() => {
      commitCurrent();
      showView("home");
    }),
    settings: useEventCallback(() => openSettings(null)),
    commentarySettings: useEventCallback(() => openSettings("ai")),
    openSettings: useEventCallback((section: SettingsSectionId) => openSettings(section)),
    engineSettings: useEventCallback(() => openSettings("engines")),
    back: useEventCallback(() => void goHistory(-1)),
    forward: useEventCallback(() => void goHistory(1)),
    settingsSectionViewed: useEventCallback((section: SettingsSectionId) => {
      viewedSettingsSection.current = section;
    }),
    importedGame: useEventCallback((imported: ImportedGame) =>
      unlessOnlineGame(() => loadImportedGame(imported))
    ),
    beforePlayStart: useEventCallback(beforeEngineGame),
    play: useEventCallback(() => openFreshPlayPage()),
    freeBoard: useEventCallback(() => unlessOnlineGame(startFreeBoard)),
    liveAnalysis: useEventCallback(() => unlessOnlineGame(startLiveAnalysis)),
    stopLiveAnalysis: useEventCallback(stopLiveAnalysis),
    analyzePosition: useEventCallback(analyzeCurrentPosition),
    openReviewPicker: useEventCallback(() => unlessOnlineGame(() => setGameReviewPickerOpen(true))),
    closeReviewPicker: useEventCallback(() => setGameReviewPickerOpen(false)),
    openImportDialog: useEventCallback(() => setImportOpen(true)),
    closeImportDialog: useEventCallback(() => setImportOpen(false)),
    reviewGame: useEventCallback((id: string) =>
      unlessOnlineGame(() => void openSelectedGameReview(id))
    ),
    // After a Lichess game: Play, on its Lichess tab.
    playLichess: useEventCallback(() => {
      useLichessStore.getState().setPlayOpponent("lichess");
      openFreshPlayPage();
    }),
    puzzles: useEventCallback(() => unlessOnlineGame(() => openPuzzlesPage())),
    databases: useEventCallback(() => openDatabasesPage()),
    // Databases → "Train with this dataset": Puzzles with that dataset chosen (other filters kept).
    trainWithDatabase: useEventCallback((databaseId: string) =>
      // A Lichess game on the board keeps it (like the Puzzles item).
      unlessOnlineGame(() => {
        usePuzzleDraftStore.getState().update({ databaseId });
        openPuzzlesPage();
      })
    ),
    importPgn: useEventCallback(() => unlessOnlineGame(() => void importPgnFile())),
    exportPgn: useEventCallback(() => void exportPgn()),
    toggleFocus: useEventCallback(() => setFocusMode((value) => !value)),
    exitFocus: useEventCallback(() => setFocusMode(false)),
    // Flip turns the board on screen: the repertoire boards keep their own orientation (grading
    // and the repertoire's colour never change with it).
    flipBoard: useEventCallback(() => {
      if (appView === "repertoire-study") useRepertoireWorkspaceStore.getState().flip();
      else if (appView === "repertoire-practice") useRepertoirePracticeStore.getState().flip();
      else currentGame().flip();
    }),
    openGame: useEventCallback((id: string) => unlessOnlineGame(() => void openSavedGameById(id))),
    startReview: useEventCallback(() => void startReview()),
    stopReview: useEventCallback(() => void cancelActiveReview()),
    showGame: useEventCallback(() => showGame()),
    startPuzzle: useEventCallback((config: PuzzleSessionConfig, puzzle: PuzzleSample) =>
      startPuzzle(puzzle, { config })
    ),
    openGameFromLibrary: useEventCallback((id: string) =>
      unlessOnlineGame(() => void openSavedGameById(id))
    ),
    nextPuzzle: useEventCallback(loadNextPuzzle),
    playEngineFromPuzzle: useEventCallback(playEngineFromCurrentPuzzlePosition),
    // The puzzle card's "Edit set": the Puzzles page with the running set's filters, to start a new set.
    editPuzzleSet: useEventCallback(() => {
      if (activePuzzleConfig)
        usePuzzleDraftStore.getState().update(draftFromSessionConfig(activePuzzleConfig));
      openPuzzlesPage();
    }),
    reviewCurrentGame: useEventCallback(() => void openSelectedGameReview("current")),
    reviewEngineGame: useEventCallback(() => void reviewFinishedEngineGame()),
    repertoireHub: useEventCallback(() => openRepertoireHub()),
    openRepertoireStudy: useEventCallback((target: StudyOpenTarget) =>
      unlessRepertoireBlocked(
        target.stage ? "stage-response" : "open-study",
        () => void openRepertoireStudy(target)
      )
    ),
    // "Refresh this decision" (a game's opening comparison): a targeted queue that starts at once.
    // Back returns to the review left (its tab and move are committed first).
    refreshRepertoireDecision: useEventCallback((repertoireId: string, positionKey: string) =>
      unlessRepertoireBlocked(
        "refresh-decision",
        () =>
          void openRepertoirePractice(repertoireId, {
            preset: { mode: "review-due", positionKeys: [positionKey], autoStart: true }
          })
      )
    ),
    repertoireStageApplied: useEventCallback(() =>
      setRepertoireExtras((extras) => ({ ...extras, stage: null }))
    ),
    openRepertoirePractice: useEventCallback((repertoireId: string) =>
      unlessRepertoireBlocked("open-practice", () => void openRepertoirePractice(repertoireId))
    ),
    // "Review now" / "Review due": the setup in Review due over every chapter, whatever the last
    // session's draft was (a Learn new draft would otherwise hide the due decisions).
    reviewRepertoire: useEventCallback((repertoireId: string) =>
      unlessRepertoireBlocked(
        "open-practice",
        () =>
          void openRepertoirePractice(repertoireId, {
            preset: { mode: "review-due", chapterIds: [] }
          })
      )
    ),
    resumeRepertoirePractice: useEventCallback(
      ({ repertoireId, sessionId }: { repertoireId: string; sessionId: string }) =>
        unlessRepertoireBlocked(
          "resume-practice",
          () => void openRepertoirePractice(repertoireId, { sessionId })
        )
    ),
    practiceRepertoireChapters: useEventCallback((repertoireId: string, chapterIds: string[]) =>
      unlessRepertoireBlocked(
        "open-practice",
        () => void openRepertoirePractice(repertoireId, { preset: { chapterIds } })
      )
    ),
    // "Rehearse this chapter / from here" (Study) and "Rehearse again" (a summary): the rehearsal
    // starts at once, as a new step (Back returns to where it was asked for).
    rehearseRepertoire: useEventCallback((repertoireId: string, preset: PracticePreset) =>
      unlessRepertoireBlocked("open-practice", () => {
        useRepertoirePracticeStore.getState().reset();
        void openRepertoirePractice(repertoireId, { preset });
      })
    ),
    // A chapter / repertoire gone since (deleted, or a stale history entry): the hub, with why.
    repertoireMissing: useEventCallback((message: string) => {
      useAppNoticeStore.getState().show(message);
      openRepertoireHub("replace");
    }),
    repertoireTabChange: useEventCallback((tab: StudyTab) =>
      setRepertoireExtras((extras) => ({ ...extras, tab }))
    ),
    // Moving through the tree, switching tabs or flipping updates the entry; it never adds one.
    // Not while Back / Forward is showing a screen: the current entry is still the one being left.
    repertoirePositionChanged: useEventCallback(() => {
      if (appView === "repertoire-study" && !historyBusy.current)
        record("replace", historyEntry("repertoire-study"));
    }),
    // A repertoire source link: the saved game on the board at the linked move (no move: the
    // game's start, even when the game is already open at a later move).
    openGameAtNode: useEventCallback((gameId: string, nodeId: string | null) =>
      unlessOnlineGame(() => void openSavedGameById(gameId, nodeId ?? "root"))
    ),
    closeAddToRepertoire: useEventCallback(closeAddToRepertoire),
    // Added: the dialog closes and the notice offers the chapter (Back returns here).
    addedToRepertoire: useEventCallback((result: AddFromGameResult) => {
      closeAddToRepertoire();
      const target = {
        repertoireId: result.repertoire.id,
        chapterId: result.chapter.id,
        nodeId: REPERTOIRE_ROOT_NODE_ID
      };
      useAppNoticeStore
        .getState()
        .show(`Added to ${result.repertoire.name} › ${result.chapter.title}`, {
          tone: "success",
          action: { label: "Open chapter", onSelect: () => on.openRepertoireStudy(target) }
        });
    }),
    repertoirePracticeStarted: useEventCallback(practiceSessionStarted),
    repertoirePracticeSetup: useEventCallback(() =>
      unlessRepertoireBlocked("open-practice", practiceSetup)
    ),
    playFromStudy: useEventCallback(() =>
      unlessRepertoireBlocked("play-from-here", () => void playFromStudy())
    ),
    returnToRepertoire: useEventCallback(() =>
      unlessRepertoireBlocked("return-to-repertoire", returnToRepertoire)
    ),
    reviewHandoffOpening: useEventCallback(() =>
      unlessRepertoireBlocked("review-opening", () => void reviewHandoffOpening())
    )
  };
  useHistoryShortcuts({ onBack: on.back, onForward: on.forward });
  useBoardShortcuts({
    enabled: onBoardView,
    focused,
    onToggleFocus: on.toggleFocus,
    onExitFocus: on.exitFocus,
    onFlip: on.flipBoard
  });

  const sidebarActive = useMemo(
    () => ({
      home: appView === "home",
      analyze: appView === "game" && gameMode === "analysis",
      review: appView === "game-review" || gameReviewPickerOpen,
      repertoire: repertoireViews.has(appView),
      play: appView === "play",
      puzzles: appView === "puzzles",
      databases: appView === "databases",
      settings: appView === "settings"
    }),
    [appView, gameMode, gameReviewPickerOpen]
  );

  const puzzlePanel = useMemo(
    () => (
      <PuzzleInfoPanel
        nextError={nextPuzzle.error}
        nextPending={nextPuzzle.isPending}
        onNextPuzzle={on.nextPuzzle}
        onPlayEngineFromHere={on.playEngineFromPuzzle}
        onEditSet={on.editPuzzleSet}
        puzzleConfig={activePuzzleConfig}
      />
    ),
    [
      nextPuzzle.error,
      nextPuzzle.isPending,
      on.nextPuzzle,
      on.playEngineFromPuzzle,
      on.editPuzzleSet,
      activePuzzleConfig
    ]
  );

  const pageTitles: Partial<Record<AppView, string>> = {
    home: "Home",
    settings: "Settings",
    play: "Play",
    puzzles: "Puzzles",
    databases: "Databases",
    "repertoire-hub": "Repertoire"
  };

  return (
    <BoardFocusContext.Provider value={focused}>
      {/* The app frame: one titlebar row over the sidebar and the inset content panel. */}
      <div
        // Under the welcome the app is out of reach (focus, clicks, assistive tech).
        inert={onboarding.open}
        className={cn(
          appFrame,
          "grid-cols-[var(--sidebar-width)_minmax(0,1fr)] grid-rows-[var(--titlebar-height)_minmax(0,1fr)] [--titlebar-height:calc(54px/var(--window-zoom,1))]",
          // The sidebar column eases open/closed; the content panel follows it frame by frame.
          "transition-[grid-template-columns] duration-emphasis ease-standard",
          // rem: the sidebar grows with the type step on big monitors (app.css), like the rest of the UI.
          sidebarExpanded
            ? "[--sidebar-width:clamp(12.5rem,17vw,17rem)]"
            : "[--sidebar-width:3.5rem]"
        )}
      >
        <AppTitlebar
          windowControlsInset={windowControlsVisible}
          sidebarExpanded={sidebarExpanded}
          onToggleSidebar={on.toggleSidebar}
          onBack={on.back}
          onForward={on.forward}
        >
          {appView === "game-review" ? (
            <ReviewTitlebar
              gameLoading={reviewRouteLoading}
              hasMoves={gameHasMoves}
              onAnalyze={on.startReview}
              onStop={on.stopReview}
            />
          ) : appView === "repertoire-study" && repertoireScreen ? (
            <RepertoireStudyTitlebar
              repertoireId={repertoireScreen.repertoireId}
              onHub={on.repertoireHub}
            />
          ) : appView === "repertoire-practice" && repertoireScreen ? (
            <RepertoirePracticeTitlebar
              repertoireId={repertoireScreen.repertoireId}
              onHub={on.repertoireHub}
            />
          ) : appView === "game" ? (
            <GameTitlebar
              engines={engines.data}
              showAnalysisError={sideTab !== "engine" || focused}
              canAnalyze={canAnalyzeGame}
              onAnalyze={on.analyzePosition}
              onStopAnalysis={
                gameMode === "analysis" && desktopApiAvailable ? on.stopLiveAnalysis : null
              }
              onReviewGame={on.reviewCurrentGame}
              onPlayAgain={on.playLichess}
              onReviewEngineGame={on.reviewEngineGame}
              onNextPuzzle={puzzleSetContinues ? on.nextPuzzle : null}
              nextPuzzlePending={nextPuzzle.isPending}
              onReviewOpening={on.reviewHandoffOpening}
              onReturnToRepertoire={on.returnToRepertoire}
            />
          ) : (
            <>
              <PageTitle>{pageTitles[appView]}</PageTitle>
              {onlineGameLive ? <LiveGameButton onClick={on.showGame} /> : null}
            </>
          )}
        </AppTitlebar>

        <AppSidebar
          expanded={sidebarExpanded}
          active={sidebarActive}
          boardView={onBoardView}
          focusMode={focused}
          onHome={on.home}
          onPlay={on.play}
          onAnalyze={on.liveAnalysis}
          onReview={on.openReviewPicker}
          onRepertoire={on.repertoireHub}
          onPuzzles={on.puzzles}
          onDatabases={on.databases}
          onImport={on.importPgn}
          onExport={on.exportPgn}
          onFocusToggle={on.toggleFocus}
          onFlip={on.flipBoard}
          onSettings={on.settings}
        />

        <main
          className={cn(contentPanel, "col-start-2 row-start-2 [view-transition-name:app-content]")}
        >
          {appNotice ? (
            <Notice
              tone={appNoticeTone}
              className="mx-(--page-gutter) mt-(--page-gutter-y) w-auto shrink-0"
              action={
                <div className="flex gap-2">
                  {appNoticeAction ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        dismissAppNotice();
                        appNoticeAction.onSelect();
                      }}
                    >
                      {appNoticeAction.label}
                    </Button>
                  ) : null}
                  <Button type="button" variant="link" size="xs" onClick={dismissAppNotice}>
                    Dismiss
                  </Button>
                </div>
              }
            >
              {appNotice}
            </Notice>
          ) : null}
          {!desktopApiAvailable ? (
            <Notice
              tone="warn"
              title="Web preview mode"
              className="mx-(--page-gutter) mt-(--page-gutter-y) w-auto shrink-0"
            >
              Engines, file dialogs, saved games, downloads and local databases need the desktop
              app.
            </Notice>
          ) : null}
          <div className="grid min-h-0 flex-1">
            {/* A render error in one page shows a recoverable panel there, not a blank window; the
                key resets it when you go elsewhere. */}
            <ErrorBoundary
              key={appView}
              title="This page hit an unexpected error"
              scope={appView}
              layout="panel"
            >
              <AppPages
                view={appView}
                desktopApiAvailable={desktopApiAvailable}
                settingsSection={settingsSection}
                settings={settings}
                settingsReady={settingsQuery.isSuccess}
                reviewTab={reviewTab}
                onReviewTabChange={setReviewTab}
                openingSide={openingSide}
                onOpeningSideChange={setOpeningSide}
                reviewLoading={reviewRouteLoading}
                sideTab={sideTab}
                onSideTabChange={setSideTab}
                canStartAnalysis={
                  desktopApiAvailable &&
                  (gameMode === "freeplay" || (gameMode === "puzzle" && puzzleDecided)) &&
                  !positionIsEnd
                }
                puzzlePanel={puzzlePanel}
                repertoire={repertoireScreen}
                on={on}
              />
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <PromotionDialog />
      <Suspense fallback={null}>
        {onboarding.open ? (
          <OnboardingFlow onFinish={onboarding.finish} onGoHome={on.home} />
        ) : null}
        {importOpen ? (
          <PgnImportDialog onClose={on.closeImportDialog} onImported={on.importedGame} />
        ) : null}
        {addToRepertoire ? (
          <AddToRepertoireDialog
            source={addToRepertoire.source}
            initialScope={addToRepertoire.initialScope}
            preselect={addToRepertoire.preselect}
            onClose={on.closeAddToRepertoire}
            onDone={on.addedToRepertoire}
          />
        ) : null}
        {gameReviewPickerOpen ? (
          <GameReviewPicker
            onClose={on.closeReviewPicker}
            onSelect={on.reviewGame}
            onImport={on.openImportDialog}
          />
        ) : null}
      </Suspense>
    </BoardFocusContext.Provider>
  );
}

const currentGame = () => useGameStore.getState();

/** The practice route: the setup, or a session. */
function practicePath(repertoireId: string, sessionId: string | null): string {
  const base = `/repertoires/${encodeURIComponent(repertoireId)}/practice`;
  return sessionId ? `${base}/${encodeURIComponent(sessionId)}` : base;
}
