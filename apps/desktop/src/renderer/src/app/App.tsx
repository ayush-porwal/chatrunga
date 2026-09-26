import { useCallback, useEffect, useMemo, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { statusForFen } from "@chaturanga/shared/chess/position";
import { createGameFromFen } from "@chaturanga/shared/chess/pgn";
import type { PuzzleSample, PuzzleSampleInput } from "@chaturanga/shared/types/database";
import { defaultSettings } from "@chaturanga/shared/types/settings";
import { Notice } from "@/components/ui/notice";
import { hasDesktopApi, isElectronMac } from "@/lib/environment";
import { appFrame, contentPanel } from "@/lib/ui";
import { signalWindowReady } from "@/lib/window-glass";
import { cn } from "@/lib/utils";
import { EngineGamePage } from "../features/analysis/EngineGamePage";
import { PromotionDialog } from "../features/board/PromotionDialog";
import { DatabasePage } from "../features/database/DatabasePage";
import { GameReviewPage } from "../features/game-review/GameReviewPage";
import { GameReviewPicker } from "../features/game-review/GameReviewPicker";
import type { ReviewTab } from "../features/game-review/review-utils";
import { PgnImportDialog } from "../features/game/PgnImportDialog";
import { PuzzlePage, type PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import { usePuzzleAutoReply } from "../features/puzzles/puzzle-session";
import { SettingsPage } from "../features/settings/SettingsPage";
import { useEnginesQuery, useSamplePuzzleMutation, useSettingsQuery } from "../queries/api";
import { useAnalysisStore } from "../stores/analysis-store";
import { useGameStore } from "../stores/game-store";
import { usePuzzleStore } from "../stores/puzzle-store";
import { useReviewStore } from "../stores/review-store";
import { AppSidebar } from "./AppSidebar";
import { AppTitlebar, GameTitlebar, PageTitle, ReviewTitlebar } from "./AppTitlebar";
import { GameWorkspace, type SideTab } from "./GameWorkspace";
import { HomePage } from "./HomePage";
import { PuzzleInfoPanel } from "./PuzzleInfoPanel";
import { useEngineDriver } from "./useEngineDriver";
import { useGameAutosave } from "./useGameAutosave";
import { useMoveKeyboardShortcuts } from "./useMoveKeyboardShortcuts";
import { useMoveSounds } from "./useMoveSounds";
import { cancelActiveReview, useReviewRunner } from "./useReviewRunner";

type AppView = "home" | "game" | "settings" | "engine-game" | "puzzles" | "databases" | "game-review";

/**
 * The app shell: sidebar, titlebar and the current view. Owns navigation between views and
 * the session resets that go with it; engine, autosave, sound and keyboard behaviour live in
 * the hooks mounted here.
 */
export function App() {
  const [appView, setAppView] = useState<AppView>("home");
  const [importOpen, setImportOpen] = useState(false);
  const [gameReviewPickerOpen, setGameReviewPickerOpen] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>("notation");
  const [reviewTab, setReviewTab] = useState<ReviewTab>("commentary");
  const [focusMode, setFocusMode] = useState(false);
  const [actionRailOpen, setActionRailOpen] = useState(true);
  const [activePuzzleConfig, setActivePuzzleConfig] = useState<PuzzleSessionConfig | null>(null);
  const [puzzleHistoryIds, setPuzzleHistoryIds] = useState<string[]>([]);

  // The Game Review workspace lives at /games/:id/review; every other view is at "/".
  const gameReviewMatch = useMatch("/games/:id/review");
  const navigate = useNavigate();
  const onReviewRoute = Boolean(gameReviewMatch);
  // The window stays hidden until the shell's first frame is painted.
  useEffect(signalWindowReady, []);
  useEffect(() => {
    setAppView((view) => (onReviewRoute ? "game-review" : view === "game-review" ? "game" : view));
  }, [onReviewRoute]);

  const desktopApiAvailable = hasDesktopApi();
  const windowControlsVisible = isElectronMac();
  const game = useGameStore();
  const engines = useEnginesQuery();
  const nextPuzzle = useSamplePuzzleMutation();
  const settingsQuery = useSettingsQuery();
  const settings = { ...defaultSettings, ...(settingsQuery.data ?? {}) };
  const activePuzzle = usePuzzleStore((s) => s.activePuzzle);
  const puzzleSolutionIndex = usePuzzleStore((s) => s.solutionIndex);
  const puzzleFeedbackKind = usePuzzleStore((s) => s.feedbackKind);
  const puzzleFeedback = usePuzzleStore((s) => s.feedback);
  const puzzleLastExpectedMove = usePuzzleStore((s) => s.lastExpectedMove);
  const status = useMemo(() => statusForFen(game.currentFen), [game.currentFen]);
  const defaultEngineId = useMemo(
    () => engines.data?.find((engine) => engine.isDefault)?.id ?? engines.data?.[0]?.id ?? null,
    [engines.data]
  );
  const reviewRouteId = gameReviewMatch?.params.id ?? null;
  const reviewRouteLoading = Boolean(reviewRouteId && reviewRouteId !== "current" && reviewRouteId !== game.gameId);
  const canAnalyzeGame =
    desktopApiAvailable &&
    !status.isEnd &&
    game.source !== "new" &&
    game.source !== "puzzle" &&
    (game.mode === "freeplay" || (game.mode === "engine" && Boolean(game.gameOutcome)));

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
    if (onReviewRoute && view !== "game-review") navigate("/");
    setAppView(view);
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
    await window.chaturanga.files.savePgnFile("chaturanga-game.pgn", game.toSession().pgn);
  }

  async function importPgnFile() {
    if (!window.chaturanga) return;
    const file = await window.chaturanga.files.openPgnFile();
    if (!file) return;
    const imported = await window.chaturanga.games.importPgn({ pgn: file.contents });
    stopEngineWork();
    useReviewStore.getState().reset();
    clearPuzzleSession();
    game.loadGame(imported.game);
    game.setMode("freeplay");
    showGame();
  }

  function startNewGame() {
    stopEngineWork();
    useReviewStore.getState().reset();
    clearPuzzleSession();
    game.reset();
    game.setOrientation("white");
    setFocusMode(false);
    showGame();
  }

  function startLiveAnalysis() {
    if (!desktopApiAvailable) return;
    // No stop: the analysis effect restarts the search for the new mode (and keeps a running one).
    stopEngineWork({ stopSearch: false });
    useReviewStore.getState().reset();
    clearPuzzleSession();
    game.setMode("analysis");
    game.setGameSource("analysis");
    game.setEngineSide(null);
    game.clearEngineMatchExtras();
    if (defaultEngineId) useAnalysisStore.getState().setActiveEngine(defaultEngineId);
    setFocusMode(false);
    showGame("engine");
  }

  /** Titlebar "Stop analysis": leave live analysis but keep the position and moves. */
  function stopLiveAnalysis() {
    game.setMode("freeplay");
    useAnalysisStore.getState().setStatus("idle");
  }

  /** "Analyze" in the titlebar / Engine tab: analyse the loaded game in place (keeps moves and review). */
  function analyzeCurrentPosition() {
    if (!desktopApiAvailable) return;
    game.setEngineSide(null);
    game.setMode("analysis");
    if (defaultEngineId && !useAnalysisStore.getState().activeEngineId) {
      useAnalysisStore.getState().setActiveEngine(defaultEngineId);
    }
  }

  function openSelectedGameReview(gameId: string) {
    stopEngineWork();
    clearPuzzleSession();
    if (gameId !== "current" && gameId !== game.gameId) useReviewStore.getState().reset();
    game.setMode("freeplay");
    game.setEngineSide(null);
    game.clearEngineMatchExtras();
    setFocusMode(false);
    setReviewTab("commentary");
    setGameReviewPickerOpen(false);
    navigate(`/games/${gameId}/review`);
    setAppView("game-review");
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
    game.setMode("puzzle");
    game.setGameSource("puzzle");
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
      game.setMatchFeedback("This puzzle position is already finished.");
      return;
    }
    const engineSide = position.turn;
    const humanSide = engineSide === "white" ? "black" : "white";
    stopEngineWork();
    useReviewStore.getState().reset();
    clearPuzzleSession();
    game.loadGame(
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
    game.setOrientation(humanSide);
    game.setMode("engine");
    game.setEngineSide(engineSide);
    game.setEngineMatchClock(null);
    game.clearEngineMatchExtras();
    game.setMatchFeedback("Playing engine from puzzle position.");
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
    game.loadGame(
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
    game.setMode("puzzle");
    game.setGameSource("puzzle");
    game.setOrientation(puzzle.sideToMove);
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

  const pageTitles: Partial<Record<AppView, string>> = {
    home: "Home",
    settings: "Settings",
    "engine-game": "Engine game",
    puzzles: "Puzzles",
    databases: "Databases"
  };

  return (
    <>
      {/* The app frame: one titlebar row over the sidebar and the inset content panel. */}
      <div
        className={cn(
          appFrame,
          "grid-cols-[var(--sidebar-width)_minmax(0,1fr)] grid-rows-[var(--titlebar-height)_minmax(0,1fr)] [--titlebar-height:54px]",
          actionRailOpen ? "[--sidebar-width:clamp(224px,18vw,272px)]" : "[--sidebar-width:52px]"
        )}
      >
        <AppTitlebar
          windowControlsInset={windowControlsVisible}
          sidebarExpanded={actionRailOpen}
          onToggleSidebar={() => setActionRailOpen((open) => !open)}
        >
          {appView === "game-review" ? (
            <ReviewTitlebar
              gameLoading={reviewRouteLoading}
              hasMoves={gameHasMoves}
              onAnalyze={() => void startReview()}
              onStop={() => void cancelActiveReview()}
            />
          ) : appView === "game" ? (
            <GameTitlebar
              engines={engines.data}
              showAnalysisError={sideTab !== "engine" || focusMode}
              canAnalyze={canAnalyzeGame}
              onAnalyze={analyzeCurrentPosition}
              onStopAnalysis={game.mode === "analysis" && desktopApiAvailable ? stopLiveAnalysis : null}
            />
          ) : (
            <PageTitle>{pageTitles[appView]}</PageTitle>
          )}
        </AppTitlebar>

        <AppSidebar
          expanded={actionRailOpen}
          active={{
            home: appView === "home",
            analyze: appView === "game" && game.mode === "analysis",
            review: appView === "game-review" || gameReviewPickerOpen,
            engineGame: appView === "engine-game",
            puzzles: appView === "puzzles",
            databases: appView === "databases",
            settings: appView === "settings"
          }}
          focusMode={focusMode}
          onHome={() => showView("home")}
          onNewGame={startNewGame}
          onAnalyze={startLiveAnalysis}
          onReview={() => setGameReviewPickerOpen(true)}
          onEngineGame={openEngineGamePage}
          onPuzzles={openPuzzlesPage}
          onDatabases={openDatabasesPage}
          onImport={() => void importPgnFile()}
          onExport={() => void exportPgn()}
          onFocusToggle={() => setFocusMode((value) => !value)}
          onSettings={() => showView("settings")}
        />

        <main className={cn(contentPanel, "col-start-2 row-start-2")}>
          {!desktopApiAvailable ? (
            <Notice tone="warn" title="Web preview mode" className="mx-8 mt-6 w-auto shrink-0">
              Engines, file dialogs, saved games, downloads and local databases need the desktop app.
            </Notice>
          ) : null}
          <div className="grid min-h-0 flex-1">
            {appView === "home" ? (
              <HomePage
                desktopApiAvailable={desktopApiAvailable}
                onAnalyze={startLiveAnalysis}
                onDatabases={openDatabasesPage}
                onEngineGame={openEngineGamePage}
                onImportPgn={() => void importPgnFile()}
                onNewGame={startNewGame}
                onPuzzles={openPuzzlesPage}
                onReview={() => setGameReviewPickerOpen(true)}
              />
            ) : appView === "settings" ? (
              <SettingsPage />
            ) : appView === "engine-game" ? (
              <EngineGamePage onOpenSettings={() => showView("settings")} onStart={() => showGame()} />
            ) : appView === "puzzles" ? (
              <PuzzlePage onDatabases={openDatabasesPage} onStart={(config, puzzle) => startPuzzle(puzzle, config)} />
            ) : appView === "databases" ? (
              <DatabasePage />
            ) : appView === "game-review" ? (
              <GameReviewPage
                activeTab={reviewTab}
                onTabChange={setReviewTab}
                settings={settings}
                settingsReady={settingsQuery.isSuccess}
                onAnalyze={reviewRouteLoading ? undefined : () => void startReview()}
                onImportPgn={() => void importPgnFile()}
                onNewGame={startNewGame}
              />
            ) : (
              <GameWorkspace
                sideTab={sideTab}
                onSideTabChange={setSideTab}
                showPanel={!focusMode}
                onStartAnalysis={
                  desktopApiAvailable && game.mode === "freeplay" && !status.isEnd ? analyzeCurrentPosition : undefined
                }
                puzzlePanel={
                  activePuzzle ? (
                    <PuzzleInfoPanel
                      feedback={puzzleFeedback}
                      feedbackKind={puzzleFeedbackKind}
                      lastExpectedMove={puzzleLastExpectedMove}
                      nextError={nextPuzzle.error}
                      nextPending={nextPuzzle.isPending}
                      onNextPuzzle={loadNextPuzzle}
                      onPlayEngineFromHere={playEngineFromCurrentPuzzlePosition}
                      puzzle={activePuzzle}
                      puzzleConfig={activePuzzleConfig}
                      solutionIndex={puzzleSolutionIndex}
                      terminal={status.isEnd}
                    />
                  ) : null
                }
              />
            )}
          </div>
        </main>
      </div>

      <PromotionDialog />
      {importOpen ? <PgnImportDialog onClose={() => setImportOpen(false)} /> : null}
      {gameReviewPickerOpen ? (
        <GameReviewPicker
          onClose={() => setGameReviewPickerOpen(false)}
          onSelect={openSelectedGameReview}
          onImport={() => setImportOpen(true)}
        />
      ) : null}
    </>
  );
}

function puzzleInputFromConfig(config: PuzzleSessionConfig, databaseId: string, excludeIds: string[]): PuzzleSampleInput {
  return { databaseId, excludeIds, lichess: config.lichess, position: config.position };
}
