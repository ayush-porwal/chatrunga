import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { statusForFen } from "@chaturanga/shared/chess/position";
import { createGameFromFen } from "@chaturanga/shared/chess/pgn";
import type { PuzzleSample, PuzzleSampleInput } from "@chaturanga/shared/types/database";
import { defaultSettings } from "@chaturanga/shared/types/settings";
import { Notice } from "@/components/ui/notice";
import { hasDesktopApi, isElectronMac } from "@/lib/environment";
import { positionStatus } from "@/lib/position-status";
import { appFrame, contentPanel } from "@/lib/ui";
import { useViewTransitionState, type ViewTransitionKind } from "@/lib/use-view-transition";
import { useEventCallback } from "@/lib/use-event-callback";
import { signalWindowReady } from "@/lib/window-glass";
import { cn } from "@/lib/utils";
import { EngineGamePage } from "../features/analysis/EngineGamePage";
import { BoardFocusContext } from "../features/board/board-focus";
import { PromotionDialog } from "../features/board/PromotionDialog";
import { DatabasePage } from "../features/database/DatabasePage";
import { GameReviewPage } from "../features/game-review/GameReviewPage";
import { GameReviewPicker } from "../features/game-review/GameReviewPicker";
import type { ReviewTab } from "../features/game-review/review-utils";
import { PgnImportDialog } from "../features/game/PgnImportDialog";
import { openSavedGame } from "../features/game/saved-game";
import { PuzzlePage, type PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import { usePuzzleAutoReply } from "../features/puzzles/puzzle-session";
import { SettingsPage, type SettingsSectionId } from "../features/settings/SettingsPage";
import { OnboardingFlow } from "../features/onboarding/OnboardingFlow";
import { useOnboarding } from "../features/onboarding/useOnboarding";
import { useEnginesQuery, useSamplePuzzleMutation, useSettingsQuery } from "../queries/api";
import { useAnalysisStore } from "../stores/analysis-store";
import { useGameStore } from "../stores/game-store";
import { usePuzzleStore } from "../stores/puzzle-store";
import { useReviewStore } from "../stores/review-store";
import { selectLiveGameInProgress, useLichessStore } from "../stores/lichess-store";
import { AppSidebar } from "./AppSidebar";
import { AppTitlebar, GameTitlebar, LiveGameButton, PageTitle, ReviewTitlebar } from "./AppTitlebar";
import { GameWorkspace, type SideTab } from "./GameWorkspace";
import { HomePage } from "./HomePage";
import { PuzzleInfoPanel } from "./PuzzleInfoPanel";
import { useBoardShortcuts } from "./useBoardShortcuts";
import { useEngineDriver } from "./useEngineDriver";
import { useGameAutosave } from "./useGameAutosave";
import { useLichess } from "./useLichess";
import { useMoveKeyboardShortcuts } from "./useMoveKeyboardShortcuts";
import { useMoveSounds } from "./useMoveSounds";
import { cancelActiveReview, useReviewRunner } from "./useReviewRunner";

type AppView = "home" | "game" | "settings" | "engine-game" | "puzzles" | "databases" | "game-review";

const boardViews: ReadonlySet<AppView> = new Set(["game", "game-review"]);
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
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  /**
   * Bumped by every game open and every view change. A saved game that finishes loading after
   * a newer selection (or after the user went elsewhere) is dropped instead of taking over.
   */
  const latestNavigation = useRef(0);
  const [actionRailOpen, setActionRailOpen] = useState(true);
  const [activePuzzleConfig, setActivePuzzleConfig] = useState<PuzzleSessionConfig | null>(null);
  const onboarding = useOnboarding();
  const [puzzleHistoryIds, setPuzzleHistoryIds] = useState<string[]>([]);

  // The Game Review workspace lives at /games/:id/review; every other view is at "/".
  const gameReviewMatch = useMatch("/games/:id/review");
  const navigate = useNavigate();
  const onReviewRoute = Boolean(gameReviewMatch);
  // The window stays hidden until the shell's first frame is painted.
  useEffect(signalWindowReady, []);
  useEffect(() => {
    setAppView((view) => (onReviewRoute ? "game-review" : view === "game-review" ? "game" : view));
  }, [onReviewRoute, setAppView]);

  // Focus mode only exists on a board view; leaving one ends it (the stored flag resets below).
  const onBoardView = boardViews.has(appView);
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
  const { gameId, gameSource, gameMode, gameDecided } = useGameStore(
    useShallow((state) => ({
      gameId: state.gameId,
      gameSource: state.source,
      gameMode: state.mode,
      gameDecided: Boolean(state.gameOutcome)
    }))
  );
  const positionIsEnd = useGameStore((state) => positionStatus(state.currentFen).isEnd);
  // A Lichess game on the board: nothing may replace it and the engine stays off until it ends.
  const onlineGameLive = useLichessStore(selectLiveGameInProgress);
  const engines = useEnginesQuery();
  const nextPuzzle = useSamplePuzzleMutation();
  const settingsQuery = useSettingsQuery();
  const settings = useMemo(() => ({ ...defaultSettings, ...(settingsQuery.data ?? {}) }), [settingsQuery.data]);
  const defaultEngineId = useMemo(
    () => engines.data?.find((engine) => engine.isDefault)?.id ?? engines.data?.[0]?.id ?? null,
    [engines.data]
  );
  const reviewRouteId = gameReviewMatch?.params.id ?? null;
  const reviewRouteLoading = Boolean(reviewRouteId && reviewRouteId !== "current" && reviewRouteId !== gameId);
  const canAnalyzeGame =
    desktopApiAvailable &&
    !positionIsEnd &&
    gameSource !== "new" &&
    gameSource !== "puzzle" &&
    (gameMode === "freeplay" || ((gameMode === "engine" || gameMode === "online") && gameDecided));

  useLichess({ onGameStart: () => startOnlineGame() });
  useMoveKeyboardShortcuts();
  useEngineDriver(defaultEngineId);
  useGameAutosave();
  useMoveSounds({ enabled: settings.soundEnabled, volume: settings.soundVolume });
  usePuzzleAutoReply();
  const openReviewSettings = useCallback(() => setReviewTab("settings"), []);
  const { startReview, hasMoves: gameHasMoves } = useReviewRunner({
    engines: engines.data,
    settings,
    gameLoading: reviewRouteLoading,
    onEngineMissing: openReviewSettings
  });

  /** Switches the view, leaving the review route when going anywhere else. */
  function showView(view: AppView) {
    latestNavigation.current += 1;
    // The route change belongs to the same view transition, so the old snapshot is the real old view.
    setAppView(view, onReviewRoute && view !== "game-review" ? () => navigate("/") : undefined);
  }

  function clearPuzzleSession() {
    usePuzzleStore.getState().reset();
    setActivePuzzleConfig(null);
    setPuzzleHistoryIds([]);
  }

  /** Ends what the engine is doing (search, review) before switching to another activity. */
  function stopEngineWork({ stopSearch = true }: { stopSearch?: boolean } = {}) {
    if (stopSearch) void window.chaturanga?.engines.stop();
    void cancelActiveReview();
    useAnalysisStore.getState().reset();
  }

  function showGame(tab: SideTab = "notation") {
    setSideTab(tab);
    showView("game");
  }

  async function exportPgn() {
    if (!window.chaturanga) return;
    await window.chaturanga.files.savePgnFile("chaturanga-currentGame().pgn", currentGame().toSession().pgn);
  }

  async function importPgnFile() {
    if (!window.chaturanga) return;
    const file = await window.chaturanga.files.openPgnFile();
    if (!file) return;
    const imported = await window.chaturanga.games.importPgn({ pgn: file.contents });
    stopEngineWork();
    useReviewStore.getState().reset();
    clearPuzzleSession();
    currentGame().loadGame(imported.game);
    currentGame().setMode("freeplay");
    showGame();
  }

  /** A Lichess game of yours began: clear the board's other activity and show it (useLichess loads it). */
  function startOnlineGame() {
    stopEngineWork();
    useReviewStore.getState().reset();
    clearPuzzleSession();
    setFocusMode(false);
    showGame();
  }

  /**
   * While a Lichess game is on, actions that would replace the board bring you back to it instead
   * (the game keeps running on Lichess either way).
   */
  function unlessOnlineGame(action: () => void) {
    if (!useLichessStore.getState().live || useLichessStore.getState().live?.over) return action();
    showGame();
    currentGame().setMatchFeedback("Finish your Lichess game first.");
  }

  function startNewGame() {
    stopEngineWork();
    useReviewStore.getState().reset();
    clearPuzzleSession();
    currentGame().reset();
    currentGame().setOrientation("white");
    setFocusMode(false);
    showGame();
  }

  function startLiveAnalysis() {
    if (!desktopApiAvailable) return;
    // No stop: the analysis effect restarts the search for the new mode (and keeps a running one).
    stopEngineWork({ stopSearch: false });
    useReviewStore.getState().reset();
    clearPuzzleSession();
    currentGame().setMode("analysis");
    currentGame().setGameSource("analysis");
    currentGame().setEngineSide(null);
    currentGame().clearEngineMatchExtras();
    if (defaultEngineId) useAnalysisStore.getState().setActiveEngine(defaultEngineId);
    setFocusMode(false);
    showGame("engine");
  }

  /** Titlebar "Stop analysis": leave live analysis but keep the position and moves. */
  function stopLiveAnalysis() {
    currentGame().setMode("freeplay");
    useAnalysisStore.getState().setStatus("idle");
  }

  /** "Analyze" in the titlebar / Engine tab: analyse the loaded game in place (keeps moves and review). */
  function analyzeCurrentPosition() {
    if (!desktopApiAvailable) return;
    currentGame().setEngineSide(null);
    currentGame().setMode("analysis");
    if (defaultEngineId && !useAnalysisStore.getState().activeEngineId) {
      useAnalysisStore.getState().setActiveEngine(defaultEngineId);
    }
  }

  async function openSelectedGameReview(gameId: string) {
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
      clearPuzzleSession();
    }
    currentGame().setMode("freeplay");
    currentGame().setEngineSide(null);
    currentGame().clearEngineMatchExtras();
    setFocusMode(false);
    setReviewTab("commentary");
    setGameReviewPickerOpen(false);
    setAppView("game-review", () => navigate(`/games/${gameId}/review`));
  }

  /** Home → Resume / a recent game: the board with that saved game (the loaded game is kept as is). */
  async function openSavedGameById(gameId: string) {
    const request = ++latestNavigation.current;
    if (gameId !== currentGame().gameId) {
      if (!window.chaturanga) return;
      const saved = await window.chaturanga.games.get(gameId);
      if (request !== latestNavigation.current) return;
      stopEngineWork();
      clearPuzzleSession();
      openSavedGame(saved);
      currentGame().setMode("freeplay");
      currentGame().setEngineSide(null);
      currentGame().clearEngineMatchExtras();
    }
    setFocusMode(false);
    showGame();
  }

  function openEngineGamePage() {
    if (!desktopApiAvailable) return;
    stopEngineWork();
    clearPuzzleSession();
    setFocusMode(false);
    showView("engine-game");
  }

  function openPuzzlesPage() {
    if (!desktopApiAvailable) return;
    stopEngineWork();
    currentGame().setMode("puzzle");
    currentGame().setGameSource("puzzle");
    setFocusMode(false);
    showView("puzzles");
  }

  function openDatabasesPage() {
    if (!desktopApiAvailable) return;
    stopEngineWork();
    setFocusMode(false);
    showView("databases");
  }

  function playEngineFromCurrentPuzzlePosition() {
    if (!desktopApiAvailable) return;
    const engine = engines.data?.find((item) => item.id === defaultEngineId) ?? engines.data?.[0];
    if (!engine) {
      void cancelActiveReview();
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
    stopEngineWork();
    useReviewStore.getState().reset();
    clearPuzzleSession();
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

  /** Loads a puzzle onto the board. `config` starts a new puzzle set; without it the set continues. */
  function startPuzzle(puzzle: PuzzleSample, config?: PuzzleSessionConfig) {
    stopEngineWork();
    useReviewStore.getState().reset();
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    if (config) {
      setActivePuzzleConfig(config);
      setPuzzleHistoryIds([puzzle.id]);
    }
    currentGame().loadGame(
      createGameFromFen({
        fen: puzzle.initialFen,
        source: "puzzle",
        headers: {
          event: puzzle.sourceName,
          site: puzzle.gameUrl ?? "?",
          white: "White",
          black: "Black",
          result: "*",
          orientationHint: puzzle.sideToMove
        }
      })
    );
    currentGame().setMode("puzzle");
    currentGame().setGameSource("puzzle");
    currentGame().setOrientation(puzzle.sideToMove);
    showGame();
  }

  function loadNextPuzzle() {
    void cancelActiveReview();
    if (!activePuzzleConfig?.databaseId) {
      showView("puzzles");
      return;
    }
    nextPuzzle.mutate(puzzleInputFromConfig(activePuzzleConfig, activePuzzleConfig.databaseId, puzzleHistoryIds), {
      onSuccess: (puzzle) => {
        setPuzzleHistoryIds((ids) => [...ids, puzzle.id]);
        startPuzzle(puzzle);
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
    home: useEventCallback(() => showView("home")),
    settings: useEventCallback(() => {
      setSettingsSection(null);
      showView("settings");
    }),
    commentarySettings: useEventCallback(() => {
      setSettingsSection("commentary");
      showView("settings");
    }),
    engineSettings: useEventCallback(() => {
      setSettingsSection("engines");
      showView("settings");
    }),
    newGame: useEventCallback(() => unlessOnlineGame(startNewGame)),
    liveAnalysis: useEventCallback(() => unlessOnlineGame(startLiveAnalysis)),
    stopLiveAnalysis: useEventCallback(stopLiveAnalysis),
    analyzePosition: useEventCallback(analyzeCurrentPosition),
    openReviewPicker: useEventCallback(() => unlessOnlineGame(() => setGameReviewPickerOpen(true))),
    closeReviewPicker: useEventCallback(() => setGameReviewPickerOpen(false)),
    openImportDialog: useEventCallback(() => setImportOpen(true)),
    closeImportDialog: useEventCallback(() => setImportOpen(false)),
    reviewGame: useEventCallback((id: string) => unlessOnlineGame(() => void openSelectedGameReview(id))),
    engineGame: useEventCallback(openEngineGamePage),
    // After a Lichess game: Play, on its Lichess tab.
    playLichess: useEventCallback(() => {
      useLichessStore.getState().setPlayOpponent("lichess");
      openEngineGamePage();
    }),
    puzzles: useEventCallback(() => unlessOnlineGame(openPuzzlesPage)),
    databases: useEventCallback(openDatabasesPage),
    importPgn: useEventCallback(() => unlessOnlineGame(() => void importPgnFile())),
    exportPgn: useEventCallback(() => void exportPgn()),
    toggleFocus: useEventCallback(() => setFocusMode((value) => !value)),
    exitFocus: useEventCallback(() => setFocusMode(false)),
    flipBoard: useEventCallback(() => currentGame().flip()),
    openGame: useEventCallback((id: string) => unlessOnlineGame(() => void openSavedGameById(id))),
    startReview: useEventCallback(() => void startReview()),
    stopReview: useEventCallback(() => void cancelActiveReview()),
    showGame: useEventCallback(() => showGame()),
    startPuzzle: useEventCallback((config: PuzzleSessionConfig, puzzle: PuzzleSample) => startPuzzle(puzzle, config)),
    nextPuzzle: useEventCallback(loadNextPuzzle),
    playEngineFromPuzzle: useEventCallback(playEngineFromCurrentPuzzlePosition),
    reviewCurrentGame: useEventCallback(() => void openSelectedGameReview("current"))
  };
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
      engineGame: appView === "engine-game",
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
        puzzleConfig={activePuzzleConfig}
      />
    ),
    [nextPuzzle.error, nextPuzzle.isPending, on.nextPuzzle, on.playEngineFromPuzzle, activePuzzleConfig]
  );

  const pageTitles: Partial<Record<AppView, string>> = {
    home: "Home",
    settings: "Settings",
    "engine-game": "Play",
    puzzles: "Puzzles",
    databases: "Databases"
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
          sidebarExpanded ? "[--sidebar-width:clamp(12.5rem,17vw,17rem)]" : "[--sidebar-width:3.25rem]"
        )}
      >
        <AppTitlebar
          windowControlsInset={windowControlsVisible}
          sidebarExpanded={sidebarExpanded}
          onToggleSidebar={on.toggleSidebar}
        >
          {appView === "game-review" ? (
            <ReviewTitlebar
              gameLoading={reviewRouteLoading}
              hasMoves={gameHasMoves}
              onAnalyze={on.startReview}
              onStop={on.stopReview}
            />
          ) : appView === "game" ? (
            <GameTitlebar
              engines={engines.data}
              showAnalysisError={sideTab !== "engine" || focused}
              canAnalyze={canAnalyzeGame}
              onAnalyze={on.analyzePosition}
              onStopAnalysis={gameMode === "analysis" && desktopApiAvailable ? on.stopLiveAnalysis : null}
              onReviewGame={on.reviewCurrentGame}
              onPlayAgain={on.playLichess}
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
          onNewGame={on.newGame}
          onAnalyze={on.liveAnalysis}
          onReview={on.openReviewPicker}
          onEngineGame={on.engineGame}
          onPuzzles={on.puzzles}
          onDatabases={on.databases}
          onImport={on.importPgn}
          onExport={on.exportPgn}
          onFocusToggle={on.toggleFocus}
          onFlip={on.flipBoard}
          onSettings={on.settings}
        />

        <main className={cn(contentPanel, "col-start-2 row-start-2 [view-transition-name:app-content]")}>
          {!desktopApiAvailable ? (
            <Notice tone="warn" title="Web preview mode" className="mx-(--page-gutter) mt-(--page-gutter-y) w-auto shrink-0">
              Engines, file dialogs, saved games, downloads and local databases need the desktop app.
            </Notice>
          ) : null}
          <div className="grid min-h-0 flex-1">
            {appView === "home" ? (
              <HomePage
                desktopApiAvailable={desktopApiAvailable}
                onAnalyze={on.liveAnalysis}
                onEngineGame={on.engineGame}
                onImportPgn={on.importPgn}
                onNewGame={on.newGame}
                onOpenGame={on.openGame}
                onPuzzles={on.puzzles}
                onReview={on.openReviewPicker}
                onReviewGame={on.reviewGame}
                onOpenEngineSettings={on.engineSettings}
              />
            ) : appView === "settings" ? (
              <SettingsPage initialSection={settingsSection} />
            ) : appView === "engine-game" ? (
              <EngineGamePage onOpenSettings={on.settings} onStart={on.showGame} onOpenLichessGame={on.showGame} />
            ) : appView === "puzzles" ? (
              <PuzzlePage onDatabases={on.databases} onStart={on.startPuzzle} />
            ) : appView === "databases" ? (
              <DatabasePage />
            ) : appView === "game-review" ? (
              <GameReviewPage
                activeTab={reviewTab}
                onTabChange={setReviewTab}
                settings={settings}
                settingsReady={settingsQuery.isSuccess}
                onAnalyze={reviewRouteLoading ? undefined : on.startReview}
                onImportPgn={on.importPgn}
                onNewGame={on.newGame}
                onOpenCommentarySettings={on.commentarySettings}
              />
            ) : (
              <GameWorkspace
                sideTab={sideTab}
                onSideTabChange={setSideTab}
                onStartAnalysis={
                  desktopApiAvailable && gameMode === "freeplay" && !positionIsEnd ? on.analyzePosition : undefined
                }
                puzzlePanel={puzzlePanel}
                onOpenSettings={on.settings}
              />
            )}
          </div>
        </main>
      </div>

      <PromotionDialog />
      {onboarding.open ? (
        <OnboardingFlow
          onFinish={onboarding.finish}
          onGoHome={on.home}
        />
      ) : null}
      {importOpen ? <PgnImportDialog onClose={on.closeImportDialog} /> : null}
      {gameReviewPickerOpen ? (
        <GameReviewPicker
          onClose={on.closeReviewPicker}
          onSelect={on.reviewGame}
          onImport={on.openImportDialog}
        />
      ) : null}
    </BoardFocusContext.Provider>
  );
}

const currentGame = () => useGameStore.getState();

function puzzleInputFromConfig(config: PuzzleSessionConfig, databaseId: string, excludeIds: string[]): PuzzleSampleInput {
  return { databaseId, excludeIds, lichess: config.lichess, position: config.position };
}
