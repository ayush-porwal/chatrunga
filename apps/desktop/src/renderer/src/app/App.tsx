import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { GameMode } from "@chaturanga/shared/types/chess";
import { defaultSettings } from "@chaturanga/shared/types/settings";
import { hasDesktopApi, isElectronMac } from "@/lib/environment";
import { positionStatus } from "@/lib/position-status";
import { appFrame, contentPanel } from "@/lib/ui";
import { useViewTransitionState, type ViewTransitionKind } from "@/lib/use-view-transition";
import { useEventCallback } from "@/lib/use-event-callback";
import { signalWindowReady } from "@/lib/window-glass";
import { cn } from "@/lib/utils";
import { loadSidebarExpanded, saveSidebarExpanded } from "@/lib/layout-prefs";
import { BoardFocusContext } from "../features/board/board-focus";
import { useBroadcastFollow } from "../features/broadcasts/broadcast-follow";
import { useGameEndAlerts } from "../features/broadcasts/game-alerts";
import type { BroadcastScreen } from "../features/broadcasts/navigation";
import type { ReviewTab } from "../features/game-review/review-utils";
import { openReviewSettingsDialog } from "../features/game-review/ReviewSettingsDialog";
import type { SettingsSectionId } from "../features/settings/SettingsPage";
import { useOnboarding } from "../features/onboarding/useOnboarding";
import { usePuzzleAutoReply } from "../features/puzzles/puzzle-session";
import { useBroadcastEventSubscription } from "../queries/broadcasts";
import { usePuzzleAttemptRecording } from "../queries/puzzles";
import {
  useEnginesQuery,
  useSamplePuzzleMutation,
  useSettingsQuery,
  useUpdateSettingMutation
} from "../queries/api";
import { useAnalysisStore } from "../stores/analysis-store";
import { analysisEngineFor, defaultEngineFor } from "../features/analysis/analysis-engine";
import { useGameStore } from "../stores/game-store";
import { usePuzzleStore } from "../stores/puzzle-store";
import { useAppNoticeStore } from "../stores/app-notice-store";
import { useQueryClient } from "@tanstack/react-query";
import type { OpeningSide } from "../features/game-review/opening-comparison";
import { usePlayedGameLink } from "../features/repertoire/usePlayedGameLink";
import { ErrorBoundary } from "@/components/error-boundary";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { followFullScreen } from "./full-screen";
import {
  restoreReviewRoute,
  reviewRouteToRestore,
  savedReviewPath,
  useHistoryRestore
} from "./navigation-coordinator";
import { usePuzzleSession } from "./puzzle-session-controller";
import { AppSidebar } from "./AppSidebar";
import { sidebarActiveFor } from "./sidebar-active";
import { AppTitlebar } from "./AppTitlebar";
import { showsEngine, type SideTab } from "./side-tabs";
import { usePuzzleTabs } from "./use-puzzle-tabs";
import { AppPages, type AppView } from "./AppPages";
import { PuzzleInfoPanel } from "./PuzzleInfoPanel";
import { useBoardShortcuts } from "./useBoardShortcuts";
import { useEngineDriver, type AnalysisOptions } from "./useEngineDriver";
import { useGameAutosave } from "./useGameAutosave";
import { useUsageActivity } from "./useUsageTelemetry";
import { useLichess } from "./useLichess";
import { useChesscom } from "./useChesscom";
import { useHistoryShortcuts } from "./useHistoryShortcuts";
import { useMoveKeyboardShortcuts } from "./useMoveKeyboardShortcuts";
import { useMoveSounds } from "./useMoveSounds";
import { useReviewRunner } from "./useReviewRunner";
import { useDatabaseDownloads } from "./useDatabaseDownloads";
import { boardViews, currentGame, gameBoardViews, useAppNavigation } from "./app-navigation";
import { useBoardCommands } from "./board-commands";
import { useBroadcastCommands } from "./broadcast-commands";
import { usePuzzleCommands } from "./puzzle-commands";
import { useRepertoireCommands } from "./repertoire-commands";
import { useAppCommands } from "./useAppCommands";
import { useRepertoireRoute } from "./useRepertoireRoute";
import { AppDialogs } from "./AppDialogs";
import { AppNotices } from "./AppNotices";
import { ViewTitlebar } from "./ViewTitlebar";

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
  const [appView, setAppView] = useViewTransitionState<AppView>("play", viewTransitionKind);
  const [importOpen, setImportOpen] = useState(false);
  const [gameReviewPickerOpen, setGameReviewPickerOpen] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>("notation");
  const [reviewTab, setReviewTab] = useState<ReviewTab>("summary");
  /** The Opening tab's picked side (per game); game-review history entries carry it. */
  const [openingSide, setOpeningSide] = useState<OpeningSide | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId | null>(null);
  /** The broadcast tournament screen (its round and tab), kept while you go elsewhere. */
  const [broadcastScreen, setBroadcastScreen] = useState<BroadcastScreen | null>(null);
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
  const onboarding = useOnboarding();

  // The Game Review workspace lives at /games/:id/review; every other view is at "/".
  const gameReviewMatch = useMatch("/games/:id/review");
  const {
    routeView: routeRepertoireView,
    screen: repertoireScreen,
    extras: repertoireExtras,
    setExtras: setRepertoireExtras
  } = useRepertoireRoute();
  const onRepertoireRoute = Boolean(routeRepertoireView);
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

  // Focus mode only exists on a board view; leaving one ends it (the stored flag resets below).
  const onBoardView = boardViews.has(appView);
  const focused = focusMode && onBoardView;
  // The Moves tab's engine block shows an analysis error itself; while a puzzle hides the block,
  // the titlebar shows it instead.
  const engineBlockShown = showsEngine(usePuzzleTabs());
  // Focus mode collapses the sidebar to its rail without forgetting the user's own choice.
  const sidebarExpanded = actionRailOpen && !focused;
  useEffect(() => {
    if (!onBoardView) setFocusMode(false);
  }, [onBoardView]);

  const desktopApiAvailable = hasDesktopApi();
  // macOS full screen hides the traffic lights (they come with the menu bar on hover).
  const [fullScreen, setFullScreen] = useState(false);
  useEffect(() => {
    const appearance = window.chaturanga?.appearance;
    if (!appearance) return;
    return followFullScreen(appearance, setFullScreen);
  }, []);
  const windowControlsVisible = isElectronMac() && !fullScreen;
  // Narrow subscriptions: the shell must not re-render on every move (it would cascade into the
  // sidebar, titlebar and every tooltip). Handlers read the store directly via currentGame().
  const { gameId, gameMode, gameSource, gameDecided, gameBoard } = useGameStore(
    useShallow((state) => ({
      gameId: state.gameId,
      gameMode: state.mode,
      gameSource: state.source,
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
  const engines = useEnginesQuery();
  // No engine left (the last one removed in Settings): a paused analysis can't resume, so it ends
  // rather than coming back with a later engine.
  const noEngines = engines.isSuccess && !engines.data.some((engine) => engine.isAvailable);
  useEffect(() => {
    if (noEngines) useAnalysisStore.getState().endPause();
  }, [noEngines]);
  const nextPuzzle = useSamplePuzzleMutation();
  const settingsQuery = useSettingsQuery();
  const settings = useMemo(
    () => ({ ...defaultSettings, ...settingsQuery.data }),
    [settingsQuery.data]
  );
  const defaultEngineId = useMemo(() => defaultEngineFor(engines.data), [engines.data]);
  // Live analysis as Settings / the Moves tab's settings say: engine, lines and how far to search.
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

  useLichess({ onGameStart: (load) => board.startOnlineGame(load) });
  useBroadcastEventSubscription();
  // A followed broadcast game moves on only while its board is shown.
  useBroadcastFollow(appView === "game");
  useGameEndAlerts();
  useChesscom();
  // The repertoire board has its own move keys (they must not step the game behind it).
  useMoveKeyboardShortcuts({ enabled: gameBoardViews.has(appView) });
  useDatabaseDownloads();
  useEngineDriver(analysisOptions);
  useGameAutosave();
  usePlayedGameLink();
  const { mutate: updateSetting } = useUpdateSettingMutation();
  useUsageActivity();
  useMoveSounds({
    enabled: settings.soundEnabled,
    volume: settings.soundVolume,
    set: settings.soundSet,
    silentCheck: settings.soundSilentCheck
  });
  usePuzzleAutoReply();
  usePuzzleAttemptRecording();
  // Review as: a game whose side isn't known yet asks on the Summary before its review starts.
  const askReviewSide = useCallback(() => setReviewTab("summary"), []);
  // A run fills the move list as it goes: it opens on the Moves tab.
  const showReviewMoves = useCallback(() => setReviewTab("moves"), []);
  const { startReview, hasMoves: gameHasMoves } = useReviewRunner({
    engines: engines.data,
    settings,
    gameLoading: reviewRouteLoading,
    onEngineMissing: openReviewSettingsDialog,
    onSideNeeded: askReviewSide,
    onStarted: showReviewMoves
  });

  // The shell's commands for this render (each reads the state above as of now, like a handler).
  const nav = useAppNavigation({
    view: appView,
    setView: setAppView,
    navigate,
    latestNavigation,
    onReviewRoute,
    onRepertoireRoute,
    desktopApiAvailable,
    sideTab,
    setSideTab,
    setFocusMode,
    settingsSection,
    setSettingsSection,
    viewedSettingsSection,
    puzzleSession,
    entryState: {
      reviewTab,
      openingSide,
      repertoireScreen,
      savedPlayOpponent: settings.playOpponent,
      broadcastScreen
    },
    setBroadcastScreen
  });
  const board = useBoardCommands(nav, {
    engines: engines.data,
    defaultEngineId,
    setReviewTab,
    setImportOpen,
    setGameReviewPickerOpen,
    startReview
  });
  const broadcast = useBroadcastCommands(nav);
  const puzzles = usePuzzleCommands(nav, {
    engines: engines.data,
    defaultEngineId,
    sampleNextPuzzle: nextPuzzle.mutate,
    puzzleSetContinues
  });
  const repertoire = useRepertoireCommands(nav, {
    queryClient,
    screen: repertoireScreen,
    extras: repertoireExtras,
    setExtras: setRepertoireExtras,
    openGameReview: board.openSelectedGameReview,
    updateSetting,
    setOpeningSide
  });
  const { commitCurrent, record, historyEntry, stopEngineWork, clearPuzzleSession } = nav;

  /**
   * Back / Forward (navigation-coordinator.ts) through these commands; none records history (the
   * index moves once the screen is shown). `history.busy` while a restore is still loading.
   */
  const history = useHistoryRestore({
    navigation: latestNavigation,
    commitCurrent: () => commitCurrent(),
    showLiveGame: () => nav.showGame(sideTab, "none"),
    showSettings: (section) => {
      viewedSettingsSection.current = section;
      setSettingsSection(section);
      nav.showView("settings", "none");
    },
    openPlay: () => nav.openPlayPage("none"),
    openPuzzles: () => nav.openPuzzlesPage("none"),
    openDatabases: () => nav.openDatabasesPage("none"),
    openBroadcasts: () => nav.openBroadcastsPage("none"),
    openBroadcastTournament: (screen) => nav.openBroadcastTournament(screen, "none"),
    openRepertoireHub: () => repertoire.openRepertoireHub("none"),
    openRepertoireStudy: (entry) => repertoire.openRepertoireStudy(entry, "none"),
    openRepertoirePractice: (repertoireId, sessionId) =>
      repertoire.openRepertoirePractice(repertoireId, { sessionId }, "none"),
    showGame: (tab) => nav.showGame(tab, "none"),
    showGameReview: (entry) => {
      setReviewTab(entry.tab);
      setOpeningSide(
        entry.compareColor ? { board: currentGame().board, color: entry.compareColor } : null
      );
      const id = entry.board.gameId ?? "current";
      latestNavigation.current += 1;
      setAppView("game-review", () => void navigate(`/games/${id}/review`, { replace: true }));
    },
    startPuzzle: ({ sample, set }) => puzzles.startPuzzle(sample, set ?? undefined, "none"),
    getSavedGame: (id) =>
      window.chaturanga?.games.get(id) ??
      Promise.reject(new Error("Saved games need the desktop app.")),
    stopEngineWork: (options) => stopEngineWork(options),
    clearPuzzleSession: () => clearPuzzleSession(),
    releasePuzzleSession: () => puzzleSession.release(currentGame().board),
    resumePuzzleSet: (set) => puzzleSession.resumeOnBoard(set, currentGame().board),
    endBoardActivity: () => nav.endBoardActivity(),
    defaultEngineId,
    exitFocus: () => setFocusMode(false)
  });

  // A Game Review URL brings its saved game and review back: the one the window opened at (a
  // reload), and one that changes to another saved game while the app is open.
  const handledReviewRoute = useRef<string | null | undefined>(undefined);
  const restoreOpenedReviewRoute = useEventCallback(() => {
    const previous = handledReviewRoute.current;
    handledReviewRoute.current = reviewRouteId;
    if (!reviewRouteId) return;
    if (!reviewRouteToRestore(previous, reviewRouteId, currentGame().gameId)) return;
    const showPlay = () => nav.openPlayPage("replace");
    restoreReviewRoute(reviewRouteId, {
      navigation: latestNavigation,
      getSavedGame: (id) =>
        window.chaturanga?.games.get(id) ??
        Promise.reject(new Error("Saved games need the desktop app.")),
      stopEngineWork: (options) => stopEngineWork(options),
      clearPuzzleSession: () => clearPuzzleSession(),
      showPlay,
      reviewShown: () => record("replace", historyEntry("game-review"))
    }).catch((error: unknown) => {
      useAppNoticeStore
        .getState()
        .show(`That game couldn't be opened: ${ipcErrorMessage(error) || "unknown error"}`);
      showPlay();
    });
  });
  useEffect(restoreOpenedReviewRoute, [reviewRouteId, restoreOpenedReviewRoute]);
  // A game first saved while on its review (starting the analysis saves it) moves the URL from
  // "current" to its id, so a reload reopens it.
  useEffect(() => {
    const path = savedReviewPath(reviewRouteId, gameId);
    if (path) void navigate(path, { replace: true });
  }, [reviewRouteId, gameId, navigate]);

  const on = useAppCommands({
    nav,
    board,
    broadcast,
    puzzles,
    repertoire,
    history,
    focused,
    setActionRailOpen,
    setImportOpen,
    setGameReviewPickerOpen,
    setRepertoireExtras,
    startReview
  });
  useHistoryShortcuts({ onBack: on.back, onForward: on.forward });
  useBoardShortcuts({
    enabled: onBoardView,
    focused,
    onToggleFocus: on.toggleFocus,
    onExitFocus: on.exitFocus,
    onFlip: on.flipBoard
  });

  const sidebarActive = useMemo(
    () =>
      sidebarActiveFor({
        view: appView,
        gameMode,
        gameSource,
        reviewPickerOpen: gameReviewPickerOpen
      }),
    [appView, gameMode, gameSource, gameReviewPickerOpen]
  );

  const puzzlePanel = useMemo(
    () => (
      <PuzzleInfoPanel
        nextError={nextPuzzle.error}
        nextPending={nextPuzzle.isPending}
        onNextPuzzle={on.nextPuzzle}
        onPlayEngineFromHere={on.playEngineFromPuzzle}
        puzzleConfig={puzzleSession.config}
      />
    ),
    [
      nextPuzzle.error,
      nextPuzzle.isPending,
      on.nextPuzzle,
      on.playEngineFromPuzzle,
      puzzleSession.config
    ]
  );

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
          // Narrow (its labels are one short word): the width goes to the board and its panel.
          sidebarExpanded
            ? "[--sidebar-width:clamp(11rem,13vw,13.5rem)]"
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
          <ViewTitlebar
            view={appView}
            repertoire={repertoireScreen}
            broadcastScreen={broadcastScreen}
            reviewLoading={reviewRouteLoading}
            hasMoves={gameHasMoves}
            engines={engines.data}
            showAnalysisError={!engineBlockShown || sideTab !== "notation" || focused}
            puzzleSetContinues={puzzleSetContinues}
            nextPuzzlePending={nextPuzzle.isPending}
            on={on}
          />
        </AppTitlebar>

        <AppSidebar
          expanded={sidebarExpanded}
          active={sidebarActive}
          boardView={onBoardView}
          focusMode={focused}
          onPlay={on.play}
          onAnalyze={on.liveAnalysis}
          onReview={on.openReviewPicker}
          onRepertoire={on.repertoireHub}
          onPuzzles={on.puzzles}
          onDatabases={on.databases}
          onBroadcasts={on.broadcasts}
          onFocusToggle={on.toggleFocus}
          onFlip={on.flipBoard}
          onSettings={on.settings}
        />

        <main
          className={cn(
            contentPanel,
            "page-frame col-start-2 row-start-2 [view-transition-name:app-content]"
          )}
        >
          <AppNotices desktopApiAvailable={desktopApiAvailable} />
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
                canStartAnalysis={canStartAnalysis({
                  desktopApiAvailable,
                  positionIsEnd,
                  gameMode,
                  puzzleDecided,
                  gameDecided
                })}
                puzzlePanel={puzzlePanel}
                repertoire={repertoireScreen}
                broadcastScreen={broadcastScreen}
                on={on}
              />
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <AppDialogs
        onboarding={onboarding}
        importOpen={importOpen}
        reviewPickerOpen={gameReviewPickerOpen}
        on={on}
      />
    </BoardFocusContext.Provider>
  );
}

/**
 * The Moves tab's Analysis switch is the only Start: a free board, a solved puzzle, or a finished
 * engine or Lichess game (analysed in place).
 */
function canStartAnalysis({
  desktopApiAvailable,
  positionIsEnd,
  gameMode,
  puzzleDecided,
  gameDecided
}: {
  desktopApiAvailable: boolean;
  positionIsEnd: boolean;
  gameMode: GameMode;
  puzzleDecided: boolean;
  gameDecided: boolean;
}): boolean {
  return (
    desktopApiAvailable &&
    !positionIsEnd &&
    (gameMode === "freeplay" ||
      (gameMode === "puzzle" && puzzleDecided) ||
      ((gameMode === "engine" || gameMode === "online") && gameDecided))
  );
}
