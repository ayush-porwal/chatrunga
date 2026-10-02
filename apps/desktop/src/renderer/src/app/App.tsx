import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { statusForFen } from "@chaturanga/shared/chess/position";
import { createGameFromFen } from "@chaturanga/shared/chess/pgn";
import type { PuzzleSample, PuzzleSampleInput } from "@chaturanga/shared/types/database";
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
import { BoardFocusContext } from "../features/board/board-focus";
import { PromotionDialog } from "../features/board/PromotionDialog";
import type { ReviewTab } from "../features/game-review/review-utils";
import { PgnImportDialog } from "../features/game/PgnImportDialog";
import { openSavedGame, savedReview } from "../features/game/saved-game";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import { usePuzzleAutoReply } from "../features/puzzles/puzzle-session";
import type { SettingsSectionId } from "../features/settings/SettingsPage";
import { useOnboarding } from "../features/onboarding/useOnboarding";
import { useEnginesQuery, useSamplePuzzleMutation, useSettingsQuery } from "../queries/api";
import { useAnalysisStore } from "../stores/analysis-store";
import { analysisEngineFor, defaultEngineFor } from "../features/analysis/analysis-engine";
import { useGameStore } from "../stores/game-store";
import { usePuzzleStore } from "../stores/puzzle-store";
import { useReviewStore } from "../stores/review-store";
import { selectLiveGameInProgress, useLichessStore } from "../stores/lichess-store";
import { useHistoryStore, type BoardSnapshot, type HistoryEntry } from "../stores/history-store";
import { AppSidebar } from "./AppSidebar";
import { AppTitlebar, GameTitlebar, LiveGameButton, PageTitle, ReviewTitlebar } from "./AppTitlebar";
import type { SideTab } from "./GameWorkspace";
import { AppPages, GameReviewPicker, OnboardingFlow, type AppView } from "./AppPages";
import { PuzzleInfoPanel } from "./PuzzleInfoPanel";
import { useBoardShortcuts } from "./useBoardShortcuts";
import { useEngineDriver } from "./useEngineDriver";
import { flushGameAutosave, useGameAutosave } from "./useGameAutosave";
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
import { usePuzzleDraftStore } from "../stores/puzzle-draft-store";

type HistoryMode = "push" | "replace" | "none";


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
  /** The Settings section being read (scroll-spy), which history records; the state above is only where Settings opens. */
  const viewedSettingsSection = useRef<SettingsSectionId | null>(null);
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
  const appNotice = useAppNoticeStore((state) => state.message);
  const dismissAppNotice = useAppNoticeStore((state) => state.dismiss);
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
  const defaultEngineId = useMemo(() => defaultEngineFor(engines.data), [engines.data]);
  const chosenAnalysisEngine = useAnalysisStore((state) => state.analysisEngineId);
  const analysisEngineId = useMemo(
    () => analysisEngineFor(engines.data, chosenAnalysisEngine),
    [engines.data, chosenAnalysisEngine]
  );
  const reviewRouteId = gameReviewMatch?.params.id ?? null;
  const reviewRouteLoading = Boolean(reviewRouteId && reviewRouteId !== "current" && reviewRouteId !== gameId);
  const canAnalyzeGame =
    desktopApiAvailable &&
    !positionIsEnd &&
    gameSource !== "new" &&
    gameSource !== "puzzle" &&
    (gameMode === "freeplay" || ((gameMode === "engine" || gameMode === "online") && gameDecided));

  useLichess({ onGameStart: (load) => startOnlineGame(load) });
  useMoveKeyboardShortcuts({ enabled: onBoardView });
  useDatabaseDownloads();
  useEngineDriver(analysisEngineId);
  useGameAutosave();
  useUsageActivity();
  useMoveSounds({ enabled: settings.soundEnabled, volume: settings.soundVolume });
  usePuzzleAutoReply();
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
    setAppView(view, onReviewRoute && view !== "game-review" ? () => navigate("/", { replace: true }) : undefined);
    record(history, historyEntry(view, tab));
  }

  // ---- Back / Forward -------------------------------------------------------------------------

  /** The board as it is now, for a history entry. */
  function boardSnapshot(tab: SideTab): BoardSnapshot {
    const game = currentGame();
    const puzzle = game.mode === "puzzle" ? usePuzzleStore.getState().activePuzzle : null;
    return {
      gameId: game.gameId,
      // Nothing to reload an unsaved game from: keep it whole.
      session: game.gameId ? null : game.toSession(),
      currentNodeId: game.currentNodeId,
      mode: game.mode,
      source: game.source,
      engineSide: game.engineSide,
      orientation: game.orientation,
      gameOutcome: game.gameOutcome,
      tab,
      puzzle: puzzle ? { sample: puzzle, config: activePuzzleConfig } : null,
      lichessGameId: game.mode === "online" ? (useLichessStore.getState().live?.id ?? null) : null
    };
  }

  function historyEntry(view: AppView, tab: SideTab = sideTab): HistoryEntry {
    switch (view) {
      case "settings":
        return { view, section: viewedSettingsSection.current ?? settingsSection };
      case "play": {
        // The tab actually shown (an unchosen tab follows the account, which may change later).
        const lichess = useLichessStore.getState();
        const connected = Boolean(lichess.status.account) && !lichess.status.tokenRejected;
        return { view, opponent: lichess.playOpponent ?? (connected ? "lichess" : "engine") };
      }
      case "game":
        return { view, board: boardSnapshot(tab) };
      case "game-review":
        return { view, board: boardSnapshot("notation"), tab: reviewTab };
      default:
        return { view };
    }
  }

  function record(mode: HistoryMode, entry: HistoryEntry) {
    if (mode === "push") useHistoryStore.getState().push(entry);
    else if (mode === "replace") useHistoryStore.getState().replaceCurrent(entry);
  }

  /** Saves the screen being left as it is now (so Back returns to it as it was left). */
  function commitCurrent() {
    useHistoryStore.getState().commitCurrent(historyEntry(appView));
  }

  /** A Back / Forward still loading its screen: further presses wait for it (the index moves once it's shown). */
  const historyBusy = useRef(false);

  /** Back (-1) / Forward (+1). A Lichess game being played keeps the board. */
  async function goHistory(delta: -1 | 1) {
    if (historyBusy.current) return;
    const history = useHistoryStore.getState();
    const targetIndex = history.index + delta;
    const target = history.entries[targetIndex];
    if (!target) return;
    const live = useLichessStore.getState().live;
    if (live && !live.over && replacesLiveBoard(target, live.id)) {
      showGame(sideTab, "none");
      currentGame().setMatchFeedback("Finish your Lichess game first.");
      return;
    }
    commitCurrent();
    historyBusy.current = true;
    try {
      const outcome = await restoreEntry(target);
      // Only once the screen is shown: the index always names what's on screen.
      if (outcome === "shown") useHistoryStore.getState().moveTo(targetIndex);
      // A game deleted since: forget its entry (the next press goes past it).
      else if (outcome === "gone") useHistoryStore.getState().removeAt(targetIndex);
    } finally {
      historyBusy.current = false;
    }
  }

  /** Shows a history entry: "shown", "gone" (its game was deleted) or "dropped" (a newer navigation won). */
  async function restoreEntry(entry: HistoryEntry): Promise<"shown" | "gone" | "dropped"> {
    switch (entry.view) {
      case "home":
        showView("home", "none");
        return "shown";
      case "settings":
        viewedSettingsSection.current = entry.section as SettingsSectionId | null;
        setSettingsSection(entry.section as SettingsSectionId | null);
        showView("settings", "none");
        return "shown";
      case "play":
        if (entry.opponent) useLichessStore.getState().setPlayOpponent(entry.opponent);
        openPlayPage("none");
        return "shown";
      case "puzzles":
        openPuzzlesPage("none");
        return "shown";
      case "databases":
        openDatabasesPage("none");
        return "shown";
      case "game": {
        const outcome = await restoreBoard(entry.board);
        if (outcome === "restored") showGame(entry.board.tab, "none");
        return outcome === "restored" || outcome === "shown" ? "shown" : outcome;
      }
      case "game-review": {
        const outcome = await restoreBoard(entry.board);
        if (outcome !== "restored") return outcome === "shown" ? "shown" : outcome;
        const request = latestNavigation.current;
        // The review may not be loaded (the board was replaced while away): bring the saved one back.
        if (entry.board.gameId && !useReviewStore.getState().review) {
          const saved = await window.chaturanga?.games.get(entry.board.gameId).catch(() => null);
          if (request !== latestNavigation.current) return "dropped";
          if (saved?.review) useReviewStore.getState().loadReview(savedReview(saved), saved.reviews ?? []);
        }
        currentGame().setMode("freeplay");
        setReviewTab(entry.tab as ReviewTab);
        const id = entry.board.gameId ?? "current";
        latestNavigation.current += 1;
        setAppView("game-review", () => navigate(`/games/${id}/review`, { replace: true }));
        return "shown";
      }
    }
  }

  /**
   * Puts a history entry's board back: "restored" (the caller shows it), "shown" (already on
   * screen: the live Lichess game, or a restarted puzzle), "gone" (the game was deleted) or
   * "dropped" (a newer navigation won).
   */
  async function restoreBoard(snapshot: BoardSnapshot): Promise<"restored" | "shown" | "gone" | "dropped"> {
    const request = ++latestNavigation.current;
    // A Lichess game still being played can only be the one on the board now (goHistory checked that).
    const live = useLichessStore.getState().live;
    if (snapshot.lichessGameId && live && !live.over && snapshot.lichessGameId === live.id) {
      showGame(snapshot.tab, "none");
      return "shown";
    }
    // A puzzle starts again (never restored mid-solution).
    if (snapshot.puzzle) {
      startPuzzle(snapshot.puzzle.sample, snapshot.puzzle.config as PuzzleSessionConfig, "none");
      return "shown";
    }
    if (snapshot.gameId && snapshot.gameId !== currentGame().gameId) {
      const saved = await window.chaturanga?.games.get(snapshot.gameId).catch(() => null);
      if (request !== latestNavigation.current) return "dropped";
      if (!saved) {
        currentGame().setMatchFeedback("That game was deleted.");
        return "gone";
      }
      stopEngineWork();
      clearPuzzleSession();
      openSavedGame(saved);
    } else if (!snapshot.gameId && snapshot.session) {
      endBoardActivity();
      currentGame().loadGame(snapshot.session);
    } else {
      stopEngineWork({ stopSearch: snapshot.mode !== "analysis" });
      clearPuzzleSession();
    }
    currentGame().restoreView(snapshot);
    if (snapshot.mode === "analysis") {
      if (defaultEngineId && !useAnalysisStore.getState().activeEngineId) useAnalysisStore.getState().setActiveEngine(defaultEngineId);
      // The search was stopped while away; the position may be the same, so ask for it again.
      useAnalysisStore.getState().restartSearch();
    }
    setFocusMode(false);
    return "restored";
  }

  function clearPuzzleSession() {
    usePuzzleStore.getState().reset();
    setActivePuzzleConfig(null);
    setPuzzleHistoryIds([]);
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

  /** Ends what the engine is doing (search, review) before switching to another activity. */
  function stopEngineWork({ stopSearch = true }: { stopSearch?: boolean } = {}) {
    if (stopSearch) void window.chaturanga?.engines.stop();
    void cancelActiveReview();
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
      await window.chaturanga.files.savePgnFile("chaturanga-game.pgn", currentGame().toSession().pgn);
    } catch (error) {
      useAppNoticeStore.getState().show(`Couldn't export the PGN: ${ipcErrorMessage(error) || "unknown error"}`);
    }
  }

  async function importPgnFile() {
    if (!window.chaturanga) return;
    const request = ++latestNavigation.current;
    try {
      const file = await window.chaturanga.files.openPgnFile();
      if (!file || request !== latestNavigation.current) return;
      // Pending edits first: the library's check for a copy must see the board as it is.
      await flushGameAutosave();
      const imported = await window.chaturanga.games.importPgn({ pgn: file.contents });
      // A Lichess game (or another navigation) started meanwhile: it keeps the board.
      if (request !== latestNavigation.current) return;
      loadImportedGame(imported);
    } catch (error) {
      // Shown where you are (no navigation: the board didn't change).
      if (request === latestNavigation.current) {
        useAppNoticeStore.getState().show(`Couldn't import that file: ${ipcErrorMessage(error) || "unknown error"}`);
      }
    }
  }

  /** An imported PGN (file or the paste dialog) onto the board; a warning (only the first of several games) shows on it. */
  function loadImportedGame(imported: ImportedGame) {
    // Already in the library: open that copy (with its analyses) rather than a duplicate.
    if (imported.existingGameId) {
      const existing = imported.existingGameId;
      void openSavedGameById(existing).then(() => {
        if (currentGame().gameId === existing) currentGame().setMatchFeedback("Already in your library: opened your copy.");
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
    currentGame().setMatchFeedback("Finish your Lichess game first.");
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
   */
  function analyzeCurrentPosition() {
    if (!desktopApiAvailable) return;
    commitCurrent();
    // A board still loading (Back / Forward, a saved game) must not replace this one afterwards.
    latestNavigation.current += 1;
    currentGame().setEngineSide(null);
    currentGame().clearEngineMatchExtras();
    currentGame().setMode("analysis");
    if (defaultEngineId && !useAnalysisStore.getState().activeEngineId) {
      useAnalysisStore.getState().setActiveEngine(defaultEngineId);
    }
    useAnalysisStore.getState().restartSearch();
    record("push", historyEntry("game"));
  }

  async function openSelectedGameReview(gameId: string) {
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
      clearPuzzleSession();
    }
    currentGame().setMode("freeplay");
    currentGame().setEngineSide(null);
    currentGame().clearEngineMatchExtras();
    setFocusMode(false);
    setReviewTab("commentary");
    setGameReviewPickerOpen(false);
    setAppView("game-review", () => navigate(`/games/${gameId}/review`, { replace: true }));
    record("push", historyEntry("game-review"));
  }

  /** Home → Resume / a recent game: the board with that saved game (the loaded game is kept as is). */
  async function openSavedGameById(gameId: string) {
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
    setAppView("settings", onReviewRoute ? () => navigate("/", { replace: true }) : undefined);
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
    endBoardActivity();
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

  /**
   * Loads a puzzle onto the board. `config` starts a new puzzle set (a history step); without it the
   * set continues (the next puzzle takes the current entry's place).
   */
  function startPuzzle(puzzle: PuzzleSample, config?: PuzzleSessionConfig, history: HistoryMode = config ? "push" : "replace") {
    if (history === "push") commitCurrent();
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
    showGame("notation", history);
  }

  function loadNextPuzzle() {
    void cancelActiveReview();
    if (!activePuzzleConfig?.databaseId) {
      commitCurrent();
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
    home: useEventCallback(() => {
      commitCurrent();
      showView("home");
    }),
    settings: useEventCallback(() => openSettings(null)),
    commentarySettings: useEventCallback(() => openSettings("commentary")),
    engineSettings: useEventCallback(() => openSettings("engines")),
    back: useEventCallback(() => void goHistory(-1)),
    forward: useEventCallback(() => void goHistory(1)),
    settingsSectionViewed: useEventCallback((section: SettingsSectionId) => {
      viewedSettingsSection.current = section;
    }),
    importedGame: useEventCallback((imported: ImportedGame) => unlessOnlineGame(() => loadImportedGame(imported))),
    beforePlayStart: useEventCallback(beforeEngineGame),
    play: useEventCallback(() => openPlayPage()),
    freeBoard: useEventCallback(() => unlessOnlineGame(startFreeBoard)),
    liveAnalysis: useEventCallback(() => unlessOnlineGame(startLiveAnalysis)),
    stopLiveAnalysis: useEventCallback(stopLiveAnalysis),
    analyzePosition: useEventCallback(analyzeCurrentPosition),
    openReviewPicker: useEventCallback(() => unlessOnlineGame(() => setGameReviewPickerOpen(true))),
    closeReviewPicker: useEventCallback(() => setGameReviewPickerOpen(false)),
    openImportDialog: useEventCallback(() => setImportOpen(true)),
    closeImportDialog: useEventCallback(() => setImportOpen(false)),
    reviewGame: useEventCallback((id: string) => unlessOnlineGame(() => void openSelectedGameReview(id))),
    // After a Lichess game: Play, on its Lichess tab.
    playLichess: useEventCallback(() => {
      useLichessStore.getState().setPlayOpponent("lichess");
      openPlayPage();
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
    flipBoard: useEventCallback(() => currentGame().flip()),
    openGame: useEventCallback((id: string) => unlessOnlineGame(() => void openSavedGameById(id))),
    startReview: useEventCallback(() => void startReview()),
    stopReview: useEventCallback(() => void cancelActiveReview()),
    showGame: useEventCallback(() => showGame()),
    startPuzzle: useEventCallback((config: PuzzleSessionConfig, puzzle: PuzzleSample) => startPuzzle(puzzle, config)),
    openGameFromLibrary: useEventCallback((id: string) => unlessOnlineGame(() => void openSavedGameById(id))),
    nextPuzzle: useEventCallback(loadNextPuzzle),
    playEngineFromPuzzle: useEventCallback(playEngineFromCurrentPuzzlePosition),
    reviewCurrentGame: useEventCallback(() => void openSelectedGameReview("current"))
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
        puzzleConfig={activePuzzleConfig}
      />
    ),
    [nextPuzzle.error, nextPuzzle.isPending, on.nextPuzzle, on.playEngineFromPuzzle, activePuzzleConfig]
  );

  const pageTitles: Partial<Record<AppView, string>> = {
    home: "Home",
    settings: "Settings",
    play: "Play",
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
          onPlay={on.play}
          onAnalyze={on.liveAnalysis}
          onReview={on.openReviewPicker}
          onPuzzles={on.puzzles}
          onDatabases={on.databases}
          onImport={on.importPgn}
          onExport={on.exportPgn}
          onFocusToggle={on.toggleFocus}
          onFlip={on.flipBoard}
          onSettings={on.settings}
        />

        <main className={cn(contentPanel, "col-start-2 row-start-2 [view-transition-name:app-content]")}>
          {appNotice ? (
            <Notice
              tone="danger"
              className="mx-(--page-gutter) mt-(--page-gutter-y) w-auto shrink-0"
              action={
                <Button type="button" variant="link" size="xs" onClick={dismissAppNotice}>
                  Dismiss
                </Button>
              }
            >
              {appNotice}
            </Notice>
          ) : null}
          {!desktopApiAvailable ? (
            <Notice tone="warn" title="Web preview mode" className="mx-(--page-gutter) mt-(--page-gutter-y) w-auto shrink-0">
              Engines, file dialogs, saved games, downloads and local databases need the desktop app.
            </Notice>
          ) : null}
          <div className="grid min-h-0 flex-1">
            {/* A render error in one page shows a recoverable panel there, not a blank window; the
                key resets it when you go elsewhere. */}
            <ErrorBoundary key={appView} title="This page hit an unexpected error" scope={appView} layout="panel">
            <AppPages
              view={appView}
              desktopApiAvailable={desktopApiAvailable}
              settingsSection={settingsSection}
              settings={settings}
              settingsReady={settingsQuery.isSuccess}
              reviewTab={reviewTab}
              onReviewTabChange={setReviewTab}
              reviewLoading={reviewRouteLoading}
              sideTab={sideTab}
              onSideTabChange={setSideTab}
              canStartAnalysis={desktopApiAvailable && gameMode === "freeplay" && !positionIsEnd}
              puzzlePanel={puzzlePanel}
              on={on}
            />
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <PromotionDialog />
      <Suspense fallback={null}>
      {onboarding.open ? (
        <OnboardingFlow
          onFinish={onboarding.finish}
          onGoHome={on.home}
        />
      ) : null}
      {importOpen ? <PgnImportDialog onClose={on.closeImportDialog} onImported={on.importedGame} /> : null}
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

/** Going to `entry` would take the board from the Lichess game being played. */
function replacesLiveBoard(entry: HistoryEntry, liveGameId: string): boolean {
  if (entry.view === "puzzles") return true; // opening Puzzles puts the board in puzzle mode
  if (entry.view === "game" || entry.view === "game-review") return entry.board.lichessGameId !== liveGameId;
  return false;
}

function puzzleInputFromConfig(config: PuzzleSessionConfig, databaseId: string, excludeIds: string[]): PuzzleSampleInput {
  return { databaseId, excludeIds, lichess: config.lichess, position: config.position };
}
